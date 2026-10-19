// Universal Doc Budget Guard — PostToolUse
// Hỗ trợ đồng thời: Codex, Claude Code & Antigravity IDE (Gemini)
//
// Mục đích: đo độ dài file tài liệu (.md/.txt trong Docs/, .claude/, .agents/, .codex/ hoặc CLAUDE.md/AGENTS.md)
// vừa được ghi, so với hạn mức theo "class nạp" của file đó.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ENGINE_DIR, REGISTRY_FILE, parseContext, normalizePath, allow, blockingError, postToolOk } = require('./hook-adapter');

const HOOKS_DIR = `${ENGINE_DIR}/hooks`;
const HOOK_REGISTRY_EXEMPT = new Set(['hook-adapter.js', 'kg-doctor.js']);

const errorMessages = [];

const ALWAYS_FILE_HARD = 150;
const ALWAYS_SURFACE_WARN = 500;
const ALWAYS_SURFACE_HARD = 660;
const LEAF_HARD = 100;
const LAZY_SOFT = 300;
const LAZY_HARD = 400;
const DECISION_SOFT = 300;
const DECISION_HARD = 500;
const ONDEMAND_SOFT = 300;
const ONDEMAND_HARD = 400;

const LIMITS = {
  'ALWAYS-ON': { hard: ALWAYS_FILE_HARD },
  'LEAF-KG': { hard: LEAF_HARD },
  'LAZY-RULE': { soft: LAZY_SOFT, hard: LAZY_HARD },
  'DECISION': { soft: DECISION_SOFT, hard: DECISION_HARD },
  'ON-DEMAND': { soft: ONDEMAND_SOFT, hard: ONDEMAND_HARD },
};

const MARKER_RE = /^#\s*BUDGET-EXEMPT:\s*(\S.*?)\s+[—-]\s+(\S.*?)\s+(\d{4}-\d{2}-\d{2})\s*$/m;

function toRelativePosix(filePath, root) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  const rel = path.relative(root, absolute);
  return rel.split(path.sep).join('/');
}

function countLines(content) {
  if (content.length === 0) return 0;
  const parts = content.split(/\r?\n/);
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts.length;
}

function findMarker(content) {
  const first10 = content.split(/\r?\n/).slice(0, 10).join('\n');
  const match = MARKER_RE.exec(first10);
  if (!match) return null;
  return { reason: match[1], approver: match[2], date: match[3] };
}

