---
name: kg-add
description: Thêm phân vùng tri thức hoặc viết/sửa KG leaf (rules/kg-<domain>.md) đúng hợp đồng — frontmatter glob theo engine, khung section, dòng Identifiers, pointer contract, đăng ký bảng trong AGENTS.md. Dùng khi user gõ "/kg-add", "thêm phân vùng", "tạo KG leaf", "viết leaf cho domain X".
---

# Kỹ năng /kg-add — Thêm Phân Vùng & Viết KG Leaf

# Mục lục
1. Điều Kiện Tiên Quyết
2. Quy Trình 4 Bước
3. Hợp Đồng Viết KG Leaf
4. Pointer Contract
5. Danh Mục Phân Vùng Gợi Ý

---

## 1. Điều Kiện Tiên Quyết

**LEAF SINH SAU CODE, KHÔNG SINH TRƯỚC.** Leaf trỏ tới code chưa tồn tại là pointer chết ngay từ lúc tạo. Code của phân vùng chưa có → dừng, chỉ tạo Deep Doc ở `Docs/SourceOfTruth/<Domain>/` nếu cần (ví dụ lúc `/init`).

---

## 2. Quy Trình 4 Bước

1. Xác nhận code của phân vùng đã tồn tại và chạy được.
2. Tạo `rules/kg-<domain>.md` trong thư mục engine đang chạy (`.claude/` · `.agents/` · `.codex/`) theo hợp đồng mục 3, glob trỏ đúng thư mục code thật.
3. Phân vùng cần spec sâu → tạo `Docs/SourceOfTruth/<Domain>/` + file spec `.txt` (phân tách `---`), trỏ từ mục `## Deep` của leaf.
4. Thêm/cập nhật một dòng trong bảng **"Phân Vùng Tri Thức"** của `AGENTS.md` — chỉ sau khi file đã có nội dung thật. Rồi chạy `/sync-engines` để chuyển leaf sang 2 engine còn lại.

---

## 3. Hợp Đồng Viết KG Leaf

### a) Frontmatter glob theo engine
Viết theo cú pháp của engine đang chạy; `/sync-engines` tự chuyển sang engine khác (Codex: lột bỏ frontmatter).

```yaml
# Claude Code
---
paths:
  - "src/core/**"
  - "lib/core/**"
---
# Antigravity
---
trigger: glob
globs: src/core/**, lib/core/**
---
```

### b) Khung section cố định
Thứ tự bắt buộc: header `Owns` → `## Identifiers` → `## Cross-domain` (tuỳ chọn) → `## Pattern` (tuỳ chọn) → `## Deep`.

### c) Cách viết dòng `Identifiers`
Phần agent tra nhiều nhất:
- **Vế trái** (trước `->`): từ khoá đời thường, tiếng Việt lẫn tiếng Anh, cách nhau bằng `·` — đúng cách một người sẽ hỏi, không phải tên hàm.
- **Vế phải** (sau `->`): thư mục + class/symbol chính + entry method, kết bằng 1-2 câu mô tả ngắn.
- **Nhãn** cuối dòng: `WHAT` (là gì / nằm đâu) · `HOW` (dùng thế nào) · `WHY` (vì sao thiết kế vậy); ghép được `WHAT/HOW`.

### d) Template rỗng
```text
---
<frontmatter glob theo cú pháp engine, xem mục a>
---
# KG Leaf — <Tên domain>
# Lazy-loaded node của knowledge-graph.md (node-0).
# Owns: <domain này quản lý gì, ranh giới với domain khác>

## Identifiers
<từ khoá 1> · <từ khoá 2> · <TênClass>
   -> <thư mục> (<Symbol chính>, <symbol phụ>). <mô tả ngắn>. <NHÃN>

## Cross-domain
<điểm giao với domain khác> -> kg-<domain-khác>

## Pattern
<quy ước cấu trúc code lặp lại trong domain, nếu có>

## Deep
Docs/SourceOfTruth/<Domain>/<spec>.txt — đọc on-demand khi cần hiểu sâu.
```

---

## 4. Pointer Contract

- **ĐÚNG (bền vững):** THƯ MỤC + TÊN SYMBOL — ví dụ `src/auth/` → `AuthService.Login()`.
- **SAI (dễ lệch):** trỏ theo số dòng — ví dụ `spec-auth.txt:L45-L80`, vì số dòng đổi khi tài liệu cập nhật.
- Leaf trỏ tới **file sống**, không paste code vào leaf.

---

## 5. Danh Mục Phân Vùng Gợi Ý

Chỉ để **tham khảo**, không bắt buộc, không mô tả hiện trạng. Chỉ tạo thư mục khi phân vùng thực sự có nội dung; tên ngoài danh mục hoàn toàn hợp lệ.

| Phân vùng | Dùng khi có | Thư mục đề xuất |
| :--- | :--- | :--- |
| Architecture | Kiến trúc hệ thống, layering, module boundary | `Docs/SourceOfTruth/Architecture/` |
| Core | Logic nghiệp vụ cốt lõi | `Docs/SourceOfTruth/Core/` |
| API | Giao diện lập trình, endpoints, schema | `Docs/SourceOfTruth/API/` |
| Build & Release | Quy trình build, checklist phát hành | `Docs/SourceOfTruth/Build/` |
