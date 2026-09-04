#!/bin/sh
# Entrypoint for the Home Plot Tracker add-on.
#
# This file must keep LF line endings. With CRLF the kernel reads the shebang as
# "/bin/sh\r", cannot find it, and the container exits immediately with a bare
# "no such file or directory" that names neither this file nor the shell. See
# the repository's .gitattributes.
set -eu

# Bind inside the container only. Nothing is published to the host: reaching the
# app goes through HA ingress, which authenticates the session first.
export HOST=0.0.0.0
export PORT=8099

# Ingress strips its per-session prefix before proxying, so this process sees
# plain "/" and "/api/...". BASE_PATH stays at the root; the client is the side
# that uses relative URLs, and the server injects a matching <base href> from
# the X-Ingress-Path header on each request.
export BASE_PATH=/

# The persistent volume Home Assistant mounts and its backups snapshot. The
# SQLite database lives here so it is included in HA backups for free.
export DATA_DIR=/data

export CLIENT_DIR=/app/client
export SERVE_CLIENT=true
export NODE_ENV=production

mkdir -p "${DATA_DIR}"

echo "[home-plot-tracker] starting on :${PORT}, data in ${DATA_DIR}"

cd /app
# exec, so Node is PID 1 and receives SIGTERM directly when the add-on stops.
# Its shutdown handler closes the database, checkpointing the WAL.
exec node --disable-warning=ExperimentalWarning server/index.js
