---
trigger: always_on
---

# Universal Quality Standards

# Mục lục
1. [Chuẩn Mực Đầu Ra (Output Standards)](#1-chuẩn-mực-đầu-ra-output-standards)
2. [Tư Duy Lập Luận & Kiểm Chứng (Reasoning & Grounding)](#2-tư-duy-lập-luận--kiểm-chứng-reasoning--grounding)
3. [Kỷ Luật Trình Bày & Định Dạng](#3-kỷ-luật-trình-bày--định-dạng)
4. [Bảo Vệ Tính Toàn Vẹn Của Dữ Liệu](#4-bảo-vệ-tính-toàn-vẹn-của-dữ-liệu)

---

# 1. Chuẩn Mực Đầu Ra (Output Standards)
- **Rõ ràng & Trực diện:** Trả lời trực tiếp vào trọng tâm yêu cầu, loại bỏ mở bài rườm rà và các câu sáo rỗng.
- **Hoàn chỉnh 100%:** Tuyệt đối không để lại các phần cắt xén (`// ... phần còn lại giữ nguyên`, `[Nội dung tương tự...]`). Mọi sản phẩm bàn giao phải dùng được ngay.
- **Ngôn ngữ:** Tiếng Việt tự nhiên, mạch lạc (~90%), giữ nguyên thuật ngữ chuyên ngành chuẩn quốc tế bằng tiếng Anh.

---

# 2. Tư Duy Lập Luận & Kiểm Chứng (Reasoning & Grounding)
- **Phân tách Rõ Ràng:**
  - *Sự thật đã kiểm chứng (Verified Facts / Ground Truth):* Thông tin lấy trực tiếp từ tài liệu gốc.
  - *Suy đoán & Đề xuất (Inferences & Recommendations):* Lập luận logic của AI dựa trên cơ sở dữ liệu.
- **Kiểm tra Mâu thuẫn (Contradiction Check):** Trước khi đưa ra kết luận, đối chiếu với các nguyên tắc và bối cảnh đã ghi nhận trong `Docs/SourceOfTruth/`.

---

# 3. Kỷ Luật Trình Bày & Định Dạng
- **Cấu trúc Thứ bậc (Hierarchy):** Sử dụng Heading Markdown hợp lý (`#`, `##`, `###`), có bảng biểu (Table) khi cần so sánh đa chiều.
- **Mục lục:** Tài liệu có từ 3 section trở lên phải có mục lục ở đầu. Đây là luật duy nhất về mục lục, các nơi khác trỏ về đây.
- **Trích dẫn vị trí:** Dùng dạng `path/to/file:line` (đường dẫn tương đối từ root) để người dùng kiểm chứng và mở nhanh.

---

# 4. Bảo Vệ Tính Toàn Vẹn Của Dữ Liệu
- Không tự ý ghi đè lên tài liệu gốc của người dùng khi chưa có sự xác nhận.
- Mọi quyết định quan trọng phải được ghi lại trong `Docs/Decisions/` để phục vụ tra cứu sau này.
