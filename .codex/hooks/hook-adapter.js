// Hook I/O Adapter — CODEX (.codex/hooks/hook-adapter.js)
// Bản độc lập, chỉ phục vụ Codex. KHÔNG dò engine, KHÔNG dùng chung với engine khác.
// Hợp đồng I/O tham chiếu: https://learn.chatgpt.com/docs/hooks
//
// Vào : stdin JSON payload PHẲNG — tool_name, tool_input, cwd.
//       Codex có tool apply_patch: file path nằm TRONG nội dung command, phải bóc thêm.
// Ra  : top-level JSON hoặc hookSpecificOutput permissionDecision allow/deny.
//
// LƯU Ý VẬN HÀNH: Codex trust theo HASH của handler trong hooks.json. Đổi command
// hoặc matcher phải review lại qua /hooks.

const fs = require('fs');

const ENGINE = 'codex';
// Hằng số engine dùng chung cho các hook logic — nhờ vậy hook logic giống hệt nhau ở cả 3 engine.
const ENGINE_DIR = '.codex';
const REGISTRY_FILE = '.codex/hooks.json';
let cachedContext = null;

function normalizePath(p) {
  if (typeof p !== 'string') return '';
  return p.replace(/\\/g, '/');
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (err) {
    return '';
  }
}

function parsePayload() {
  const raw = readStdin().trim();
  if (!raw) return { raw: '', data: null };
  try {
    return { raw, data: JSON.parse(raw) };
  } catch (err) {
    return { raw, data: null };
  }
}

function extractPatchFilePaths(command) {
  if (typeof command !== 'string' || command.length === 0) return [];

  const paths = [];
  const pattern = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/gm;
  let match;
  while ((match = pattern.exec(command)) !== null) {
    paths.push(match[1]);
  }

  const movePattern = /^\*\*\* Move to:\s*(.+?)\s*$/gm;
  while ((match = movePattern.exec(command)) !== null) {
    paths.push(match[1]);
  }

  return paths;
}

function parseContext() {
  if (cachedContext) return cachedContext;

  const { raw, data } = parsePayload();
  const argvTarget = process.argv[2] || '';

  let toolName = '';
  const filePaths = [];
  const commands = [];
  let cwd = process.cwd();

  if (argvTarget) {
    filePaths.push(argvTarget);
    commands.push(argvTarget);
  }

  if (data && typeof data === 'object') {
    toolName = data.tool_name || '';
    const input = data.tool_input || {};

    if (data.cwd) cwd = data.cwd;

    for (const key of ['file_path', 'filePath', 'path', 'notebook_path', 'url']) {
      if (typeof input[key] === 'string' && input[key]) {
        filePaths.push(input[key]);
      }
    }
    if (typeof input.command === 'string' && input.command) {
      commands.push(input.command);
      if (toolName === 'apply_patch') {
        filePaths.push(...extractPatchFilePaths(input.command));
      }
    }
  } else if (raw) {
    filePaths.push(raw);
  }

  cachedContext = {
    engine: ENGINE,
    toolName,
    filePaths: filePaths.map(normalizePath),
    commands,
    rawPayload: data,
    cwd: normalizePath(cwd),
  };

  return cachedContext;
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
  console.error(reason);
  process.exit(2);
}

function allow() {
  process.exit(0);
}

const ADDITIONAL_CONTEXT_CHAR_LIMIT = 2500 * 4;

function injectContext(text, hookEventName = 'PreToolUse') {
  const safeText =
    typeof text === 'string' && text.length > ADDITIONAL_CONTEXT_CHAR_LIMIT
      ? text.slice(0, ADDITIONAL_CONTEXT_CHAR_LIMIT) + '\n[... đã cắt bớt do vượt giới hạn context của Codex]'
      : text;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName,
        additionalContext: safeText,
      },
    })
  );
  process.exit(0);
}

function blockingError(text) {
  console.error(text);
  process.exit(2);
}

// Codex không hỗ trợ permissionDecision 'ask' — hạ xuống cảnh báo: stderr + additionalContext, không chặn.
function ask(reason) {
  console.error(reason);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: reason,
      },
    })
  );
  process.exit(0);
}

// PostToolUse không có gì để báo.
function postToolOk() {
  process.exit(0);
}

module.exports = {
  ENGINE_DIR,
  REGISTRY_FILE,
  postToolOk,
  parseContext,
  normalizePath,
  extractPatchFilePaths,
  deny,
  ask,
  allow,
  injectContext,
  blockingError,
};
