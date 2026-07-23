// ── DATA ──────────────────────────────────────────────────────
let RESIGN = [], TERM = [], ALL = [], CHAINS = {}, UP_RESIGN = [], UP_TERM = [];

async function loadData() {
  const res = await fetch('data.json?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load data.json: ' + res.status);
  const data = await res.json();
  RESIGN = data.RESIGN || [];
  TERM = data.TERM || [];
  CHAINS = data.CHAINS || {};
  UP_RESIGN = data.UP_RESIGN || [];
  UP_TERM = data.UP_TERM || [];
  ALL = [...RESIGN, ...TERM];
}
const PAGE = 50;

let currentSearch = [], currentResign = [], currentTerm = [], currentAll = [], currentUplineSearch = [];
let sortDir = {};
// Store dataset refs keyed by tab name for pagination callbacks
const DS = { search: () => currentSearch, resign: () => currentResign, term: () => currentTerm, all: () => currentAll, usearch: () => currentUplineSearch };

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    document.getElementById('stats-row').innerHTML =
      `<div class="stat-card"><div class="stat-lbl">⚠️ Couldn't load data. Please refresh the page.</div></div>`;
    return;
  }

  document.getElementById('b1').textContent = `📋 ${RESIGN.length.toLocaleString()} Resigned Agents`;
  document.getElementById('b2').textContent = `⏱️ ${TERM.length.toLocaleString()} 180-Day Term Agents`;
  document.getElementById('b3').textContent = `👥 ${UP_RESIGN.length} Unique Uplines`;

  document.getElementById('stats-row').innerHTML = `
    <div class="stat-card"><div class="stat-val">${RESIGN.length.toLocaleString()}</div><div class="stat-lbl">Resigned Agents</div></div>
    <div class="stat-card green"><div class="stat-val">${TERM.length.toLocaleString()}</div><div class="stat-lbl">180 Term Agents</div></div>
    <div class="stat-card orange"><div class="stat-val">${UP_RESIGN.length.toLocaleString()}</div><div class="stat-lbl">Unique Uplines (Resign)</div></div>
    <div class="stat-card"><div class="stat-val">${ALL.length.toLocaleString()}</div><div class="stat-lbl">Total Records</div></div>`;

  populate('sel-resign', UP_RESIGN);
  initHopFilterCounts();
  populate('sel-term',   UP_TERM);

  currentAll = [...ALL];
  render('all', currentAll, '', 1);
});

function populate(selId, list) {
  const sel = document.getElementById(selId);
  list.forEach(u => {
    const o = document.createElement('option');
    o.value = u; o.textContent = u;
    sel.appendChild(o);
  });
}

// ── TAB SWITCH ────────────────────────────────────────────────
function switchTab(btn, name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}


// ── UPLINE LOOKUP ─────────────────────────────────────────────
function runUplineSearch() {
  const q = document.getElementById('upline-search').value.trim().toLowerCase();
  if (!q) {
    currentUplineSearch = [];
    document.getElementById('tbody-usearch').innerHTML =
      '<tr><td colspan="5" class="no-results"><span class="ico">👥</span>Start typing an upline name to find their agents…</td></tr>';
    document.getElementById('count-usearch').textContent = '—';
    document.getElementById('pag-usearch').style.display = 'none';
    return;
  }

  // Step 1: direct matches — agent's immediate upline contains the query
  const directSet = new Set();
  const directRows = [];
  ALL.forEach(r => {
    if (r[2].toLowerCase().includes(q)) {
      const key = r[0].toLowerCase() + '|' + r[1];
      directSet.add(key);
      // r[5] = hop label; 'direct' means no via annotation
      directRows.push([r[0], r[1], r[2], r[3], r[4], 'direct']);
    }
  });

  // Step 2: transitive matches via CHAINS
  // Walk every agent's chain; if any hop AFTER the first hop has an upline
  // containing the query, and the agent is not already in directSet, include them.
  const indirectRows = [];
  Object.keys(CHAINS).forEach(agentKey => {
    const chain = CHAINS[agentKey];
    if (!chain || chain.length < 2) return; // no multi-hop chain
    const baseRow = chain[0]; // the original agent's first hop row
    const rowKey  = baseRow[0].toLowerCase() + '|' + baseRow[1];
    if (directSet.has(rowKey)) return; // already included as direct

    // Check hops beyond the first for the searched upline
    for (let i = 1; i < chain.length; i++) {
      const hopUpline = chain[i][2];
      if (hopUpline.toLowerCase().includes(q)) {
        // The intermediate upline is chain[i-1][2] (who this agent went to first)
        const viaLabel = chain[i - 1][2];
        indirectRows.push([
          baseRow[0],  // agent name
          baseRow[1],  // date
          baseRow[2],  // direct upline (hop 1)
          baseRow[3],  // carriers
          baseRow[4],  // source
          'via: ' + viaLabel  // hop annotation
        ]);
        break; // only add once per agent
      }
    }
  });

  currentUplineSearch = [...directRows, ...indirectRows];
  renderUplineSearch(currentUplineSearch, q, 1);
}

