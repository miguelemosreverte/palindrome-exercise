#!/bin/sh
echo "=== Diagnostics ==="
echo "Arch: $(uname -m)"
echo "Node: $(node --version)"
echo "OpenCode: $(which opencode)"
echo "OpenCode version: $(opencode --version 2>&1 | head -1)"
echo "Searching for binary..."
find /usr/local/lib/node_modules -name "opencode-linux-*" -type d 2>/dev/null
echo "=== Starting proxy ==="
exec node /app/proxy.js
