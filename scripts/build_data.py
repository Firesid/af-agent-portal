#!/usr/bin/env python3
"""
Rebuilds public/data.json from the two source Google Sheets.

Reads:
  - "Terminated agents 2026" tab of the Data sheet (agent resignations / 180-day
    terms, with AF numbers for the agent (col C) and their reassigned-to upline
    (col K))
  - The Agent data sheet (AF number -> canonical agent name / status)

Both sheets are shared "anyone with the link can view", so this pulls them via
Google's public gviz CSV export with no credentials required.

Usage:
    python build_data.py [--out public/data.json] [--report]
"""
import argparse
import csv
import io
import json
import re
import sys
import urllib.request
from datetime import datetime

DATA_SHEET_ID = "15R7Sn8tkYArYLRpGbRz0RSvMq3v3eN3Va8iEv2UbjLE"
DATA_SHEET_TAB = "Terminated agents 2026"
AGENT_SHEET_ID = "1zgeXPWaAO4hLftHLtSDCkLGYECNZ7g_AduP9hP6gfe0"
AGENT_SHEET_TAB = "Sheet1"

MAX_CHAIN_DEPTH = 10

CARRIER_COLUMNS = [
    "LSW", "MN", "NA", "AILIC", "GALIC", "VOYA", "Athene", "F&G", "MOO", "ALLI",
    "ALLI PRE", "AE", "Pro One", "Jackson", "Protective", "Foresters", "SBL",
    "ANX AIG", "MSG AIG", "Nationwide", "Transamerica", "ANX Athene", "Prudential",
    "Symetra", "Forethought", "Delaware Life", "Lincoln National", "American Life",
    "Boston Mutual", "National Western",
]


def gviz_csv_url(sheet_id, tab_name):
    from urllib.parse import quote
    return (
        f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq"
        f"?tqx=out:csv&sheet={quote(tab_name)}"
    )


def fetch_csv_rows(sheet_id, tab_name):
    url = gviz_csv_url(sheet_id, tab_name)
    with urllib.request.urlopen(url, timeout=30) as resp:
        raw = resp.read().decode("utf-8")
    reader = csv.reader(io.StringIO(raw))
    return list(reader)


def clean_af(raw):
    """Normalize an AF number cell: strip whitespace/newlines, uppercase."""
    if raw is None:
        return ""
    s = re.sub(r"\s+", "", str(raw)).upper()
    return s


def autocorrect_af(s, agent_map):
    """Try common fixes for malformed AF numbers (missing/extra leading zeros,
    stray 'I' typo in the AF prefix) before giving up on a match."""
    if not s:
        return None
    if s in agent_map:
        return s
    m = re.match(r"^A?I?F(\d+)$", s)
    if not m:
        return None
    digits = m.group(1)
    for candidate in (
        "AF" + digits.zfill(5),
        "AF" + digits.lstrip("0").zfill(5),
        "AF" + digits.zfill(6),
    ):
        if candidate in agent_map:
            return candidate
    return None


def load_agent_map(rows):
    """rows[0] is the header: agentnumber, AgentName, agentstatus"""
    agent_map = {}
    for row in rows[1:]:
        if not row or not row[0]:
            continue
        af = clean_af(row[0])
        name = (row[1] or "").strip()
        status = (row[2] or "").strip() if len(row) > 2 else ""
        if af:
            agent_map[af] = {"name": name, "status": status}
    return agent_map


def format_date(raw):
    """Source dates come through gviz as 'Date(2017,1,15)' style literals or
    plain strings depending on cell formatting. Normalize to M/D/YYYY."""
    if not raw:
        return ""
    raw = raw.strip()
    m = re.match(r"^Date\((\d+),(\d+),(\d+)\)$", raw)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)) + 1, int(m.group(3))
        return f"{mo}/{d}/{y}"
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw, fmt)
            return f"{dt.month}/{dt.day}/{dt.year}"
        except ValueError:
            continue
    return raw  # fall back to whatever was there