function clearUplineSearch() {
  document.getElementById('upline-search').value = '';
  runUplineSearch();
}

// Dedicated renderer for upline search — supports the hop-label column (r[5])
function renderUplineSearch(data, hl, page) {
  const PAGE_SIZE = 50;
  const tbody   = document.getElementById('tbody-usearch');
  const countEl = document.getElementById('count-usearch');
  const pagEl   = document.getElementById('pag-usearch');

  countEl.textContent = data.length === 0 ? 'No results'
    : `${data.length.toLocaleString()} result${data.length !== 1 ? 's' : ''}`;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="no-results"><span class="ico">😕</span>No matching records found.</td></tr>';
    pagEl.style.display = 'none';
    return;
  }

  const totalPages = Math.ceil(data.length / PAGE_SIZE);
  const pg = Math.max(1, Math.min(page, totalPages));
  const start = (pg - 1) * PAGE_SIZE;
  const slice = data.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = slice.map(r => {
    const hopLabel = r[5] || 'direct';
    const isDirect = hopLabel === 'direct';
    const aH = hl ? hlText(r[0], hl) : esc(r[0]);
    // For direct rows, highlight the upline. For indirect, show upline + via badge.
    const uplineDisplay = isDirect
      ? (hl ? hlText(r[2], hl) : esc(r[2]))
      : `${esc(r[2])} <span style="display:inline-block;margin-left:5px;padding:1px 6px;border-radius:10px;font-size:0.72rem;background:#e9d8fd;color:#553c9a;white-space:nowrap;" title="Business eventually flows to searched upline through this intermediate">↪ ${esc(hopLabel.replace('via: ',''))}</span>`;
    const sc = r[4] === 'Resign' ? 'src-resign' : 'src-term';
    return `<tr>
      <td class="td-agent">${aH}</td>
      <td class="td-date">${esc(r[1])}</td>
      <td class="td-upline">${uplineDisplay}</td>
      <td class="td-carr">${esc(r[3])}</td>
      <td><span class="src-tag ${sc}">${esc(r[4])}</span></td>
    </tr>`;
  }).join('');

  if (totalPages <= 1) {
    pagEl.style.display = 'none';
  } else {
    pagEl.style.display = 'flex';
    const sp = Math.max(1, pg - 2), ep = Math.min(totalPages, pg + 2);
    let html = `<div class="pag-info">Showing ${start+1}–${Math.min(start+PAGE_SIZE, data.length)} of ${data.length.toLocaleString()}</div><div class="pag-btns">`;
    html += `<button class="pag-btn" ${pg===1?'disabled':''} onclick="goPageUpline(${pg-1})">← Prev</button>`;
    for (let p = sp; p <= ep; p++)
      html += `<button class="pag-btn ${p===pg?'active':''}" onclick="goPageUpline(${p})">${p}</button>`;
    html += `<button class="pag-btn" ${pg===totalPages?'disabled':''} onclick="goPageUpline(${pg+1})">Next →</button></div>`;
    pagEl.innerHTML = html;
  }
}

