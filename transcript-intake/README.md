# Transcript Intake Worker

See the full plan (`Meeting Capture Bot Plan.md`, repo root) for the whole
flow, the archivist1-side changes, and secrets. This README covers what
phase 1 actually builds: a Worker that checks a secret and a payload shape,
then logs it. **It does not write to GitHub yet** — that's phase 2.

## What's here

```
POST /ingest/<WEBHOOK_SECRET>
```

1. Rejects anything but `POST /ingest/<secret>` with 404.
2. Rejects a wrong secret with 401 (constant-time compare).
3. Rejects a payload over 5 MB, non-JSON, or the wrong shape with 400 —
   `src/validate.js` checks `webhookBodyType === "advanced"`,
   `meetingSoftware === "google_meet"`, a non-empty `transcript` array
   where every entry has `personName`/`timestamp`/`transcriptText`, and a
   parseable `meetingStartTimestamp`.
4. Otherwise logs the payload's shape (title, timestamps, entry counts —
   never the transcript or chat text) and returns 200.

## Local development

```bash
cd transcript-intake
npm install
cp .dev.vars.example .dev.vars   # set a real WEBHOOK_SECRET locally, not committed
npm run dev
```

Send it a test payload (the phase-1 fixture, redacted from a real meeting):

```bash
curl -X POST "http://localhost:8787/ingest/$(grep WEBHOOK_SECRET .dev.vars | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  --data @test/fixtures/sample-meeting.json
```

Run the unit tests (pure Node, no Cloudflare runtime needed since
`validate.js` has no Worker-specific APIs):

```bash
npm test
```

## Deploy

GitHub Actions config this needs, two values:

| Name | Where it comes from |
| --- | --- |
| `WEBHOOK_SECRET` | Generate one yourself, e.g. `openssl rand -hex 32` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Same values the existing `worker/` deploy uses — see [automation/manual.md](../automation/manual.md) if these aren't set on this fork yet |

Add them with `gh secret set <NAME> --repo <your-account>/cloudroot`, or
by hand under **Settings → Secrets and variables → Actions**.
`automation/sync-config.sh` doesn't cover `WEBHOOK_SECRET` (it only syncs
its own fixed 5-key set), so set that one directly.

Push to `main` with changes under `transcript-intake/`, or run the
**Deploy Transcript Intake Worker** workflow by hand from the Actions tab.
It installs dependencies, runs `npm test`, pushes `WEBHOOK_SECRET` into
Cloudflare, then runs `wrangler deploy`.

## Verify the phase 1 gate

After deploying, note the Worker URL Cloudflare prints
(`https://transcript-intake.<your-subdomain>.workers.dev`), then:

```bash
# wrong secret -> 401
curl -i -X POST https://transcript-intake.<subdomain>.workers.dev/ingest/wrong-secret \
  -H "Content-Type: application/json" -d '{}'

# real secret, fixture body -> 200, and a redacted copy of a real meeting's
# post should also reach it (point a real TranscripTonic webhook at this
# URL + your real secret for at least one meeting)
curl -i -X POST https://transcript-intake.<subdomain>.workers.dev/ingest/<WEBHOOK_SECRET> \
  -H "Content-Type: application/json" --data @test/fixtures/sample-meeting.json
```

Check the response is 200 and `wrangler tail` (or the Cloudflare dashboard's
Logs tab) shows the logged shape, not raw transcript text.

## Files

```
.github/workflows/deploy-transcript-intake.yml   # CI: test + deploy + push WEBHOOK_SECRET
transcript-intake/src/index.js                   # route, secret check, validation, logging
transcript-intake/src/validate.js                # payload shape/size checks (pure, unit-tested)
transcript-intake/wrangler.toml                  # Worker config
transcript-intake/package.json
transcript-intake/.dev.vars.example              # local dev config template
transcript-intake/test/fixtures/sample-meeting.json
transcript-intake/test/worker.test.js
```

## Not yet built (later phases)

- `src/naming.js` (date/`HHMM` from `meetingStartTimestamp`, phase 2)
- `src/github.js` (duplicate check, branch creation via the Git Data API, phase 2)
- `ARCHIVIST_TOKEN` / `ARCHIVIST_REPO` config (phase 2)
- Capture-person setup instructions for the extension itself (phase 4, once the
  webhook is actually turned on against a real meeting)
