#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_dir=${1:?Usage: scripts/restore.sh /absolute/backup/directory --replace}
[[ ${2:-} == --replace ]] || { echo 'Restore replaces this deployment. Supply --replace explicitly.' >&2; exit 1; }
backup_dir=$(cd "$backup_dir" && pwd)
(cd "$backup_dir" && shasum -a 256 -c SHA256SUMS)
docker compose stop web worker
docker compose exec -T postgres dropdb --force -U harvester harvester
docker compose exec -T postgres createdb -U harvester harvester
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U harvester harvester < "$backup_dir/database.sql"
docker compose run --rm --no-deps -T worker node -e 'const fs=require("fs"); for(const x of fs.readdirSync("/data/library"))fs.rmSync("/data/library/"+x,{recursive:true,force:true});'
docker compose run --rm --no-deps -T worker tar -C /data/library -xf - < "$backup_dir/library.tar"
docker compose run --rm --no-deps -T worker pnpm --filter @harvester/core exec tsx src/verify-assets.ts
docker compose start web worker
echo 'Restore completed and asset checksums verified.'