function goPageUpline(page) {
  const hl = document.getElementById('upline-search').value.trim().toLowerCase();
  renderUplineSearch(currentUplineSearch, hl, page);
}


// ── HOP FILTER ───────────────────────────────────────────────
let currentHopFilter = 'all';
let hopFilterData    = [];
const HOP_PAGE       = 50;

function initHopFilterCounts() {
  // Count agents per hop depth and update badge counts
  const counts = {};
  Object.values(CHAINS).forEach(chain => {
    const n = chain.length;
    counts[n] = (counts[n] || 0) + 1;
  });
  Object.keys(counts).forEach(n => {
    const el = document.getElementById('hfc-' + n);
    if (el) el.textContent = counts[n].toLocaleString();
  });
}

function setHopFilter(hops, btn) {
  currentHopFilter = hops;

  // Update button active state
  document.querySelectorAll('.hop-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const resultEl  = document.getElementById('hop-filter-result');
  const countEl   = document.getElementById('count-hop-filter');
  const exportBtn = document.getElementById('hop-export-btn');

  // Clear the agent search / trail view when switching to bulk filter
  document.getElementById('trail-search').value = '';
  document.getElementById('trail-suggestions').style.display = 'none';
  document.getElementById('trail-result').style.display = 'none';
  document.getElementById('trail-empty').style.display = 'none';
  document.getElementById('count-trail').textContent = '—';

  if (hops === 'all') {
    resultEl.style.display  = 'none';
    countEl.style.display   = 'none';
    exportBtn.style.display = 'none';
    document.getElementById('trail-empty').style.display = 'block';
    hopFilterData = [];
    return;
  }

  // Filter chains by hop count
  hopFilterData = Object.entries(CHAINS)
    .filter(([, chain]) => chain.length === hops)
    .map(([key, chain]) => ({ key, chain }))
    .sort((a, b) => a.chain[0][0].localeCompare(b.chain[0][0]));

  countEl.textContent  = hopFilterData.length.toLocaleString() + ' agent' + (hopFilterData.length !== 1 ? 's' : '');
  countEl.style.display   = 'inline-block';
  exportBtn.style.display = 'inline-flex';
  resultEl.style.display  = 'block';

  renderHopTable(1);
}

function renderHopTable(page) {
  const tbody  = document.getElementById('tbody-hop-filter');
  const pagEl  = document.getElementById('pag-hop-filter');
  const total  = hopFilterData.length;
  const pages  = Math.ceil(total / HOP_PAGE);
  const start  = (page - 1) * HOP_PAGE;
  const slice  = hopFilterData.slice(start, start + HOP_PAGE);

  tbody.innerHTML = slice.map(({ key, chain }) => {
    const hop1      = chain[0];
    const hop2      = chain[1] || null;
    const srcClass  = hop1[4] === 'Resign' ? 'src-resign' : 'src-term';
    const upline1   = hop1[2];
    const final     = hop2 ? hop2[2] : upline1;
    const isMulti   = final.includes('/') || (final.includes(',') && final.length > 25);
    const finalStyle = isMulti ? 'color:#2b6cb0;font-weight:600;' : 'color:#276749;font-weight:600;';

    const hop2Cell = hop2
      ? `<td style="${finalStyle}">${esc(hop2[2])} <span style="font-size:.7rem;color:#718096;">(${esc(hop2[4])})</span></td>`
      : `<td style="color:#276749;font-weight:600;">${esc(upline1)} <span style="font-size:.7rem;color:#276749;">(final)</span></td>`;

    return `<tr>
      <td style="font-weight:600;color:#1a365d;">${esc(hop1[0])}</td>
      <td style="color:#718096;white-space:nowrap;">${esc(hop1[1])}</td>
      <td style="color:#b7791f;font-weight:600;">${esc(upline1)}</td>
      ${hop2Cell}
      <td><span class="src-tag ${srcClass}">${esc(hop1[4])}</span></td>
      <td style="text-align:center;">
        <button class="view-trail-btn" onclick="viewTrailFromFilter('${key.replace(/'/g,"\'")}')">View Trail</button>
      </td>
    </tr>`;
  }).join('');

  // Pagination
  if (pages <= 1) {
    pagEl.style.display = 'none';
  } else {
    pagEl.style.display = 'flex';
    const sp = Math.max(1, page - 2), ep = Math.min(pages, page + 2);
    let ph = `<div class="pag-info">Showing ${start+1}–${Math.min(start+HOP_PAGE,total).toLocaleString()} of ${total.toLocaleString()}</div><div class="pag-btns">`;
    ph += `<button class="pag-btn" ${page===1?'disabled':''} onclick="renderHopTable(${page-1})">← Prev</button>`;
    for (let p = sp; p <= ep; p++)
      ph += `<button class="pag-btn ${p===page?'active':''}" onclick="renderHopTable(${p})">${p}</button>`;
    ph += `<button class="pag-btn" ${page===pages?'disabled':''} onclick="renderHopTable(${page+1})">Next →</button></div>`;
    pagEl.innerHTML = ph;
  }
}

function viewTrailFromFilter(key) {
  // Scroll up to trail viewer and select the agent
  selectTrail(key);
  document.getElementById('trail-search').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Reset hop filter buttons to "All" visually so it's clear we switched to search mode
  document.querySelectorAll('.hop-filter-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.hop-filter-btn').classList.add('active');
  document.getElementById('hop-filter-result').style.display = 'none';
  document.getElementById('count-hop-filter').style.display  = 'none';
  document.getElementById('hop-export-btn').style.display    = 'none';
  currentHopFilter = 'all';
}

function exportHopFilter() {
  if (!hopFilterData.length) return;
  const hops = currentHopFilter;
  const headers = hops === 1
    ? ['Agent Name','Date','Reassigned To (Hop 1)','Carriers','Source']
    : ['Agent Name','Date','Hop 1 → Upline','Hop 1 Carriers','Hop 2 → Final','Hop 2 Source'];

  const rows = [headers, ...hopFilterData.map(({ chain }) => {
    const h1 = chain[0];
    const h2 = chain[1];
    if (hops === 1) {
      return [h1[0], h1[1], h1[2], h1[3], h1[4]].map(v => `"${String(v).replace(/"/g,'""')}"`);
    } else {
      return [h1[0], h1[1], h1[2], h1[3], h2 ? h2[2] : '', h2 ? h2[4] : ''].map(v => `"${String(v).replace(/"/g,'""')}"`);
    }
  })];
  const csv  = rows.map(r => r.join(',')).join('\n');
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], {type:'text/csv'})),
    download: `hop_filter_${hops}_hops_${new Date().toISOString().slice(0,10)}.csv`
  });
  a.click();
}

