#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.5 or newer is required. Install it from https://nodejs.org/" >&2
  exit 1
fi
exec node --disable-warning=ExperimentalWarning server.js
