# WebQLCD — Agent Workspace Guidelines

Website SaaS quản lý cầm đồ (thương hiệu TP83). Dự án hỗ trợ song song 3 engine AI độc lập: **Antigravity IDE (Gemini)** (`.agents/`), **Claude Code** (`.claude/`), **Codex CLI** (`.codex/`) — mỗi engine giữ bản rule/hook/skill/agent riêng, không phụ thuộc lõi trung lập hay symlinks.

# Mục lục
1. Mục Tiêu Dự Án
2. Quy Tắc Cốt Lõi
3. Bản Đồ Ngữ Cảnh (Docs/)
4. Phân Vùng Tri Thức (Knowledge Graph)
5. Bản Đồ Hệ Thống AI (.claude/ · .agents/ · .codex/)

---

# 1. Mục Tiêu Dự Án

- **Tên:** WebQLCD — Web Quản Lý Cầm Đồ (TP83)
- **Mô tả:** Website cho tiệm cầm đồ quản lý khách hàng và hợp đồng (cầm đồ, tín chấp, trả góp), tính lãi, kiểm soát dòng tiền quỹ két, báo cáo và tra cứu lịch sử giao dịch, backup và xuất Excel. Dùng thử 7 ngày rồi thu phí thuê bao. Techstack: Next.js + TypeScript + PostgreSQL (`Docs/Decisions/2026-10-19-techstack.txt`).

Tài liệu gốc đầy đủ: `Docs/SourceOfTruth/overview.txt`.

---

# 2. Quy Tắc Cốt Lõi

Luật chung nằm ở các rule always-on của engine (`core-protocol.md`, `quality-standards.md`, `doc-policy.md`, `knowledge-graph.md`) — không chép lại ở đây. Mục này chỉ ghi quy tắc riêng của dự án.

- Giao diện chỉ tiếng Việt (giai đoạn hiện tại).
- Dòng tiền: Quỹ đầu két − Tổng chi + Tổng thu = Số tiền cuối ngày; mọi thao tác đổi tiền két phải sinh bản ghi lịch sử giao dịch.
- **Bảo mật & hiệu năng là hai ưu tiên hàng đầu.** Luật: rule `web-security.md`, `web-performance.md` trong thư mục rules của engine (tự nạp khi đụng code). Khi thiết kế (schema, API, màn hình) chưa đụng code: đọc hai rule đó trước.
- Next.js 16 khác nhiều so với dữ liệu huấn luyện của AI: đọc guide trong `node_modules/next/dist/docs/` trước khi viết code Next (`next.config.ts` đặt `agentRules: false` để `next dev` không chèn block tự sinh vào file này).
- Tài liệu dự án viết bằng tiếng Anh? Thêm một dòng đứng riêng, đúng nguyên văn `LANGUAGE-GUARD: off` (không kèm dấu backtick) vào mục này để tắt hook `language-guard`.

---

# 3. Bản Đồ Ngữ Cảnh (Docs/)

| Thư mục | Vai trò | Quy tắc sửa đổi |
| :--- | :--- | :--- |
| `Docs/SourceOfTruth/` | Tri thức nền, kiến trúc hệ thống | Living (Cập nhật song hành cùng code) |
| `Docs/Decisions/` | Quyết định đã chốt kèm lý do (ADR) | Immutable (Bất biến sau khi chốt) |
| `Docs/QC/` | Tiêu chí nghiệm thu & checklist kiểm thử | Living (Định nghĩa bài test) |
| `Docs/Done/` | Worklog từng phiên | Frozen (Append-only) |
| `Docs/Handoffs/` | Bàn giao giữa các phiên làm việc | Frozen (Append-only) |
| `Docs/prompts/` | Mẫu prompt và kịch bản tái sử dụng | Living |

---

# 4. Phân Vùng Tri Thức (Knowledge Graph)

Bảng định tuyến của `knowledge-graph.md` (mục 2). Chỉ liệt kê phân vùng **đã thực sự tồn tại trên đĩa**; thêm dòng theo quy trình mục 5 của rule đó.