// ── REASSIGNMENT TRAIL ────────────────────────────────────────
let trailSuggestions = [];

function runTrailSearch() {
  const q = document.getElementById('trail-search').value.trim().toLowerCase();
  const sugBox = document.getElementById('trail-suggestions');
  const resultEl = document.getElementById('trail-result');
  const emptyEl  = document.getElementById('trail-empty');
  const countEl  = document.getElementById('count-trail');

  if (!q || q.length < 2) {
    sugBox.style.display = 'none';
    resultEl.style.display = 'none';
    emptyEl.style.display = 'block';
    countEl.textContent = '—';
    return;
  }

  // Find matching agents in chains
  const matches = Object.keys(CHAINS).filter(k => k.includes(q));
  trailSuggestions = matches.slice(0, 12);

  if (trailSuggestions.length === 0) {
    sugBox.innerHTML = '<div class="trail-suggest-item"><span class="suggest-name" style="color:#a0aec0;">No agents found matching "' + esc(q) + '"</span></div>';
    sugBox.style.display = 'block';
    resultEl.style.display = 'none';
    emptyEl.style.display = 'none';
    countEl.textContent = 'No results';
    return;
  }

  sugBox.innerHTML = trailSuggestions.map(k => {
    const chain = CHAINS[k];
    const hops  = chain.length;
    const firstName = chain[0][0];
    const lastStop  = chain[chain.length - 1][2];
    const hopLabel  = hops === 1 ? '1 hop' : hops + ' hops';
    return `<div class="trail-suggest-item" onclick="selectTrail('${k.replace(/'/g,"\'")}')">
      <div class="suggest-name">${hlText(firstName, q)}</div>
      <div class="suggest-hops">${hopLabel} &nbsp;→&nbsp; Final: ${esc(lastStop)}</div>
    </div>`;
  }).join('');
  sugBox.style.display = 'block';
  resultEl.style.display = 'none';
  emptyEl.style.display = 'none';
  countEl.textContent = trailSuggestions.length + ' match' + (trailSuggestions.length !== 1 ? 'es' : '');
}

