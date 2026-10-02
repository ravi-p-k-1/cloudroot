# Transcript Intake Worker

See the full plan ([PLAN.md](PLAN.md), in this folder) for the whole
flow, the archivist1-side changes, and secrets. This README covers what's
built through phase 2: a Worker that checks a secret and payload shape,
then creates a branch **and opens a PR** on archivist1 holding the
transcript JSON.

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
4. Derives `date`/`HHMM` from `meetingStartTimestamp` in
   `America/Los_Angeles` (`src/naming.js`), then creates
   `cloudflare/<date>-<HHMM>` on archivist1 holding
   `transcripts/<date>/meet/transcript.json` on top of `main`, and opens a
   PR into `main` (`src/github.js`: ref → commit → tree → commit → ref →
   PR). The PR has to be opened with `ARCHIVIST_TOKEN`, not a built-in
   `GITHUB_TOKEN` — archivist1's `claude-code-action` workflow only reacts
   to `pull_request` events, and a `GITHUB_TOKEN`-opened PR wouldn't start
   one at all.
5. Returns 200 once the branch and PR both exist. 409 if
   `transcripts/<date>/`, `archived/<date>/`, or a `cloudflare/<date>*`
   branch already exists. 500 if `ARCHIVIST_TOKEN` is rejected *before* the
   branch is created. 502 on any other GitHub/network error, **or if the
   branch was created but opening the PR failed** — that specific case
   needs opening the PR by hand from the existing branch, since retrying
   the webhook post would just hit the 409 duplicate-branch check.

Logs carry the date, branch name, and entry counts — never transcript text.

## Local development

```bash
cd transcript-intake
npm install
cp .dev.vars.example .dev.vars   # set WEBHOOK_SECRET and ARCHIVIST_TOKEN locally, not committed
npm run dev
```

Send it a test payload (the phase-1 fixture, redacted from a real meeting):

```bash
curl -X POST "http://localhost:8787/ingest/$(grep WEBHOOK_SECRET .dev.vars | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  --data @test/fixtures/sample-meeting.json
```

That talks to the real archivist1 repo named in `wrangler.toml`'s
`ARCHIVIST_REPO`, using your local `ARCHIVIST_TOKEN` — so a local run can
genuinely create a branch and PR there. Replay the same fixture twice to
see the 409 path.

Run the unit tests (pure Node, no Cloudflare runtime needed —
`src/github.js`'s tests mock the global `fetch`, not a live GitHub):

```bash
npm test
```

## Deploy

GitHub Actions config this needs:

| Name | Where it comes from |
| --- | --- |
| `WEBHOOK_SECRET` | Generate one yourself, e.g. `openssl rand -hex 32` |
| `ARCHIVIST_TOKEN` | Fine-grained GitHub PAT, archivist1 only, **Contents** and **Pull requests** read/write (see PLAN.md's "Secrets and config") |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Same values the existing `worker/` deploy uses — see [automation/manual.md](../automation/manual.md) if these aren't set on this fork yet |

`ARCHIVIST_REPO` is not a secret — it's a plain `[vars]` entry in
`wrangler.toml`, currently `ravi-p-k-1/archivist1`.

If `ARCHIVIST_TOKEN` was created before the PR-opening step existed, its
permissions need editing (Settings → Developer settings → Fine-grained
tokens → the token → Edit permissions) to add **Pull requests: Read and
write** — the existing token value stays valid, no need to regenerate it.

Add the secrets with `gh secret set <NAME> --repo <your-account>/cloudroot`,
or by hand under **Settings → Secrets and variables → Actions**.
`automation/sync-config.sh` doesn't cover `WEBHOOK_SECRET` or
`ARCHIVIST_TOKEN` (it only syncs its own fixed 4-key Cloudflare set), so set
those two directly.

Push to `main` with changes under `transcript-intake/`, or run the
**Deploy Transcript Intake Worker** workflow by hand from the Actions tab.
It installs dependencies, runs `npm test`, pushes both secrets into
Cloudflare, then runs `wrangler deploy`.

## Verify the phase 2 gate

After deploying:

```bash
# first post for a date -> 200, creates cloudflare/<date>-<HHMM> on archivist1
# AND opens a PR from it into main
curl -i -X POST https://transcript-intake.<subdomain>.workers.dev/ingest/<WEBHOOK_SECRET> \
  -H "Content-Type: application/json" --data @test/fixtures/sample-meeting.json

# same payload again -> 409, main untouched
curl -i -X POST https://transcript-intake.<subdomain>.workers.dev/ingest/<WEBHOOK_SECRET> \
  -H "Content-Type: application/json" --data @test/fixtures/sample-meeting.json
```

Confirm on GitHub: the branch exists on the archivist1 fork, contains only
`transcripts/<date>/meet/transcript.json` on top of `main`, there's an open
PR from that branch into `main`, and `main` itself is unchanged.

## Files

```
.github/workflows/deploy-transcript-intake.yml   # CI: test + deploy + push secrets
transcript-intake/src/index.js                   # route, secret check, validation, orchestration
transcript-intake/src/validate.js                # payload shape/size checks (pure, unit-tested)
transcript-intake/src/naming.js                  # date/HHMM in America/Los_Angeles (pure, unit-tested)
transcript-intake/src/github.js                  # duplicate check + tree/commit/ref/PR calls (mocked-fetch tests)
transcript-intake/wrangler.toml                  # Worker config (ARCHIVIST_REPO var)
transcript-intake/package.json
transcript-intake/.dev.vars.example              # local dev config template
transcript-intake/test/fixtures/sample-meeting.json
transcript-intake/test/worker.test.js
transcript-intake/test/naming.test.js
transcript-intake/test/github.test.js
```

## Not yet built (later phases, all on archivist1 — see PLAN.md)

- Phase 3: Pydantic models, `transcript.py`, the compact numbered view, and
  the `prepare`/`check-evidence`/`verify`/`finalize` CLI — offline, no
  workflow yet
- Phase 4: the rewritten `process-transcripts.yml` using
  `claude-code-action`, triggered by the PR this Worker now opens
- Phase 5: remove the old Claude Agent SDK code, add the `main` ruleset,
  auto-delete merged branches, turn the webhook on for real, run a real
  meeting end to end
- Phase 6: docs and upstream PRs
