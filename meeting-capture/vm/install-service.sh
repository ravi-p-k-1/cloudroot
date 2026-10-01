#!/usr/bin/env bash
# Renders vexa.service (replacing its __PLACEHOLDER__s) and installs it, so
# Vexa Lite comes up on its own after `oci compute instance action --action
# START` - the phase 1 gate. Run with sudo; re-run after changing VEXA_DIR
# or WHISPER_MODEL.
#
# Usage: sudo VEXA_DIR=... WHISPER_MODEL=... ./install-service.sh
# (setup.sh prints the exact invocation to use, with its own defaults filled in)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VEXA_DIR="${VEXA_DIR:-$HOME/vexa}"
WHISPER_MODEL="${WHISPER_MODEL:-Systran/faster-whisper-small.en}"
VEXA_USER="${VEXA_USER:-${SUDO_USER:-$USER}}"

if [[ $EUID -ne 0 ]]; then
  echo "Error: run with sudo (writes to /etc/systemd/system)." >&2
  exit 1
fi

sed -e "s#__VEXA_DIR__#${VEXA_DIR}#g" \
    -e "s#__VEXA_USER__#${VEXA_USER}#g" \
    -e "s#__WHISPER_MODEL__#${WHISPER_MODEL}#g" \
    "$SCRIPT_DIR/vexa.service" > /etc/systemd/system/vexa.service

systemctl daemon-reload
systemctl enable --now vexa.service

echo "Installed and started vexa.service (user=$VEXA_USER, dir=$VEXA_DIR, model=$WHISPER_MODEL)."
echo "Check with: systemctl status vexa.service"
