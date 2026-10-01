#!/usr/bin/env bash
# Phase 1 of the meeting-capture bot plan (see ../README.md and the full
# plan doc): brings up Vexa Lite with local Whisper STT on this VM, with
# no external transcription key or GPU needed.
#
# Run this on the Oracle VM itself (SSH in, then run it) - it is not run by
# any GitHub Actions workflow. Idempotent: safe to re-run, including after
# `git -C "$VEXA_DIR" fetch` picks up a newer pinned VEXA_REF.
#
# What it does NOT do: open Vexa's API port to the internet (phase 3's
# workflow reaches it over an SSH tunnel instead), or send a bot into a
# meeting (that's phase 2, done by hand, and phase 4, done by the workflow).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VEXA_REPO="https://github.com/Vexa-ai/vexa.git"
# Pinned on purpose, not "latest" - see the plan's "Vexa changes fast" risk
# (v0.12 dropped speaker_events with no notice). Bump deliberately.
VEXA_REF="${VEXA_REF:-v0.12.27}"
VEXA_DIR="${VEXA_DIR:-$HOME/vexa}"
WHISPER_MODEL="${WHISPER_MODEL:-Systran/faster-whisper-small.en}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  echo "Added $USER to the docker group - log out and back in (or run 'newgrp docker'), then re-run this script."
  exit 0
fi

if ! command -v make >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y make git
fi

if [[ -d "$VEXA_DIR/.git" ]]; then
  git -C "$VEXA_DIR" fetch --tags origin
else
  git clone "$VEXA_REPO" "$VEXA_DIR"
fi
git -C "$VEXA_DIR" checkout "$VEXA_REF"

ENV_FILE="$VEXA_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# deploy/lite/README.md: image pull/build is handled by `make ... up` itself
# (a local vexa-lite:dev build wins over pulling vexaai/vexa-lite's published
# tag) - this VM is Oracle's Ampere A1 (arm64), and that published tag isn't
# confirmed multi-arch, so the first run here may take a while building
# locally. That's expected, not a hang.
echo "Starting Vexa Lite with local Whisper STT ($WHISPER_MODEL) on $(uname -m)..."
make -C "$VEXA_DIR/deploy/lite" up LOCAL_STT=1 WHISPER_MODEL="$WHISPER_MODEL"

ADMIN_TOKEN="$(grep -E '^ADMIN_TOKEN=' "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2-)"
if [[ -z "$ADMIN_TOKEN" ]]; then
  echo
  echo "No ADMIN_TOKEN found in $ENV_FILE - the entrypoint mints a random one per boot."
  echo "Find it with: docker logs vexa-lite 2>&1 | grep -i 'admin token'"
  echo "Then mint the Vexa API key by hand:"
  echo "  make -s -C \"$VEXA_DIR\" provision-token ADMIN_TOKEN=<the token above>"
else
  echo
  echo "Minting a Vexa API key..."
  make -s -C "$VEXA_DIR" provision-token ADMIN_TOKEN="$ADMIN_TOKEN"
fi

cat <<EOF

Vexa Lite is up. Remaining one-time steps (by hand):
  1. Copy the printed vxa_... key into $SCRIPT_DIR/.env as VEXA_API_KEY
     (copy .env.example to .env there first if you haven't).
  2. Verify local STT end-to-end:  make -C "$VEXA_DIR/deploy/lite" stt-smoke
  3. Verify the full install:      make -C "$VEXA_DIR" probe SURFACE=lite

To start Vexa on boot with no manual steps, install the systemd unit once:
  sudo VEXA_DIR="$VEXA_DIR" WHISPER_MODEL="$WHISPER_MODEL" \\
    "$SCRIPT_DIR/install-service.sh"
EOF
