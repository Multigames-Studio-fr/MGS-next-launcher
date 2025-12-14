#!/bin/sh
if [ -z "$1" ]; then
  echo "Usage: $0 /path/to/installer [ /path/to/launcher ]"
  exit 2
fi
INSTALLER="$1"
LAUNCHER="$2"

if [ ! -f "$INSTALLER" ]; then
  echo "Installer not found: $INSTALLER"
  exit 2
fi

# Start installer and wait for it to finish when possible
"$INSTALLER" &
PID=$!
if [ -n "$PID" ]; then
  wait "$PID" 2>/dev/null
else
  BASENAME=$(basename "$INSTALLER")
  while pgrep -f "$BASENAME" >/dev/null 2>&1; do sleep 1; done
fi

if [ -n "$LAUNCHER" ]; then
  nohup "$LAUNCHER" >/dev/null 2>&1 &
else
  echo "No launcher path provided; skipping restart."
fi

# Try to remove the wrapper script itself
rm -- "$0" >/dev/null 2>&1 || true