function selectTrail(agentKey) {
  const chain = CHAINS[agentKey];
  if (!chain) return;

  document.getElementById('trail-suggestions').style.display = 'none';
  document.getElementById('trail-result').style.display = 'block';
  document.getElementById('trail-empty').style.display  = 'none';
  document.getElementById('trail-search').value = chain[0][0];
  document.getElementById('count-trail').textContent = chain.length + ' hop' + (chain.length !== 1 ? 's' : '');

  renderTrailChain(chain);
  renderTrailTable(chain);
}

function renderTrailChain(chain) {
  const el = document.getElementById('trail-chain');
  let html = '';

  chain.forEach((hop, i) => {
    const isLast   = i === chain.length - 1;
    const upline   = hop[2];
    const isMulti  = upline.includes('/') || (upline.includes(',') && upline.length > 25);
    const srcClass = hop[4] === 'Resign' ? 'src-resign' : 'src-term';

    // Agent node
    html += `<div class="hop-node">
      <div class="hop-label">Hop ${i + 1} — ${esc(hop[4])}</div>
      <div class="hop-name">${esc(hop[0])}</div>
      <div class="hop-date">${esc(hop[1])}</div>
      <span class="src-tag ${srcClass}">${esc(hop[4])}</span>
    </div>`;

    // Arrow + upline destination
    if (isLast) {
      const nodeClass = isMulti ? 'hop-node hop-multi' : 'hop-node hop-final';
      const label = isMulti ? 'Split — Multiple Uplines' : 'Final Destination';
      html += `<div class="hop-arrow">→</div>
      <div class="${nodeClass}">
        <div class="hop-label">${label}</div>
        <div class="hop-name">${esc(upline)}</div>
        <div class="hop-date">Business reassigned here</div>
      </div>`;
    } else {
      html += `<div class="hop-arrow">→</div>`;
    }
  });

  el.innerHTML = html;
}

function renderTrailTable(chain) {
  const tbody = document.getElementById('tbody-trail');
  tbody.innerHTML = chain.map((hop, i) => {
    const isLast   = i === chain.length - 1;
    const upline   = hop[2];
    const isMulti  = upline.includes('/') || (upline.includes(',') && upline.length > 25);
    const uplineStyle = isLast
      ? (isMulti ? 'color:#2b6cb0;font-weight:600;' : 'color:#276749;font-weight:600;')
      : 'color:#b7791f;font-weight:600;';
    const srcClass = hop[4] === 'Resign' ? 'src-resign' : 'src-term';
    const terminal = isLast
      ? (isMulti ? ' <span style="font-size:.7rem;color:#2b6cb0;">(split)</span>'
                 : ' <span style="font-size:.7rem;color:#276749;">(final)</span>')
      : '';
    return `<tr>
      <td><span class="hop-badge">${i + 1}</span></td>
      <td style="font-weight:600;color:#1a365d;">${esc(hop[0])}</td>
      <td style="color:#718096;white-space:nowrap;">${esc(hop[1])}</td>
      <td style="${uplineStyle}">${esc(upline)}${terminal}</td>
      <td style="color:#4a5568;line-height:1.5;">${esc(hop[3])}</td>
      <td><span class="src-tag ${srcClass}">${esc(hop[4])}</span></td>
    </tr>`;
  }).join('');
}

