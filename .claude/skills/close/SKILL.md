---
name: close
description: Đóng phiên làm việc, 2 mode — `/close` khi task CHƯA xong (worklog + commit narrow + prompt 4-field cho phiên sau) và `/close done` khi task ĐÃ xong (thêm sync SourceOfTruth/KG, flip STATUS DONE + archive handoff, retrospective). Dùng khi user gõ "/close", "chốt phiên", "tạm nghỉ", "đóng task", "task xong rồi chốt".
---

# Kỹ năng /close — Đóng Phiên Làm Việc

# Mục lục
1. Chọn Mode
2. Quy Trình 4 Bước
3. Worklog Fragment (Docs/Done/)
4. Next-Session Prompt (4-Field)
5. Retrospective (mode done)
6. Kỷ Luật

---

## 1. Chọn Mode

| Mode | Khi nào | Khác biệt |
| :--- | :--- | :--- |
| `/close` (mặc định) | Task chưa xong: hết ngày, tạm nghỉ, context phình to (>100k token) cần mở phiên mới | Không đụng STATUS handoff; luôn sinh next-session prompt |
| `/close done` | Task/milestone xong hẳn: tiêu chí nghiệm thu đạt, verify đã pass | Flip STATUS + archive handoff; retrospective; chỉ sinh prompt khi người dùng yêu cầu |

Không rõ task đã xong hay chưa → hỏi người dùng, không đoán.

---

## 2. Quy Trình 4 Bước

1. **Doc-sync:**
   - Tạo worklog fragment (mục 3).
   - Có đụng kiến trúc/hệ thống: cập nhật `Docs/SourceOfTruth/`.
   - Mode done: bắt buộc rà `Docs/SourceOfTruth/<Domain>/` và KG leaf `rules/kg-<domain>.md` của engine đang chạy (`.claude/` · `.agents/` · `.codex/`); có sửa rule/skill/agent thì chạy `/sync-engines`.
2. **Handoff:**
   - Mode mặc định: tìm `Docs/Handoffs/*.txt` liên quan. Việc vừa làm thuộc một handoff đang dở → cập nhật tiến độ vào đó hoặc nhắc người dùng. KHÔNG flip STATUS.
   - Mode done: đổi dòng trạng thái thành `# STATUS: 🟢 DONE`, rồi `git mv Docs/Handoffs/handoff-<slug>.txt Docs/Handoffs/Archive/` (tạo `Archive/` nếu chưa có). `Docs/Handoffs/` chỉ giữ việc đang dở.
3. **Commit narrow:**
   - Chỉ `git add` file thuộc phạm vi phiên này. Cấm `git add -A`.
   - Trình bày commit message, xin xác nhận trước khi commit. Lấy SHA ngắn (`git rev-parse --short HEAD`) ghi vào báo cáo.
4. **Kết thúc:**
   - Mode mặc định: xuất next-session prompt (mục 4).
   - Mode done: retrospective (mục 5), báo cáo DONE rồi DỪNG. Không tự sinh prompt khi người dùng không yêu cầu.

---

## 3. Worklog Fragment (`Docs/Done/`)

Tên file: `Docs/Done/YYYY-MM-DD-task-slug.txt`

```text
# YYYY-MM-DD: <Tên công việc> — [<trạng thái verify>]

- Commit: <SHA ngắn hoặc 'chưa commit'>
- Đã làm:
  1. ...
  2. ...
- Trạng thái: <xong | đang dở ở bước X, đã verify tới đâu>
- Lưu ý cho phiên sau: ...
```

- Dòng tiêu đề BẮT BUỘC mang trạng thái verify thật: `verified: <cách verify — test pass, chạy thử, review>` · `verify một phần: <phần nào>` · `CHƯA verify`. Phiên sau chỉ đọc dòng này để định vị; ghi mập mờ "đã làm X" gây hiểu nhầm.
- Bug/nợ phát hiện mà chưa sửa: ghi vào handoff hoặc Decision memo, không chôn trong fragment (fragment là nhật ký đóng, hiếm khi được tra lại).

---

## 4. Next-Session Prompt (4-Field)

```text
read:   Docs/Handoffs/handoff-<slug>.txt (hoặc Docs/SourceOfTruth/...txt)
state:  Đã xong bước 1 & 2 (commit abc1234), đang dở bước 3 [tên bước]
action: execute bước 3 (mô tả ngắn hành động tiếp theo)
gate:   bám sát quy chuẩn dự án, verify trước khi kết thúc
```

Session mới nhận prompt này BẮT BUỘC đọc file ở trường `read:` trước câu trả lời đầu tiên.

---

## 5. Retrospective (mode done)

Đánh giá 2-4 dòng:
1. **Hiệu quả:** chỗ nào trôi chảy; chỗ nào nghẽn, tốn token thừa, phải làm lại hoặc hiểu nhầm ý.
2. **Đề xuất cải tiến** `rules/` hay `skills/` của engine để lần sau nhanh hơn — chỉ đề xuất, KHÔNG tự sửa. Không có gì thì ghi *"Task hoàn thành sạch sẽ, không có đề xuất cải tiến thêm"*.

---

## 6. Kỷ Luật

- Không over-scope: `/close` chỉ đóng phiên, không sa đà refactor hay viết văn bản dài.