function classify(rel, content) {
  if (rel === 'CLAUDE.md' || rel === 'AGENTS.md') return 'ALWAYS-ON';

  if (/^(\.claude|\.agents|\.codex)\/rules\/[^/]+\.md$/.test(rel)) {
    const first15 = content.split(/\r?\n/).slice(0, 15);
    const hasPaths = first15.some((line) => /^paths:/.test(line) || /^globs:/.test(line));
    if (!hasPaths) return 'ALWAYS-ON';
    const basename = path.posix.basename(rel);
    if (basename.startsWith('kg-')) return 'LEAF-KG';
    return 'LAZY-RULE';
  }

  if (/^Docs\/Done\//.test(rel) || /^Docs\/Handoffs\//.test(rel)) return 'FROZEN';
  if (/^Docs\/Decisions\//.test(rel)) return 'DECISION';

  return 'ON-DEMAND';
}

function isNewFile(root, rel) {
  let output;
  try {
    output = execFileSync(
      'git',
      // --untracked-files=all: mặc định git gộp thư mục untracked thành một dòng "dir/", file mới bên trong sẽ không khớp rel.
      ['-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all', '--', rel],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch (err) {
    return true;
  }

  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    const status = line.slice(0, 2);
    let filePart = line.slice(3);
    const arrowIdx = filePart.indexOf(' -> ');
    if (arrowIdx !== -1) {
      filePart = filePart.slice(arrowIdx + 4);
    }
    filePart = filePart.split(path.sep).join('/');
    if (filePart === rel) {
      return status === '??' || status[0] === 'A';
    }
  }

  return false;
}

function getHeadLineCount(root, rel) {
  try {
    const content = execFileSync(
      'git',
      ['show', `HEAD:${rel}`],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return countLines(content);
  } catch (err) {
    return null;
  }
}

function evaluateFile(cls, lineCount, isNew, marker, root, rel) {
  const limits = LIMITS[cls];
  if (!limits) return null;

  const hard = limits.hard;
  const soft = limits.soft;

  let baseSeverity = 'NONE';
  if (lineCount > hard) {
    baseSeverity = 'HARD';
  } else if (soft != null && lineCount > soft) {
    baseSeverity = 'SOFT';
  }

  if (baseSeverity === 'NONE') return null;

  if (baseSeverity === 'SOFT') {
    return { level: 'WARN', hard, soft, lineCount, marker: null };
  }

  if (cls === 'ALWAYS-ON') {
    if (isNew) {
      if (marker) return { level: 'WARN', hard, soft, lineCount, marker };
      return { level: 'ERROR', hard, soft, lineCount, marker: null };
    }

    const headLines = getHeadLineCount(root, rel);
    if (headLines === null) {
      if (marker) return { level: 'WARN', hard, soft, lineCount, marker };
      return { level: 'ERROR', hard, soft, lineCount, marker: null };
    }

    if (lineCount > headLines) {
      if (marker) return { level: 'WARN', hard, soft, lineCount, marker, headLines };
      return { level: 'ERROR', hard, soft, lineCount, marker: null, headLines };
    }

    return { level: 'NOCU', hard, soft, lineCount, marker: null, headLines };
  }

  if (!isNew) {
    return { level: 'NOCU', hard, soft, lineCount, marker: null };
  }
  if (marker) {
    return { level: 'WARN', hard, soft, lineCount, marker };
  }
  return { level: 'ERROR', hard, soft, lineCount, marker: null };
}

const ACTION_HINTS = {
  'ALWAYS-ON': 'File này nạp lại mỗi phiên; hãy cắt bớt hoặc tách phần hẹp sang file có frontmatter globs:/paths: để nạp theo ngữ cảnh.',
  'LEAF-KG': 'Leaf phải gọn để lazy-load rẻ; hãy tách phần chi tiết sang Docs/SourceOfTruth/<Domain>/ và chỉ giữ con trỏ ở leaf.',
  'LAZY-RULE': 'File có globs:/paths: chỉ nạp theo ngữ cảnh nhưng vẫn nên gọn; cân nhắc tách bớt sang Docs/SourceOfTruth/ hoặc chia nhỏ theo domain.',
  'DECISION': 'Decision memo nên súc tích; phần bối cảnh/bằng chứng dài nên tách sang Docs/SourceOfTruth/ hoặc phụ lục riêng.',
  'ON-DEMAND': 'File chỉ đọc khi cần nhưng vẫn nên gọn; cân nhắc tách nhỏ theo chủ đề.',
};

function formatMarker(marker) {
  return `(được hạ mức nhờ marker BUDGET-EXEMPT: ${marker.reason} — ${marker.approver} ${marker.date})`;
}

function printFileResult(rel, cls, result) {
  const hint = ACTION_HINTS[cls] || '';

  if (result.level === 'ERROR') {
    if (result.headLines != null) {
      errorMessages.push(
        `[DOC BUDGET] LỖI — ${rel} (${cls}): ${result.lineCount} dòng > hạn mức ${result.hard}, ` +
        `và lần sửa này còn làm nó DÀI THÊM (HEAD có ${result.headLines} dòng -> nay ${result.lineCount} dòng). ${hint}`
      );
    } else {
      errorMessages.push(
        `[DOC BUDGET] LỖI — ${rel} (${cls}): ${result.lineCount} dòng > hạn mức ${result.hard}. ${hint}`
      );
    }
    return 'ERROR';
  }

  if (result.level === 'NOCU') {
    if (result.headLines != null) {
      errorMessages.push(
        `[DOC BUDGET] NỢ CŨ — ${rel} (${cls}): ${result.lineCount} dòng > hạn mức ${result.hard}, ` +
        `nhưng lần sửa này không làm nó phình thêm (HEAD có ${result.headLines} dòng -> nay ${result.lineCount} dòng). ` +
        `Nợ được ghi nhận chứ không chặn. ${hint}`
      );
    } else {
      errorMessages.push(
        `[DOC BUDGET] NỢ CŨ — ${rel} (${cls}): ${result.lineCount} dòng > hạn mức ${result.hard}. ` +
        `File đã tồn tại từ trước và vượt hạn mức, không chặn lần sửa này; nên dọn khi tiện. ${hint}`
      );
    }
    return 'NOCU';
  }

  const limitLabel = result.soft != null && result.lineCount <= result.hard
    ? `hạn mức mềm ${result.soft} (trần cứng ${result.hard})`
    : `hạn mức ${result.hard}`;
  const markerNote = result.marker ? ` ${formatMarker(result.marker)}` : '';
  errorMessages.push(
    `[DOC BUDGET] CẢNH BÁO — ${rel} (${cls}): ${result.lineCount} dòng > ${limitLabel}.${markerNote} ${hint}`
  );
  return 'WARN';
}

function scanAlwaysOnSurface(root) {
  const files = [];

  for (const rootFile of ['CLAUDE.md', 'AGENTS.md']) {
    const abs = path.join(root, rootFile);
    try {
      const content = fs.readFileSync(abs, 'utf8');
      files.push({ rel: rootFile, content });
      break; // Chỉ tính 1 file chính làm đại diện surface
    } catch (err) {}
  }

  const rulesDir = path.join(root, ENGINE_DIR, 'rules');
  let entries = [];
  try {
    entries = fs.readdirSync(rulesDir);
  } catch (err) {
    entries = [];
  }

  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const abs = path.join(rulesDir, name);
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      continue;
    }
    const first15 = content.split(/\r?\n/).slice(0, 15);
    const hasPaths = first15.some((line) => /^paths:/.test(line) || /^globs:/.test(line));
    if (hasPaths) continue;
    files.push({ rel: `${ENGINE_DIR}/rules/${name}`, content });
  }

  const results = files.map((f) => ({ rel: f.rel, lines: countLines(f.content) }));
  results.sort((a, b) => b.lines - a.lines);
  const total = results.reduce((sum, r) => sum + r.lines, 0);
  return { total, results };
}

function checkAlwaysOnSurface(root) {
  const { total, results } = scanAlwaysOnSurface(root);
  if (total > ALWAYS_SURFACE_HARD) {
    errorMessages.push(
      `[DOC BUDGET] LỖI — tổng always-on surface hiện tại: ${total} dòng > trần cứng ${ALWAYS_SURFACE_HARD}. ` +
      'Trần này là ratchet chống phình: cách xử lý ĐÚNG là CẮT BỚT nội dung always-on, ' +
      'KHÔNG được nâng trần lên để né lỗi.'
    );
    return 'ERROR';
  }
  if (total > ALWAYS_SURFACE_WARN) {
    const listing = results.map((r) => `  - ${r.rel}: ${r.lines} dòng`).join('\n');
    errorMessages.push(
      `[DOC BUDGET] CẢNH BÁO — tổng always-on surface: ${total} dòng > mục tiêu ${ALWAYS_SURFACE_WARN} ` +
      `(chưa vượt trần cứng ${ALWAYS_SURFACE_HARD}). Chi tiết từng file, sắp giảm dần:\n${listing}`
    );
    return 'WARN';
  }
  return null;
}

function checkHookRegistry(root) {
  let hasError = false;

  const commands = [];
  const cfgAbs = path.join(root, REGISTRY_FILE);
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgAbs, 'utf8'));
    const walk = (node) => {
      if (!node) return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node === 'object') {
        if (typeof node.command === 'string') commands.push(node.command);
        if (typeof node.commandWindows === 'string') commands.push(node.commandWindows);
        Object.values(node).forEach(walk);
      }
    };
    walk(cfg);
  } catch (err) {}

  const hooksDir = path.join(root, HOOKS_DIR);
  let hookScripts = [];
  try {
    hookScripts = fs.readdirSync(hooksDir)
      .filter((name) => (name.endsWith('.js') || name.endsWith('.mjs')) && !HOOK_REGISTRY_EXEMPT.has(name))
      .map((name) => path.join(hooksDir, name));
  } catch (err) {}

  for (const abs of hookScripts) {
    const base = path.basename(abs);
    const referenced = commands.some((cmd) => cmd.includes(base));
    if (!referenced) {
      errorMessages.push(
        `[DOC BUDGET] LỖI — ${base} nằm trong ${HOOKS_DIR}/ nhưng không thấy khai trong ${REGISTRY_FILE}.`
      );
      hasError = true;
    }
  }

  return hasError;
}