function clearTrailSearch() {
  document.getElementById('trail-search').value = '';
  document.getElementById('trail-suggestions').style.display = 'none';
  document.getElementById('trail-result').style.display = 'none';
  document.getElementById('trail-empty').style.display = 'block';
  document.getElementById('count-trail').textContent = '—';
}

// Close suggestions when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('#trail-search') && !e.target.closest('#trail-suggestions')) {
    document.getElementById('trail-suggestions').style.display = 'none';
  }
});

// ── AGENT SEARCH ──────────────────────────────────────────────
function runSearch() {
  const q = document.getElementById('agent-search').value.trim().toLowerCase();
  if (!q) {
    currentSearch = [];
    document.getElementById('tbody-search').innerHTML =
      '<tr><td colspan="5" class="no-results"><span class="ico">🔍</span>Start typing to search agents…</td></tr>';
    document.getElementById('count-search').textContent = '—';
    document.getElementById('pag-search').style.display = 'none';
    return;
  }
  currentSearch = ALL.filter(r => r[0].toLowerCase().includes(q));
  render('search', currentSearch, q, 1);
}

function clearSearch() {
  document.getElementById('agent-search').value = '';
  runSearch();
}

// ── UPLINE FILTER ─────────────────────────────────────────────
function runUpline(sheet) {
  const val = document.getElementById('sel-' + sheet).value;
  if (!val) { resetUpline(sheet); return; }
  const src = sheet === 'resign' ? RESIGN : TERM;
  const res = src.filter(r => r[2] === val);
  if (sheet === 'resign') currentResign = res;
  else currentTerm = res;
  render(sheet, res, '', 1);
}

function resetUpline(sheet) {
  document.getElementById('sel-' + sheet).value = '';
  const ph = sheet === 'resign'
    ? '<tr><td colspan="5" class="no-results"><span class="ico">📋</span>Select an upline to view their agents.</td></tr>'
    : '<tr><td colspan="5" class="no-results"><span class="ico">⏱️</span>Select an upline to view their agents.</td></tr>';
  document.getElementById('tbody-' + sheet).innerHTML = ph;
  document.getElementById('count-' + sheet).textContent = '—';
  document.getElementById('pag-' + sheet).style.display = 'none';
  if (sheet === 'resign') currentResign = [];
  else currentTerm = [];
}

// ── ALL RECORDS ───────────────────────────────────────────────
function runAll() {
  const q   = document.getElementById('all-search').value.trim().toLowerCase();
  const src = document.getElementById('all-src').value;
  currentAll = ALL.filter(r => {
    const mSrc = !src || r[4] === src;
    const mQ   = !q  || r[0].toLowerCase().includes(q)
                      || r[2].toLowerCase().includes(q)
                      || r[3].toLowerCase().includes(q);
    return mSrc && mQ;
  });
  render('all', currentAll, q, 1);
}

function clearAll() {
  document.getElementById('all-search').value = '';
  document.getElementById('all-src').value = '';
  currentAll = [...ALL];
  render('all', currentAll, '', 1);
}

