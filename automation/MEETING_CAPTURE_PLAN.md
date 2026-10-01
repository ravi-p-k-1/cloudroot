# Meeting Capture Automation — Implementation Plan

Status: **draft, not started**. Execute step by step; each step ends in one
commit and gets manually reviewed/approved before moving to the next.

## Goal

Replace the manual "record with Otter, download, upload transcript.txt"
workflow with a fully automated pipeline: a self-hosted bot joins a Google
Meet call, records it, and a script produces a `transcript.txt` in the exact
format Archivist already expects, then pushes it to `main` at
`transcripts/<date>/<source>/transcript.txt`. That push is the existing
trigger for `.github/workflows/process-transcripts.yml` — nothing about that
workflow changes.

Trigger for this phase: **manual**. You supply a Google Meet URL to start a
capture; calendar-based auto-join is an explicit non-goal for now (see
"Later / non-goals").

## Final architecture

Everything — capture, storage, transcription, formatting — runs on the one
VM. GitHub only enters the picture at the very end, when the finished
`transcript.txt` is pushed. This keeps the pipeline to one machine and one
script for the first working version; see "Later / non-goals" for why a
GitHub-Release-based split was considered and set aside for now.

```
Oracle Cloud Always Free VM (Ubuntu, ARM, 2 OCPU / 12GB, $0 forever)
  |
  +-- Vexa (self-hosted, Docker Compose, Apache-2.0, $0)
  |     - joins the Google Meet as a bot, capture-only mode
  |       (transcribe_enabled: false -> no GPU, no STT dependency)
  |     - records meeting audio -> its own MinIO storage (Oracle block
  |       storage, part of the same Always Free allocation, $0)
  |     - tracks per-participant "speaker hint" events
  |       (name + epoch-ms timestamp + turn-end flag) independent of
  |       transcription, exposed on meeting completion as
  |       `data.speaker_events` via `GET /meetings/{meeting_id}`
  |
  +-- whisper.cpp (self-hosted, MIT, $0, CPU-only, run after the call ends)
  |     - transcribes the recording, on the VM -> timestamped text segments
  |
  +-- capture script (new, lives on the VM)
        1. call Vexa's REST API to start a bot for a given Meet URL
        2. poll bot status until the meeting ends
        3. GET /recordings -> read the audio from Oracle storage
        4. GET /meetings/{id} -> data.speaker_events
        5. run whisper.cpp on the audio, locally on the VM
        6. merge whisper segments with speaker_events by time overlap
           -> "Speaker N  M:SS" formatted text, matching the shape
           Archivist's evidence.py already expects (verified against
           archived/2026-08-27/otter/transcript.txt)
        7. write transcripts/<YYYY-MM-DD>/meet/transcript.txt
        8. git add/commit/push transcript.txt to main via a PAT
             -> this is the ONLY thing that leaves the VM; it's also the
                existing path-filter trigger — no workflow changes needed
        9. delete the local recording from Oracle storage now that the
           transcript is safely pushed — nothing audio-related
           accumulates on the VM over time
```

## Cost / licensing verification (checked 2026-09-12)

| Component | Cost | Source of confidence |
|---|---|---|
| Oracle Cloud Always Free VM (compute + storage) | $0 forever | 2 OCPU / 12GB ARM shape, plus 200GB block storage, are both part of the same permanent Always Free allocation (not the separate 30-day/$300 trial credit). Card is for identity verification; not billed unless you upgrade to Pay-As-You-Go. Risk: one documented community report of an erroneous charge after *adding a payment method* — mitigation is to never add one / stay on the Free Tier account type. Audio is deleted right after transcription (step 9), so storage use stays minimal regardless. |
| Vexa (self-hosted) | $0 forever | Apache-2.0 license; self-hosted deployments have "no license-key, no callbacks home, no per-seat metering." The hosted SaaS pricing ($12/seat/mo, $0.30/bot-hr + $0.20/hr transcription) does not apply — we never call vexa.ai's hosted service. |
| whisper.cpp | $0 forever | MIT-licensed, runs entirely on the VM's own CPU, no account or API key of any kind. |
| GitHub Actions / repo | $0, unchanged | Already used by this repo for `process-transcripts.yml`; this plan adds no new GitHub-side cost — only a small text file gets pushed. |

No step in this plan depends on a consumable trial credit (Deepgram/Azure/
managed bot APIs/ElevenLabs were considered and rejected earlier
specifically because their free tiers are one-time, capped, or metered
per-minute). Every piece here is free software running on free compute,
indefinitely.