def build_records_with_chain_links(data_rows, agent_map, report):
    """Same as build_records but also returns, per record, the resolved upline
    AF# (or None) so chains can be walked without re-parsing the sheet."""
    header = data_rows[0]
    col = {name: i for i, name in enumerate(header)}
    carrier_idx = [(name, col[name]) for name in CARRIER_COLUMNS if name in col]

    records = []
    upline_af_for_record = []
    af_to_index = {}
    unresolved_c, unresolved_k = [], []

    for row_num, row in enumerate(data_rows[1:], start=2):
        if len(row) <= col["Agent"] or not row[col["Agent"]].strip():
            continue

        rtype_raw = row[col["Resign/180"]].strip() if col["Resign/180"] < len(row) else ""
        source = "Resign" if rtype_raw == "Resign" else "180 Term"

        raw_c = row[col["AF number"]] if col["AF number"] < len(row) else ""
        raw_k = row[col["AF Number"]] if col["AF Number"] < len(row) else ""
        c_af = clean_af(raw_c)
        k_af = clean_af(raw_k)

        c_resolved = c_af if c_af in agent_map else autocorrect_af(c_af, agent_map)
        k_resolved = k_af if k_af in agent_map else autocorrect_af(k_af, agent_map)

        if c_af and not c_resolved:
            unresolved_c.append((row_num, raw_c))
        if k_af and not k_resolved:
            unresolved_k.append((row_num, raw_k))

        agent_name = agent_map[c_resolved]["name"] if c_resolved else row[col["Agent"]].strip()
        if not agent_name:
            agent_name = row[col["Agent"]].strip() or "(Unknown)"

        upline_raw = row[col["Upline"]].strip() if col["Upline"] < len(row) else ""
        upline_name = agent_map[k_resolved]["name"] if k_resolved else upline_raw
        if not upline_name:
            upline_name = "Unassigned"

        carriers = ", ".join(name for name, idx in carrier_idx if idx < len(row) and row[idx].strip())
        date_str = format_date(row[col["Resigned"]] if col["Resigned"] < len(row) else "")

        records.append([agent_name, date_str, upline_name, carriers, source])
        upline_af_for_record.append(k_resolved)

        if c_resolved and c_resolved not in af_to_index:
            af_to_index[c_resolved] = len(records) - 1

    if report:
        print(f"[build_data] {len(records)} records built", file=sys.stderr)
        print(f"[build_data] {len(unresolved_c)} unresolved column-C AF#s (showing up to 10): {unresolved_c[:10]}", file=sys.stderr)
        print(f"[build_data] {len(unresolved_k)} unresolved column-K AF#s (showing up to 10): {unresolved_k[:10]}", file=sys.stderr)

    return records, upline_af_for_record, af_to_index


def build_chains(records, upline_af_for_record, af_to_index):
    chains = {}
    for i, record in enumerate(records):
        chain = [record]
        visited = {i}
        cur = i
        for _ in range(MAX_CHAIN_DEPTH - 1):
            next_af = upline_af_for_record[cur]
            if not next_af or next_af not in af_to_index:
                break
            nxt = af_to_index[next_af]
            if nxt in visited:
                break  # cycle guard
            chain.append(records[nxt])
            visited.add(nxt)
            cur = nxt
        key = record[0].strip().lower()
        chains[key] = chain
    return chains


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="public/data.json")
    parser.add_argument("--report", action="store_true", help="print resolution stats to stderr")
    args = parser.parse_args()

    print("[build_data] fetching Agent data sheet...", file=sys.stderr)
    agent_rows = fetch_csv_rows(AGENT_SHEET_ID, AGENT_SHEET_TAB)
    agent_map = load_agent_map(agent_rows)
    print(f"[build_data] loaded {len(agent_map)} agent AF numbers", file=sys.stderr)

    print("[build_data] fetching Terminated agents 2026 tab...", file=sys.stderr)
    data_rows = fetch_csv_rows(DATA_SHEET_ID, DATA_SHEET_TAB)

    records, upline_af_for_record, af_to_index = build_records_with_chain_links(
        data_rows, agent_map, args.report
    )

    resign = [r for r in records if r[4] == "Resign"]
    term = [r for r in records if r[4] != "Resign"]

    chains = build_chains(records, upline_af_for_record, af_to_index)

    up_resign = sorted({r[2] for r in resign if r[2] and r[2] != "Unassigned"})
    up_term = sorted({r[2] for r in term if r[2] and r[2] != "Unassigned"})

    out = {
        "RESIGN": resign,
        "TERM": term,
        "CHAINS": chains,
        "UP_RESIGN": up_resign,
        "UP_TERM": up_term,
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)

    print(
        f"[build_data] wrote {args.out}: {len(resign)} resign, {len(term)} term, "
        f"{len(chains)} chains, {len(up_resign)} resign uplines, {len(up_term)} term uplines",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
