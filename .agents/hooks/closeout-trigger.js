// Universal Closeout Trigger — nhắc Living Docs trước khi commit
// Hỗ trợ đồng thời: Codex, Claude Code & Antigravity IDE (Gemini)

const { execFileSync } = require('child_process');
const { parseContext, ask, allow } = require('./hook-adapter');

function gitFiles(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    return null;
  }
}

const context = parseContext();
const command = context.commands.length > 0 ? context.commands[0] : '';

if (!/\bgit\s+commit\b/.test(command)) {
  allow();
}

const cwd = context.cwd || process.cwd();
let changed = gitFiles(['diff', '--cached', '--name-only'], cwd);

if (changed === null) {
  allow();
}

// `git commit -a` / `--all` bỏ qua staging area — phải xét luôn cả unstaged.
if (/\s-[a-zA-Z]*a|\s--all\b/.test(command)) {
  const unstaged = gitFiles(['diff', '--name-only'], cwd);
  if (unstaged) changed.push(...unstaged);
}

const reasons = [];

if (!changed.some((file) => file.startsWith('Docs/'))) {
  reasons.push(
    [
      '[LIVING DOCS] Commit này không đụng tới Docs/. Trước khi chốt, rà lại:',
      '  1. Đã cập nhật tài liệu sống tại Docs/SourceOfTruth/ chưa?',
      '  2. Đã tạo worklog fragment Docs/Done/YYYY-MM-DD-task-name.txt chưa?',
      '  3. Quyết định quan trọng đã ghi vào Docs/Decisions/ chưa?',
    ].join('\n')
  );
}

const aiFiles = changed.filter((file) => file.startsWith('.agents/') || file.startsWith('.claude/') || file.startsWith('.codex/'));
if (aiFiles.length > 0) {
  reasons.push(
    [
      '[AI SYNC] Commit này có thay đổi tài nguyên AI (.agents/, .claude/, .codex/):',
      ...aiFiles.slice(0, 5).map((f) => `  - ${f}`),
      'Hãy đảm bảo bạn đã chạy /sync-engines để đồng bộ tri thức sang các engine còn lại!'
    ].join('\n')
  );
}

if (reasons.length === 0) {
  allow();
}

ask(reasons.join('\n\n'));
