#!/bin/sh
# Multi-instance OpenCode starter
# Runs N OpenCode instances on internal ports + a Node.js proxy on $PORT
#
# This script is designed to run INSIDE the pilinux/opencode container
# where `opencode` is already installed and working.

INSTANCES=${INSTANCES:-3}
PORT=${PORT:-8080}
BASE_PORT=${BASE_PORT:-9001}
CORS=${CORS_ORIGINS:-"https://palindrome-exercise.vercel.app,https://miguelemosreverte.github.io"}

echo "=== Multi-Instance OpenCode ==="
echo "Instances: $INSTANCES"
echo "Proxy port: $PORT"
echo "Base port: $BASE_PORT"
echo "Arch: $(uname -m)"
echo "OpenCode: $(opencode --version 2>&1 | head -1)"

# Create isolated directories
for i in $(seq 0 $((INSTANCES - 1))); do
  mkdir -p /tmp/workspace-$i /tmp/data-$i
done

# Start OpenCode instances in background
CORS_ARGS=""
IFS=','
for origin in $CORS; do
  CORS_ARGS="$CORS_ARGS --cors $origin"
done
unset IFS

for i in $(seq 0 $((INSTANCES - 1))); do
  IPORT=$((BASE_PORT + i))
  echo "Starting instance $i on port $IPORT (workspace: /tmp/workspace-$i)"

  HOME=/tmp/data-$i \
  XDG_DATA_HOME=/tmp/data-$i/.local/share \
  XDG_CONFIG_HOME=/tmp/data-$i/.config \
  opencode serve \
    --port $IPORT \
    --hostname 127.0.0.1 \
    --print-logs \
    $CORS_ARGS \
    &
done

echo "Waiting for instances to boot..."
sleep 5

# Check which instances are up
for i in $(seq 0 $((INSTANCES - 1))); do
  IPORT=$((BASE_PORT + i))
  if curl -s http://127.0.0.1:$IPORT/global/health > /dev/null 2>&1; then
    echo "Instance $i (port $IPORT): UP"
  else
    echo "Instance $i (port $IPORT): NOT READY (may still be booting)"
  fi
done

# Start the Node.js proxy
echo "Starting proxy on port $PORT..."
exec node /app/proxy.js
