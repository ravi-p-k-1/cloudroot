# Meeting Capture Bot

See the full plan (`Meeting Capture Bot Plan.md`, repo root) for architecture,
cost, phases, and secrets. This folder holds the code; phase 0 (creating the
VM, OCI API key, SSH key, and PAT) was infra-only and left no commit.

## Phase 1 - Vexa + local Whisper

Everything here runs **on the VM itself** (SSH in first) - none of it runs in
a GitHub Actions workflow yet. That starts in phase 3.

```bash
scp -r meeting-capture/vm <vm-host>:~/meeting-capture-vm   # or git pull on the VM
ssh <vm-host>
cd ~/meeting-capture-vm
./setup.sh
```

`setup.sh` clones Vexa pinned to a known tag, starts Vexa Lite with local
Whisper STT (`LOCAL_STT=1`, no external key or GPU), and mints a Vexa API
key. It prints the remaining by-hand steps: save the API key into
`vm/.env` (copy `vm/.env.example` first), then verify:

```bash
make -C ~/vexa/deploy/lite stt-smoke
make -C ~/vexa probe SURFACE=lite
```

To make Vexa survive a stop/start of the VM with no manual steps, install
the systemd unit once (`setup.sh` prints the exact command with its defaults
filled in):

```bash
sudo VEXA_DIR=~/vexa WHISPER_MODEL=Systran/faster-whisper-small.en \
  ./install-service.sh
```

**Gate:** stop the VM, start it again, and confirm Vexa comes back with no
manual steps, then re-run `stt-smoke` and `probe SURFACE=lite`.

**Files:**

| File | Role |
| --- | --- |
| `vm/setup.sh` | One-time (and re-run-safe) install + first start of Vexa Lite |
| `vm/vexa.service` | systemd unit template - start Vexa on boot |
| `vm/install-service.sh` | Fills in `vexa.service`'s placeholders and installs it |
| `vm/.env.example` | Template for `vm/.env` (`ADMIN_TOKEN`, `VEXA_API_KEY`) - never committed |
