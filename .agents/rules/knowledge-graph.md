---
trigger: always_on
---

# Universal Knowledge Graph Dispatcher (Node-0)

Chỉ chứa routing. Tạo phân vùng hoặc viết KG leaf mới: dùng skill `/kg-add` (hợp đồng leaf, template, quy trình, danh mục gợi ý).

| Tầng | Ở đâu | Nạp khi nào | Chứa gì |
| :--- | :--- | :--- | :--- |
| **0 — Dispatcher** | `.agents/rules/knowledge-graph.md` (file này) | Luôn luôn | Chỉ routing |
| **1 — KG Leaf** | `.agents/rules/kg-<domain>.md` | Lazy — tự nạp khi đụng file khớp glob trong frontmatter | Bản đồ: từ khoá đời thường → đường dẫn + symbol + entry point |
| **2 — Deep Doc** | `Docs/SourceOfTruth/<Domain>/` | Đọc tay khi leaf trỏ tới (mục `## Deep`) | Spec đầy đủ, luồng chi tiết, lý do thiết kế |

- **Bảng phân vùng nằm ở mục "Phân Vùng Tri Thức" của `AGENTS.md`** — bảng duy nhất được tin để định vị tài liệu, chỉ liệt kê phân vùng đã tồn tại trên đĩa.
- Tra bảng rồi đi thẳng tới leaf/doc, không quét workspace. Leaf là bản đồ, chi tiết nằm ở Tầng 2.
- Tri thức tổng quan không thuộc phân vùng nào: `Docs/SourceOfTruth/overview.txt`.
- **Khi bảng rỗng:** đọc thẳng `Docs/SourceOfTruth/`, không đoán đường dẫn.
