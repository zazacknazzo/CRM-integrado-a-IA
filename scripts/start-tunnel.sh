#!/bin/sh
set -eu

port="${PORT:-3000}"

if command -v cloudflared >/dev/null 2>&1; then
  exec cloudflared tunnel --url "http://localhost:${port}"
fi

if command -v ngrok >/dev/null 2>&1; then
  exec ngrok http "${port}"
fi

echo "Neither cloudflared nor ngrok is installed." >&2
echo "Install Cloudflare Tunnel from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
exit 1