function evaluatePath(filePath, root) {
  const rel = toRelativePosix(filePath, root);

  const isHooksFile = rel.startsWith(HOOKS_DIR + '/');
  const isSettingsFile = rel === REGISTRY_FILE;

  if (isHooksFile || isSettingsFile) {
    return checkHookRegistry(root);
  }

  const ext = path.extname(rel).toLowerCase();
  const isDocExt = ext === '.md' || ext === '.txt';
  const inDocsOrAI = rel.startsWith('Docs/') || rel.startsWith('.claude/') || rel.startsWith('.agents/') || rel.startsWith('.codex/');
  const isRootDoc = rel === 'CLAUDE.md' || rel === 'AGENTS.md';

  if (!((isDocExt && inDocsOrAI) || isRootDoc)) {
    return false;
  }

  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  let content;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    return false;
  }

  const cls = classify(rel, content);
  if (cls === 'FROZEN') {
    return false;
  }

  const lineCount = countLines(content);
  const marker = findMarker(content);
  const isNew = isNewFile(root, rel);

  let hasError = false;

  const result = evaluateFile(cls, lineCount, isNew, marker, root, rel);
  if (result) {
    const printedLevel = printFileResult(rel, cls, result);
    if (printedLevel === 'ERROR') hasError = true;
  }

  if (cls === 'ALWAYS-ON') {
    const surfaceLevel = checkAlwaysOnSurface(root);
    if (surfaceLevel === 'ERROR') hasError = true;
  }

  return hasError;
}

function main() {
  const context = parseContext();
  const root = context.cwd || process.cwd();
  const uniquePaths = [...new Set(context.filePaths)];
  let hasError = false;

  for (const filePath of uniquePaths) {
    if (evaluatePath(filePath, root)) hasError = true;
  }

  if (hasError) {
    blockingError(errorMessages.join('\n'));
  } else {
    postToolOk();
  }
}

try {
  main();
} catch (err) {
  process.exit(0);
}
