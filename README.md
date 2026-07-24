# AF Agent Reassignment Portal

Internal tool for looking up resigned/deactivated agents and tracing who their
book of business was reassigned to.

**Live URL:** https://af-agent-portal-396611170842.us-central1.run.app/

## How it works

- `public/index.html`, `public/styles.css`, `public/portal.js` — the frontend.
  Static files, no build step, no framework.
- `public/portal.js` fetches `data.json` from a public Cloud Storage bucket
  (`https://storage.googleapis.com/af-agent-portal-data/data.json`) on every
  page load — data is never baked into the deployed frontend.
- `scripts/build_data.py` rebuilds that `data.json` from two Google Sheets:
  - **Data sheet**, tab `Terminated agents 2026` — column C is the resigned/
    deactivated/suspended agent's own AF number, column K is the AF number of
    who their business was reassigned to.
  - **Agent data sheet** — the AF number → canonical name/status lookup.
  - Both sheets are shared "anyone with the link can view," so the script
    pulls them via Google's public `gviz` CSV export. **No credentials, API
    keys, or service accounts are needed to read the sheets.**
- A Cloud Run Job runs that script every 30 minutes (via Cloud Scheduler) and
  uploads the result straight to the bucket. The frontend never needs to be
  redeployed for a data change — only for a code change.

```
Google Sheets (public, view-only)
        │  gviz CSV export, no auth
        ▼
Cloud Run Job "af-agent-portal-refresh"  ──(every 30 min, Cloud Scheduler)
        │  uploads data.json
        ▼
Cloud Storage bucket "af-agent-portal-data" (public read)
        │  fetched client-side on every page load
        ▼
Cloud Run service "af-agent-portal"  (static frontend, nginx)
```

## GCP resources

All resources live in the `af-agent-portal` project, region `us-central1`.

| Resource | Name |
|---|---|
| Cloud Run service (frontend) | `af-agent-portal` |
| Cloud Run Job (data refresh) | `af-agent-portal-refresh` |
| Cloud Scheduler job | `af-agent-portal-refresh-schedule` (`*/30 * * * *`, America/Chicago) |
| Cloud Storage bucket | `af-agent-portal-data` |
| Artifact Registry repo | `cloud-run-source-deploy` |
| Scheduler invoker service account | `af-portal-scheduler@af-agent-portal.iam.gserviceaccount.com` |

## Running the data build locally

No external dependencies for a local run — pure Python stdlib:

```bash
python scripts/build_data.py --out public/data.json --report
```

`--report` prints resolution stats to stderr (how many AF numbers matched,
which ones didn't). Open `public/index.html` directly in a browser afterward
to test against that local data — note `portal.js` fetches the *live* bucket
URL by default, so for a fully local test you'd temporarily point `DATA_URL`
in `portal.js` at `data.json` (relative path) instead.

## Deploying

### Data changes

Nothing to do — Cloud Scheduler triggers the refresh automatically every 30
minutes. To force an immediate refresh instead of waiting:

```bash
gcloud run jobs execute af-agent-portal-refresh --region=us-central1 --project=af-agent-portal --wait
```

### Code changes (frontend: index.html / styles.css / portal.js / Dockerfile / nginx.conf)

Automatic deploy-on-push via Cloud Build is set up but currently blocked by
an org-level permissions issue on the `appreciationfinancial.com` GCP org
(trigger creation fails with an opaque `400 INVALID_ARGUMENT` even though the
GitHub connection itself is authorized — needs an org admin to investigate).
Until that's resolved, deploy manually after pushing to GitHub:

```bash
gcloud builds submit --tag us-central1-docker.pkg.dev/af-agent-portal/cloud-run-source-deploy/af-agent-portal --project=af-agent-portal

gcloud run deploy af-agent-portal \
  --image=us-central1-docker.pkg.dev/af-agent-portal/cloud-run-source-deploy/af-agent-portal \
  --region=us-central1 --project=af-agent-portal
```

If org admin access is sorted out later, retry:

```bash
gcloud builds triggers create github \
  --name=af-agent-portal-deploy \
  --repository="projects/af-agent-portal/locations/us-central1/connections/af-agent-portal-github/repositories/af-agent-portal-repo" \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml \
  --included-files="Dockerfile,nginx.conf,public/**" \
  --region=us-central1 --project=af-agent-portal
```

### Pipeline changes (scripts/build_data.py, Dockerfile.pipeline)

```bash
gcloud builds submit --config=cloudbuild.pipeline.yaml --project=af-agent-portal .

gcloud run jobs update af-agent-portal-refresh \
  --image=us-central1-docker.pkg.dev/af-agent-portal/cloud-run-source-deploy/af-agent-portal-refresh \
  --region=us-central1 --project=af-agent-portal
```

## Viewing logs

```bash
# Frontend service request logs
gcloud run services logs read af-agent-portal --region=us-central1 --project=af-agent-portal

# Data refresh job execution history
gcloud run jobs executions list --job=af-agent-portal-refresh --region=us-central1 --project=af-agent-portal

# A specific execution's logs
gcloud run jobs executions describe EXECUTION_NAME --region=us-central1 --project=af-agent-portal
```

## Failure alerts

A Cloud Monitoring alert policy (`AF Agent Portal - data refresh job failed`)
watches for `ERROR`-severity logs from the `af-agent-portal-refresh` Cloud
Run Job and emails `DataTeam@appreciationfinancial.com` (rate-limited to at
most one email per hour). If that inbox hasn't clicked a notification-channel
verification email from Google Cloud yet, do that first or alerts won't
actually deliver.

## Credentials

There aren't any to rotate — both source sheets are shared "anyone with the
link can view," and the pipeline reads them over plain HTTPS with no
authentication. The only credentials in play are standard GCP IAM (the Cloud
Run Job's runtime service account has `roles/storage.objectAdmin` on the
`af-agent-portal-data` bucket to write `data.json`).

If either sheet's sharing is ever changed to "restricted," the pipeline will
start failing with an HTTP error from the `gviz` export endpoint — at that
point it would need a service account with Sheets API read access instead of
the current no-auth approach.

## Adding/removing sheet editors

Not something this project manages — the Data sheet and Agent data sheet
permissions are owned by the Appreciation Financial back-office team
directly in Google Sheets. The pipeline only ever reads.

## Access

The live URL is unauthenticated (anyone with the link can view), matching
how the source sheets and the prior GitHub Pages site were already shared.
