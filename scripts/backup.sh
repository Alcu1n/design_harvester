#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_dir=${1:?Usage: scripts/backup.sh /absolute/backup/directory}
mkdir -p "$backup_dir"
backup_dir=$(cd "$backup_dir" && pwd)
if [[ -e "$backup_dir/database.sql" || -e "$backup_dir/library.tar" ]]; then echo 'Backup destination already contains an archive' >&2; exit 1; fi
restart_services() { docker compose start web worker >/dev/null; }
trap restart_services EXIT
docker compose stop web worker
docker compose exec -T postgres pg_dump -U harvester --clean --if-exists harvester > "$backup_dir/database.sql"
docker compose run --rm --no-deps -T worker tar -C /data/library -cf - . > "$backup_dir/library.tar"
(cd "$backup_dir" && shasum -a 256 database.sql library.tar > SHA256SUMS)
echo "Backup saved: $backup_dir"
