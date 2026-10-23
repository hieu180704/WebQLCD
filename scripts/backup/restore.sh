#!/usr/bin/env bash
# Khôi phục một bản sao lưu vào DB MỚI rồi chạy đối soát (verify-restore.sql). Không ghi vào DB đã có bảng.
# Dùng: restore.sh <file.dump.gpg> <chuỗi kết nối DB đích, rỗng>
# Private key phải nằm trong keyring gpg của người chạy (gpg --import) hoặc GNUPGHOME trỏ tới keyring có key.
# Các role sở hữu bảng phải tồn tại sẵn trên cụm PostgreSQL đích.
# PG_BIN: tuỳ chọn, tiền tố đường dẫn pg_restore/psql (dev Windows: .local/pgsql/bin/).
set -euo pipefail

[ $# -eq 2 ] || { echo "Dùng: restore.sh <file.dump.gpg> <url DB đích>" >&2; exit 1; }
file="$1"
target="$2"
[ -r "$file" ] || { echo "Không đọc được $file" >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"

tables="$("${PG_BIN:-}psql" --no-password --dbname="$target" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
[ "$tables" = "0" ] || { echo "DB đích đã có $tables bảng, dừng để tránh ghi đè" >&2; exit 1; }

# Một transaction: lỗi giữa chừng thì DB đích vẫn rỗng.
gpg --quiet --decrypt "$file" \
  | "${PG_BIN:-}pg_restore" --no-password --exit-on-error --single-transaction --dbname="$target"
echo "Đã khôi phục $file"

"${PG_BIN:-}psql" --no-password --dbname="$target" --quiet --file="$here/verify-restore.sql"