## Steps

Each step below is scoped to be one reviewable commit (or one manual
infra action + a commit that documents/config's it). Do not start a step
until the previous one is approved.

- [ ] **0. Provision the VM.** Create the Oracle Cloud Always Free account
      and the ARM VM (Ubuntu 24.04), install Docker + `make`. Infra-only,
      no repo commit — confirm reachability (SSH) before moving on.

- [ ] **1. Deploy Vexa.** `make lite` (pre-built images, no source build) on
      the VM. Confirm the Gateway API responds and Docker containers are
      healthy. Infra-only.

- [ ] **2. First real capture-only test.** Manually start a bot via Vexa's
      API against a throwaway Google Meet call, let it run a few minutes,
      end it, then:
      - confirm a recording appears in `GET /recordings`
      - confirm `GET /meetings/{id}` returns a **non-empty**
        `data.speaker_events` array with the expected
        `{name, tMs, isEnd}`-shaped entries
      This is the one remaining unverified assumption in the whole plan —
      resolve it before writing any pipeline code. If `speaker_events`
      comes back empty in capture-only mode, stop and re-plan (fallback:
      enable Vexa's own transcription instead of whisper.cpp).

- [ ] **3. whisper.cpp setup.** Install and benchmark whisper.cpp on the VM
      against a real recording from step 2 (quantized `base.en` or `small`
      model). Confirm output includes per-segment timestamps and
      reasonable accuracy/runtime for a typical meeting length.

- [ ] **4. Capture script — start/poll/fetch.** New script (proposed
      location: a `meeting_capture/` directory in this repo, deployed to
      the VM) that: takes a Meet URL, starts a Vexa bot, polls until
      completion, reads the recording and `speaker_events`. Commit the
      script to this repo; no transcript output yet.

- [ ] **5. Capture script — transcribe + merge + format.** Add the
      whisper.cpp invocation, the speaker_events/whisper-segment merge by
      time overlap, and the reformat into the `Speaker N  M:SS` shape.
      Validate the output against Archivist's evidence-matching rules
      (`archivist/evidence.py`) on a real test recording before wiring up
      the push.

- [ ] **6. Push + cleanup integration.** Add the git commit/push step
      (PAT-based) that writes to `transcripts/<date>/meet/transcript.txt`
      on `main`, then deletes the local recording. Test end-to-end against
      a real Meet call and confirm `process-transcripts.yml` fires and
      opens its usual draft PR.

- [ ] **7. Documentation.** Update `README.md` with the new capture step
      (how to trigger a capture, where secrets/config for the VM live),
      mirroring the level of detail already in the "Run the workflow"
      section.

## Open risks to keep watching

- **`speaker_events` in capture-only mode is unverified** until step 2 —
  everything from step 4 onward depends on it coming back populated.
- **Google's own bot-join policy**: some Workspace admins block or flag
  auto-joining bots; if your account has restrictions this may need an
  admin-approved exception. Not yet checked against your specific account.
- **Oracle Always Free resource limits**: 2 OCPU/12GB runs Vexa
  (`make lite`) and whisper.cpp on the same box; running both concurrently
  for back-to-back meetings hasn't been tested yet and may need attention
  once meeting volume grows.
- **Speaker attribution accuracy**: "dominant speaker" events are coarse
  during cross-talk, same limitation as Otter's own output today — not a
  regression, but not perfect either.

## Later / explicit non-goals for this phase

- Calendar-based auto-join (watching a Google Calendar and joining
  scheduled meetings with no manual trigger).
- Support for Zoom or Microsoft Teams (Vexa supports both, but this plan
  targets Google Meet only, per current usage).
- **Splitting the pipeline via a GitHub Release asset** (uploading the raw
  recording to GitHub and running whisper.cpp on an Actions runner instead
  of the VM) was evaluated and set aside for the first version: it adds
  real value later (offloads CPU from the VM, decouples capture from
  transcription logic) but also adds three new failure surfaces (release
  upload, workflow trigger, asset download) for a pipeline that isn't
  built yet. Worth revisiting once the VM-only version is working and
  either CPU contention or iteration speed on the transcription logic
  becomes a real problem.
- Multi-cloud VM provisioning (Google/AWS) — documented earlier as a known
  gap (their free VMs are capped at 1GB RAM, too small for Vexa's stack);
  not being built until there's a concrete reason to.
- Multi-source-per-date reports (already a known Archivist limitation,
  unrelated to this plan).
