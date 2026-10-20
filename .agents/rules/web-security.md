---
trigger: glob
globs: src/**, drizzle/**, next.config.*, proxy.ts
---

# Luật Bảo Mật Web

Lý do, threat model, phân loại dữ liệu: `Docs/SourceOfTruth/Security/security-spec.txt`.

## Bắt buộc
- **Tách dữ liệu cửa hàng:**
  - `shop_id` chỉ lấy từ session.
  - Repository tự lọc theo `shop_id`.
  - Mỗi repository có test chứng minh cửa hàng A không đọc/sửa được dữ liệu cửa hàng B.
- **Phân quyền tại từng server action / use case:** kiểm tra session + vai trò + trạng thái thuê bao qua guard dùng chung.
- **CCCD:** mã hoá ở DB (cột mã hoá + cột hash để tìm khớp chính xác). Danh sách hiển thị che bớt CCCD, SĐT.
- **Validate:** mọi input từ client qua Zod tại lớp `presentation`.
- **Mật khẩu:** băm argon2id.
- **Đăng nhập:** giới hạn số lần sai theo tài khoản + IP.
- **Cookie phiên:** `HttpOnly`, `Secure`, `SameSite=Lax` trở lên.
- **Module chỉ chạy phía server:** `import 'server-only'`.
- **Header bảo mật:** CSP, HSTS, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`. CSP dùng nonce sinh ở `src/proxy.ts`; `script-src` không có `'unsafe-inline'`.
- **Xuất Excel:** chỉ chủ tiệm. Ô bắt đầu bằng `=`, `+`, `-`, `@` thì thêm `'` phía trước.
- **Audit:** thao tác đổi tiền ghi người thực hiện + thời điểm vào sổ giao dịch `cashbook`.
- **Backup:** mã hoá file backup.
- **Dependency:** ghim version, commit lockfile, `npm audit` chạy trong CI.

## Cấm
- Nhận `shop_id`, `user_id`, vai trò, giá tiền đã tính từ input của client.
- Chỉ dựa vào `proxy.ts` (trước Next 16 tên là `middleware.ts`) để phân quyền (từng có CVE-2025-29927 bỏ qua middleware).
- Nối chuỗi SQL; dùng `sql.raw` với dữ liệu người dùng.
- Ghi CCCD, SĐT, mật khẩu, token vào log hoặc thông báo lỗi trả về client.
- Đặt secret trong biến `NEXT_PUBLIC_*` hoặc commit file `.env`.
- Trả stack trace hoặc lỗi DB thô cho client.
- Hard delete hợp đồng hoặc giao dịch (dùng soft delete + bút toán đảo).
