#!/usr/bin/env bash
# Vòng lặp chờ tới BACKUP_AT (giờ theo TZ) mỗi ngày rồi chạy backup.sh và dọn login_throttles.
# Dùng vòng lặp thay crond: crond không truyền biến môi trường của container cho job.
# Lỗi một đêm không dừng container; log ra stdout (docker compose logs backup).
set -uo pipefail

at="${BACKUP_AT:-02:00}"
[[ "$at" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "BACKUP_AT phải dạng HH:MM" >&2; exit 1; }

run_once() {
  /opt/webqlcd/backup/backup.sh || echo "LỖI: sao lưu thất bại" >&2
  psql --no-password --dbname="$BACKUP_DATABASE_URL" --quiet --file=/opt/webqlcd/maintenance/cleanup.sql \
    || echo "LỖI: dọn login_throttles thất bại" >&2
}

if [ "${1:-}" = "--now" ]; then
  run_once
  exit 0
fi

while :; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) $at" +%s)
  [ "$next" -gt "$now" ] || next=$((next + 86400))
  echo "Lần sao lưu kế tiếp: $(date -d "@$next" '+%Y-%m-%d %H:%M %Z')"
  sleep $((next - now))
  run_once
done