// ── RENDER TABLE ──────────────────────────────────────────────
function render(tab, data, hl, page) {
  const tbody   = document.getElementById('tbody-' + tab);
  const countEl = document.getElementById('count-' + tab);
  const pagEl   = document.getElementById('pag-' + tab);

  countEl.textContent = data.length === 0 ? 'No results'
    : `${data.length.toLocaleString()} result${data.length !== 1 ? 's' : ''}`;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="no-results"><span class="ico">😕</span>No matching records found.</td></tr>';
    pagEl.style.display = 'none';
    return;
  }

  const totalPages = Math.ceil(data.length / PAGE);
  const start = (page - 1) * PAGE;
  const slice = data.slice(start, start + PAGE);

  tbody.innerHTML = slice.map(r => {
    const aH = hl ? hlText(r[0], hl) : esc(r[0]);
    const uH = hl ? hlText(r[2], hl) : esc(r[2]);
    const sc = r[4] === 'Resign' ? 'src-resign' : 'src-term';
    return `<tr>
      <td class="td-agent">${aH}</td>
      <td class="td-date">${esc(r[1])}</td>
      <td class="td-upline">${uH}</td>
      <td class="td-carr">${esc(r[3])}</td>
      <td><span class="src-tag ${sc}">${esc(r[4])}</span></td>
    </tr>`;
  }).join('');

  if (totalPages <= 1) {
    pagEl.style.display = 'none';
  } else {
    pagEl.style.display = 'flex';
    const sp = Math.max(1, page - 2), ep = Math.min(totalPages, page + 2);
    let html = `<div class="pag-info">Showing ${start+1}–${Math.min(start+PAGE, data.length)} of ${data.length.toLocaleString()}</div><div class="pag-btns">`;
    html += `<button class="pag-btn" ${page===1?'disabled':''} onclick="goPage('${tab}',${page-1})">← Prev</button>`;
    for (let p = sp; p <= ep; p++)
      html += `<button class="pag-btn ${p===page?'active':''}" onclick="goPage('${tab}',${p})">${p}</button>`;
    html += `<button class="pag-btn" ${page===totalPages?'disabled':''} onclick="goPage('${tab}',${page+1})">Next →</button></div>`;
    pagEl.innerHTML = html;
  }
}

function goPage(tab, page) {
  const data = DS[tab]();
  const hl = tab === 'search'  ? document.getElementById('agent-search').value.trim().toLowerCase()
           : tab === 'all'     ? document.getElementById('all-search').value.trim().toLowerCase()
           : tab === 'usearch' ? document.getElementById('upline-search').value.trim().toLowerCase()
           : '';
  if (tab === 'usearch') {
    renderUplineSearch(data, hl, page);
  } else {
    render(tab, data, hl, page);
  }
}

// ── SORT ──────────────────────────────────────────────────────
function doSort(tab, col) {
  const key = tab + '_' + col;
  const asc = !sortDir[key];
  sortDir[key] = asc;

  const tblId = 'tbl-' + tab;
  document.querySelectorAll(`#${tblId} thead th`).forEach((th, i) => {
    th.classList.remove('sorted');
    const si = th.querySelector('.si');
    if (si) si.textContent = '⇅';
  });
  const ths = document.querySelectorAll(`#${tblId} thead th`);
  if (ths[col]) {
    ths[col].classList.add('sorted');
    const si = ths[col].querySelector('.si');
    if (si) si.textContent = asc ? '↑' : '↓';
  }

  const data = DS[tab]();
  data.sort((a, b) => {
    const va = (a[col] || '').toLowerCase();
    const vb = (b[col] || '').toLowerCase();
    return asc ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  const hl = tab === 'search'  ? document.getElementById('agent-search').value.trim().toLowerCase()
           : tab === 'all'     ? document.getElementById('all-search').value.trim().toLowerCase()
           : tab === 'usearch' ? document.getElementById('upline-search').value.trim().toLowerCase()
           : '';
  if (tab === 'usearch') {
    renderUplineSearch(data, hl, 1);
  } else {
    render(tab, data, hl, 1);
  }
}

// ── EXPORT ────────────────────────────────────────────────────
function exportCSV(data, name) {
  if (!data || !data.length) { alert('No data to export. Run a search or filter first.'); return; }
  const hdr = ['Agent Name','Date','Upline','Carriers / Policy','Source'];
  const rows = [hdr, ...data.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"` ))];
  const csv  = rows.map(r => r.join(',')).join('\n');
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], {type:'text/csv'})),
    download: name + '_' + new Date().toISOString().slice(0,10) + '.csv'
  });
  a.click();
}

// ── HELPERS ───────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function hlText(s, q) {
  if (!q) return esc(s);
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return esc(s).replace(re, '<mark>$1</mark>');
}
