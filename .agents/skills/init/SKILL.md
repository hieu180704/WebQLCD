---
name: init
description: Khởi tạo dự án mới: phỏng vấn bối cảnh, điền AGENTS.md và tạo SourceOfTruth.
---

# Kỹ năng /init — Thiết Lập Dự Án & Onboarding

Kỹ năng này được sử dụng khi bắt đầu đưa UniversalAgent vào một dự án mới; dùng `/init` trên nền tảng hỗ trợ slash command hoặc `$init` trong Codex.

---

## Quy Trình 3 Bước Thực Hiện

### Bước 1: Phỏng Vấn Thu Thập Bối Cảnh (3 Câu Cốt Lõi)
Khi được kích hoạt, AI sẽ chủ động hỏi người dùng 3 câu hỏi súc tích (nếu chưa có thông tin trong ngữ cảnh):
1. **Tên dự án & Lĩnh vực hoạt động:** (Ví dụ: Game Unity Indie, Web App, Tự động hoá, Viết truyện, Nghiên cứu...).
2. **Mục tiêu cốt lõi / Tầm nhìn sản phẩm:** (Dự án này giải quyết bài toán gì? Đầu ra kỳ vọng là gì?).
3. **Techstack, Công cụ & Quy chuẩn đặc thù:** (Ngôn ngữ, Framework, Kiến trúc, Ràng buộc hiệu năng hoặc quy tắc riêng nếu có).

---

### Bước 2: Khởi Tạo & Cập Nhật Hệ Thống Tài Liệu
Sau khi người dùng phản hồi, AI sẽ cập nhật ngay các tệp tin sau:
1. **Cập nhật `AGENTS.md`:** Điền tên dự án, mục tiêu, bản đồ ngữ cảnh và quy tắc đặc thù.
2. **Tạo tài liệu gốc `Docs/SourceOfTruth/overview.txt`:**
   - Định dạng chuẩn `.txt` có mục lục ở đầu file.
   - Ghi lại toàn bộ bức tranh tổng quan, kiến trúc/cấu trúc phân hệ và tri thức nền tảng.

3. **Khai báo phân vùng tri thức (Knowledge Graph):**
   - Đối chiếu lĩnh vực dự án với danh mục gợi ý ở mục 5 của skill `/kg-add`.
   - **Chỉ tạo thư mục `Docs/SourceOfTruth/<Domain>/` cho phân vùng dự án thực sự dùng** — không tạo sẵn cả danh mục. Thư mục rỗng làm nhiễu điều hướng và phản tác dụng của Knowledge Graph.
   - Mỗi phân vùng đã tạo: thêm file spec đầu tiên (định dạng `.txt`, có mục lục ở đầu file, gồm 3 mục: Mục Tiêu & Định Nghĩa Cốt Lõi / Quy Chuẩn & Thiết Lập Nền Tảng / Danh Mục Thực Thể & Cấu Trúc) rồi ghi một dòng vào bảng **"Phân Vùng Tri Thức"** của `AGENTS.md`. Cột KG Leaf để `(chưa có)` cho tới khi code của phân vùng tồn tại — khi đó tạo leaf bằng `/kg-add`.
   - Dự án chưa cần phân vùng nào thì để bảng đó nguyên trạng — đừng điền cho có.

---

### Bước 3: Bàn Giao
1. Báo cáo hoàn tất các tệp đã khởi tạo và sẵn sàng nhận nhiệm vụ đầu tiên theo quy trình 4 pha (`explore -> propose -> confirm -> execute`).
