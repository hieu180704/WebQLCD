// Hook I/O Adapter — CLAUDE CODE (.claude/hooks/hook-adapter.js)
// Bản độc lập, chỉ phục vụ Claude Code. KHÔNG dò engine, KHÔNG dùng chung với engine khác.
// Hợp đồng I/O tham chiếu: https://code.claude.com/docs/en/hooks
//
// Vào : stdin JSON payload PHẲNG — tool_name, tool_input, cwd, hook_event_name.
// Ra  : deny  -> stderr + exit 2 (hard block, không thể bị JSON allow override).
//       ask   -> stdout JSON hookSpecificOutput.permissionDecision='ask' + exit 0.
//       allow -> exit 0 (im lặng).

const fs = require('fs');

const ENGINE = 'claude';
// Hằng số engine dùng chung cho các hook logic — nhờ vậy hook logic giống hệt nhau ở cả 3 engine.
const ENGINE_DIR = '.claude';
const REGISTRY_FILE = '.claude/settings.json';
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
  return [];
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
  console.error(reason);
  process.exit(2);
}

function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    })
  );
  console.error(reason);
  process.exit(0);
}

function allow() {
  process.exit(0);
}

function injectContext(text, eventName = 'PreToolUse') {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: text,
      },
    })
  );
  process.exit(0);
}

function blockingError(text) {
  console.error(text);
  process.exit(2);
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
