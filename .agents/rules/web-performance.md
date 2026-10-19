---
trigger: glob
globs: src/**, drizzle/**, next.config.*
---

# Luật Hiệu Năng Web

Chỉ tiêu, cách đo, quy trình xử lý khi chậm: `Docs/SourceOfTruth/Performance/performance-spec.txt`.

## Bắt buộc
- **Client JS tối thiểu:** mặc định Server Components; `"use client"` chỉ cho đúng component lá cần tương tác.
- **Danh sách:** phân trang phía server (limit + cursor hoặc offset có giới hạn).
- **Index:** mọi truy vấn lọc theo cửa hàng có index bắt đầu bằng `shop_id`; thêm cột lọc/sắp xếp phía sau theo truy vấn thực tế.
- **Tìm kiếm** tên, SĐT, mã hợp đồng: index `pg_trgm`.
- **Báo cáo:** tổng hợp bằng SQL (`SUM`, `COUNT`, `GROUP BY`).
- **Dữ liệu liên quan:** tải bằng join hoặc một truy vấn `IN (...)`.
- **Cột:** chỉ chọn cột cần dùng.
- **Cache:** landing page render tĩnh; trang quản lý luôn đọc dữ liệu mới (`dynamic`, không cache).
- **Xuất Excel:** streaming theo lô.
- **DB:** kết nối qua pool, một pool dùng chung cho toàn ứng dụng.
- **Tài nguyên tĩnh:** ảnh qua `next/image`, font qua `next/font`.
- **Đo trước khi tối ưu:** truy vấn nghi chậm → `EXPLAIN ANALYZE`; trang → Lighthouse; đo lại sau khi sửa.

## Cấm
- Tải toàn bộ bảng về rồi lọc, phân trang hoặc cộng tiền bằng JS.
- Truy vấn trong vòng lặp (N+1).
- `SELECT *` trong code ứng dụng.
- `LIKE '%x%'` trên cột không có index trigram.
- Đặt cả trang hoặc layout là `"use client"`.
- Thêm thư viện client lớn khi chưa kiểm tra kích thước bundle.
- Dựng toàn bộ file Excel lớn trong RAM.
