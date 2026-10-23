#!/usr/bin/env bash
# Sao lưu cả DB: pg_dump (custom format) → mã hoá bằng public key gpg → giữ BACKUP_KEEP bản mới nhất.
# Server chỉ giữ public key; private key cất ngoài server, chỉ dùng khi khôi phục (restore.sh).
#
# Biến môi trường:
#   BACKUP_DATABASE_URL  chuỗi kết nối role đọc được mọi bảng
#   BACKUP_DIR           thư mục chứa bản sao lưu
#   BACKUP_PUBLIC_KEY    file public key gpg (armored hoặc binary)
#   BACKUP_KEEP          số bản giữ lại, mặc định 30 (core-spec mục 2)
#   BACKUP_POST_HOOK     tuỳ chọn: file chạy được, nhận đường dẫn bản vừa tạo làm tham số (chép ra ngoài VPS)
#   PG_BIN               tuỳ chọn: tiền tố đường dẫn pg_dump (dev Windows: .local/pgsql/bin/)
set -euo pipefail

: "${BACKUP_DATABASE_URL:?Thiếu BACKUP_DATABASE_URL}"
: "${BACKUP_DIR:?Thiếu BACKUP_DIR}"
: "${BACKUP_PUBLIC_KEY:?Thiếu BACKUP_PUBLIC_KEY}"
keep="${BACKUP_KEEP:-30}"
[[ "$keep" =~ ^[1-9][0-9]*$ ]] || { echo "BACKUP_KEEP phải là số nguyên dương" >&2; exit 1; }
[ -r "$BACKUP_PUBLIC_KEY" ] || { echo "Không đọc được BACKUP_PUBLIC_KEY" >&2; exit 1; }

umask 077
mkdir -p "$BACKUP_DIR"

# Keyring tạm: --recipient-file không cần import key, không đụng keyring của người chạy.
GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
out="$BACKUP_DIR/webqlcd-$(date -u +%Y%m%dT%H%M%SZ).dump.gpg"
tmp="$out.partial"
trap 'rm -rf "$GNUPGHOME" "$tmp"' EXIT

# Bỏ dữ liệu phiên, token và bộ đếm đăng nhập sai: khôi phục xong mọi người đăng nhập lại.
# Custom format đã nén nên gpg không nén thêm.
"${PG_BIN:-}pg_dump" --format=custom --no-password \
  --exclude-table-data=public.sessions \
  --exclude-table-data=public.verifications \
  --exclude-table-data=public.login_throttles \
  --dbname="$BACKUP_DATABASE_URL" \
  | gpg --batch --quiet --no-tty --trust-model always --compress-algo none \
      --recipient-file "$BACKUP_PUBLIC_KEY" --output "$tmp" --encrypt
mv "$tmp" "$out"
echo "Đã sao lưu: $out ($(wc -c < "$out") byte)"

# Tên file chứa thời điểm UTC nên sắp theo tên là sắp theo thời gian.
ls -1 "$BACKUP_DIR"/webqlcd-*.dump.gpg | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
  rm -f -- "$old"
  echo "Đã xoá bản cũ: $old"
done

if [ -n "${BACKUP_POST_HOOK:-}" ]; then
  "$BACKUP_POST_HOOK" "$out"
fi
