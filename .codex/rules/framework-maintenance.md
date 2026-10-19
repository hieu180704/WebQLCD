# Luật Bảo Trì Framework & Hạn Mức Tài Liệu

Rule theo ngữ cảnh: Claude Code (`paths:`) và Antigravity (`globs:`) chỉ nạp khi đụng thư mục engine, `Docs/` hoặc `AGENTS.md`. Bản Codex không có frontmatter nên không lazy-load được.

- **Hạn mức chia theo tần suất nạp**, không phải một con số phẳng. Mọi con số nằm ở hằng số đầu `.codex/hooks/doc-budget.js` — nguồn chân lý duy nhất, cố tình không chép sang đây. Hook chạy `PostToolUse` sau mỗi `Write`/`Edit`, kêu ngay tại chỗ chứ không đợi lúc commit.
- **Ratchet:** file cũ đã quá hạn mức chỉ bị chặn khi lần sửa làm nó **dài thêm**; sửa cho ngắn lại luôn được qua. Vượt có chủ đích thì khai trong 10 dòng đầu file: `# BUDGET-EXEMPT: <lý do> — <ai duyệt> <YYYY-MM-DD>`.
- **Chạm trần always-on là tín hiệu phải CẮT, không phải tín hiệu nâng trần.** Nâng số trong hook chỉ khi có lý do ghi ở `Docs/Decisions/`.
- **Một luật chỉ viết đầy đủ ở một nơi.** `.codex/rules/` giữ câu luật, bảng tra, danh sách cấm. `Docs/Decisions/` giữ lý do, bằng chứng, phương án bị loại, kết quả đo, điều kiện biên. Rule trỏ memo bằng một dòng, không chép lập luận của memo sang. Luật do chính rule đặt ra mà memo chưa có thì viết đủ ở rule.
- **Mọi script trong thư mục hooks của engine bắt buộc khai trong file đăng ký hook của engine đó (xem dòng Hooks trong bảng mục "Bản Đồ Hệ Thống AI" của `AGENTS.md`).** Không khai thì không bao giờ tự chạy — quy ước suông đội lốt cưỡng chế. `doc-budget.js` tự kiểm điều này.
