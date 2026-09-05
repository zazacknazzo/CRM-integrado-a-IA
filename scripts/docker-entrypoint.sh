#!/bin/sh
set -eu

pnpm db:local
exec pnpm whatsapp:web:prod
