// Universal Safety Guard Hook — PreToolUse
// Hỗ trợ đồng thời: Codex, Claude Code & Antigravity IDE (Gemini)

const { ENGINE_DIR, parseContext, deny, allow, normalizePath } = require('./hook-adapter');

const SENSITIVE_PATTERNS = [
  /(^|\/)\.env(?!\.(?:example|sample|template|dist)$)(\.[^/]*)?$/i, // file env mẫu không chứa secret thật
  /(^|\/)id_rsa/i,
  /\.pem$/i,
  /(^|\/)credentials\.json$/i,
  /(^|\/)secrets?(\/|\.|$)/i,
];

const COMMAND_PATTERNS = [
  /(^|\/)\.env(?!\.(?:example|sample|template|dist)$)(\.[^/]*)?$/i, // file env mẫu không chứa secret thật
  /(^|\/)id_rsa/i,
  /\.pem$/i,
  /(^|\/)credentials\.json$/i,
  /(^|\/)secrets?\//i,
];

const MESSAGE_FLAGS = /^(-m|-am|--message)$/;

function commandTargets(command) {
  const targets = [];
  const token = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  let skipNext = false;

  while ((match = token.exec(command)) !== null) {
    const value = match[1] !== undefined ? match[1] : (match[2] !== undefined ? match[2] : match[3]);

    if (skipNext) { skipNext = false; continue; }
    if (MESSAGE_FLAGS.test(value)) { skipNext = true; continue; }

    for (const part of value.split('=')) {
      const cleaned = part.replace(/^[<>@|&$()]+/, '');
      if (cleaned) targets.push(cleaned);
    }
  }

  return targets;
}

const context = parseContext();

if (process.env.AI_HOOKS_DISABLE || process.env.SAFETY_GUARD_DISABLE) {
  allow();
}

for (const target of context.filePaths) {
  const value = normalizePath(target);
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(value))) {
    deny(
      `[SAFETY VIOLATION] Thao tác bị chặn trên "${target}": không được đọc/ghi trực tiếp ` +
      `file chứa thông tin nhạy cảm/bảo mật. Nếu thực sự cần, hãy chỉnh tay hoặc gỡ pattern trong ${ENGINE_DIR}/hooks/safety-guard.js.`
    );
  }
}

for (const command of context.commands) {
  if (/^\s*(rm|del|Remove-Item)\s+(-rf|-r|-force|\/s|\/q)/i.test(command)) {
    if (/\s+(\/|c:\\|\.\.|\*)\s*$/i.test(command)) {
      deny(`[SAFETY VIOLATION] Lệnh huỷ diệt diện rộng bị chặn: "${command}".`);
    }
  }

  for (const target of commandTargets(command)) {
    const value = normalizePath(target);
    if (COMMAND_PATTERNS.some((pattern) => pattern.test(value))) {
      deny(
        `[SAFETY VIOLATION] Thao tác bị chặn trên "${target}" (trong chuỗi lệnh): không được thao tác trực tiếp ` +
        'file chứa thông tin nhạy cảm/bảo mật.'
      );
    }
  }
}

allow();
