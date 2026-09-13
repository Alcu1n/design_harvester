#!/bin/sh
set -eu
rm -f /work/schema-ready
pnpm db:migrate
touch /work/schema-ready
exec pnpm worker
