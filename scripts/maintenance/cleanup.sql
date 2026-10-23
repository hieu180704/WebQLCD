-- Dọn bộ đếm đăng nhập sai / đăng ký đã hết hiệu lực (data-model mục 5). Chạy hằng đêm cùng backup.
-- Cửa sổ dài nhất là 1 giờ (đăng ký); giữ 1 ngày cho chắc, không xoá dòng đang khoá.
\set ON_ERROR_STOP on
DELETE FROM login_throttles
WHERE window_started_at < now() - interval '1 day'
  AND (locked_until IS NULL OR locked_until < now());
