---
description: Universal Living Docs Policy (Cấu trúc Docs, Định dạng .txt, Worklogs)
---

# Universal Living Docs Policy

# Mục lục
1. [Triết Lý Tài Liệu Sống (Living Docs)](#1-triết-lý-tài-liệu-sống-living-docs)
2. [Cấu Trúc Thư Mục Docs/ Chuẩn](#2-cấu-trúc-thư-mục-docs-chuẩn)
3. [Quy Định Định Dạng File .txt](#3-quy-định-định-dạng-file-txt)
4. [Kỷ Luật Worklog Fragments (Docs/Done/)](#4-kỷ-luật-worklog-fragments-docsdone)

---

# 1. Triết Lý Tài Liệu Sống (Living Docs)
- Tài liệu không phải là bản báo cáo tĩnh viết một lần rồi bỏ xó. Tài liệu là **nguồn chân lý duy nhất (Single Source of Truth)** phản ánh chính xác trạng thái hiện tại của dự án/công việc.
- Bất cứ khi nào có thay đổi về thiết kế, bối cảnh, logic hoặc quy trình: cập nhật tài liệu song song với quá trình thực thi.

---

# 2. Cấu Trúc Thư Mục Docs/ Chuẩn

Bảng thư mục, vai trò và quy tắc sửa đổi nằm ở mục "Bản Đồ Ngữ Cảnh" của `AGENTS.md` — nguồn duy nhất, không chép lại ở đây.

---

# 3. Quy Định Định Dạng File .txt
- **Ưu tiên .txt:** Các tài liệu sống cốt lõi trong `Docs/` ưu tiên lưu dưới định dạng `.txt` để tiết kiệm token và đảm bảo tốc độ đọc/ghi nhanh nhất trên mọi IDE.
- **Cấu trúc chuẩn:** Phân tách các phần bằng đường kẻ `---`; mục lục theo ngưỡng ở mục 3 của `quality-standards.md`.

---

# 4. Kỷ Luật Worklog Fragments (Docs/Done/)
- Khi hoàn tất một đầu việc (task/chương/tính năng), tạo một worklog fragment theo mẫu `Docs/Done/YYYY-MM-DD-task-name.txt`.
- Nội dung fragment tóm tắt: Mục tiêu, những gì đã làm, các file đã thay đổi, và điểm cần lưu ý cho người tiếp quản.
- Hạn mức độ dài, phân vai rule/memo, đăng ký hook: lazy rule `framework-maintenance.md` (tự nạp khi đụng thư mục engine, `Docs/`, `AGENTS.md`).