| Phân vùng | KG Leaf | Deep Doc | Nội dung |
| :--- | :--- | :--- | :--- |
| Architecture | *(chưa có)* | `Docs/SourceOfTruth/Architecture/` | Modular monolith, 4 lớp, luật phụ thuộc, danh sách module, cấu trúc thư mục |
| Core | *(chưa có)* | `Docs/SourceOfTruth/Core/` | Nghiệp vụ hợp đồng (cầm đồ, tín chấp, trả góp), quỹ két, giao dịch |
| Performance | *(chưa có)* | `Docs/SourceOfTruth/Performance/` | Ngân sách hiệu năng, cách đo, lý do luật hiệu năng |
| Security | *(chưa có)* | `Docs/SourceOfTruth/Security/` | Threat model, phân loại dữ liệu, lý do luật bảo mật |

---

# 5. Bản Đồ Hệ Thống AI (.claude/ · .agents/ · .codex/)

Ba engine vận hành độc lập, mỗi engine giữ bản rule/skill/agent/hook riêng. Cả ba cùng đọc file `AGENTS.md` này làm entry point duy nhất.

| Thành phần | Claude Code | Antigravity (Gemini) | Codex CLI |
| :--- | :--- | :--- | :--- |
| Rules | `.claude/rules/` — frontmatter `paths:` để lazy-load | `.agents/rules/` — `trigger: always_on` hoặc `trigger: glob` + `globs:` | `.codex/rules/` — Markdown thuần, không frontmatter |
| Skills | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` (dùng chung với Antigravity) |
| Subagents | `.claude/agents/` | `.agents/agents/` | `.codex/agents/` (TOML) |
| Hooks | `.claude/hooks/`, khai trong `.claude/settings.json` | `.agents/hooks/`, khai trong `.agents/hooks.json` | `.codex/hooks/`, khai trong `.codex/hooks.json` |

### Rules
- Always-on: `core-protocol.md`, `quality-standards.md`, `doc-policy.md`, `knowledge-graph.md` (Node-0 Dispatcher).
- Lazy: `framework-maintenance.md` (hạn mức tài liệu, đăng ký hook — nạp khi đụng thư mục engine, `Docs/`, `AGENTS.md`).
- Lazy: `web-security.md`, `web-performance.md` (luật bảo mật, hiệu năng — nạp khi đụng `src/`, `drizzle/`, `next.config.*`; `web-security.md` thêm `proxy.ts`).
- Rule theo ngữ cảnh: khai báo frontmatter đúng cú pháp của từng engine (xem bảng trên).

### Skills
- `/init`: Khởi tạo và phỏng vấn dự án mới.
- `/close`: Đóng phiên khi task chưa xong; `/close done` khi task/milestone đã xong (archive handoff, retrospective).
- `/kg-add`: Thêm phân vùng tri thức, viết KG leaf đúng hợp đồng.
- `/sync-engines`: Đồng bộ tri thức giữa 3 AI Engine.

### Đồng Bộ Đa Engine (`/sync-engines`)
- Khi tạo hoặc sửa Rules, Skills, Subagents ở bất kỳ engine nào, chạy `/sync-engines` với `--source` là engine vừa sửa (`claude` | `agents` | `codex`) để tự động chuyển đổi cú pháp (Frontmatter, TOML, model tier) và cập nhật sang các engine còn lại.
- Ví dụ: `node .claude/skills/sync-engines/scripts/sync-engines.js --source claude` hoặc `node .agents/skills/sync-engines/scripts/sync-engines.js --source agents`.

### Subagents
- 3 vai trò: `adversary` (phản biện phương án), `code-reviewer` (tìm bug, read-only), `research-expert` (điều tra sâu qua KG). Việc viết code, khám phá codebase dùng agent có sẵn của engine.

### Hooks
- `safety-guard.js`: Chặn đọc/ghi file nhạy cảm (`.env`, secrets).
- `closeout-trigger.js`: Nhắc cập nhật Living Docs trước khi commit Git và cảnh báo `/sync-engines`.
- `doc-budget.js`: Kiểm soát ngân sách độ dài tài liệu và kiểm tra khai báo hook registry.
- `language-guard.js`: Đảm bảo văn xuôi trong tài liệu viết bằng tiếng Việt có dấu (≥90%). Dự án tắt được bằng dòng `LANGUAGE-GUARD: off` ở mục 2.
