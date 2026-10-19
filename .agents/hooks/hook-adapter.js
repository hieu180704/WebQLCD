// Hook I/O Adapter — ANTIGRAVITY IDE (.agents/hooks/hook-adapter.js)
// Bản độc lập, chỉ phục vụ Antigravity. KHÔNG dò engine, KHÔNG dùng chung với engine khác.
// Hợp đồng I/O tham chiếu: https://antigravity.google/docs/hooks/
//
// Vào : stdin JSON payload LỒNG — toolCall.name, toolCall.args, workspacePaths.
// Ra  : luôn luôn JSON ra stdout + exit 0.
//       decision hợp lệ: allow | deny | ask | force_ask | deny_unless_prior_grant.

const fs = require('fs');

const ENGINE = 'antigravity';
// Hằng số engine dùng chung cho các hook logic — nhờ vậy hook logic giống hệt nhau ở cả 3 engine.
const ENGINE_DIR = '.agents';
const REGISTRY_FILE = '.agents/hooks.json';
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

  if (data && typeof data === 'object' && data.toolCall) {
    toolName = data.toolCall.name || '';
    const args = data.toolCall.args || {};

    if (Array.isArray(data.workspacePaths) && data.workspacePaths.length > 0) {
      cwd = data.workspacePaths[0];
    }

    for (const key of ['TargetFile', 'AbsolutePath', 'SearchPath', 'DirectoryPath', 'Url']) {
      if (typeof args[key] === 'string' && args[key]) {
        filePaths.push(args[key]);
      }
    }
    if (Array.isArray(args.ImagePaths)) {
      for (const p of args.ImagePaths) if (typeof p === 'string') filePaths.push(p);
    }
    if (Array.isArray(args.MediaPaths)) {
      for (const p of args.MediaPaths) if (typeof p === 'string') filePaths.push(p);
    }

    if (typeof args.CommandLine === 'string' && args.CommandLine) {
      commands.push(args.CommandLine);
    }
    if (args.Cwd) cwd = args.Cwd;
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
  console.log(JSON.stringify({ decision: 'deny', reason }));
  process.exit(0);
}

function ask(reason) {
  console.log(JSON.stringify({ decision: 'ask', reason }));
  process.exit(0);
}

function allow(responseObj) {
  console.log(JSON.stringify(responseObj !== undefined ? responseObj : { decision: 'allow' }));
  process.exit(0);
}

function injectContext(text) {
  console.log(JSON.stringify({ decision: 'allow', reason: text }));
  process.exit(0);
}

function blockingError(text) {
  console.error(text);
  console.log('{}');
  process.exit(0);
}

// PostToolUse không có gì để báo — Antigravity vẫn cần JSON trên stdout.
function postToolOk() {
  console.log('{}');
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
