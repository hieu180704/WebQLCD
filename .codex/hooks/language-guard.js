const fs = require('fs');
const path = require('path');
const { ENGINE_DIR, parseContext, deny, allow, normalizePath } = require('./hook-adapter');

const ENGLISH_FUNCTION_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'by', 'can', 'change',
  'changes', 'do', 'for', 'from', 'if', 'in', 'is', 'it', 'must', 'never', 'not',
  'of', 'on', 'only', 'or', 'read', 'should', 'spawn', 'the', 'this', 'through',
  'to', 'use', 'with', 'without', 'will', 'write'
]);

function isNarrativeDocument(filePath) {
  const value = normalizePath(filePath);
  return value === 'AGENTS.md' ||
    value === 'CLAUDE.md' ||
    /^Docs\/.+\.(?:md|txt)$/i.test(value) ||
    (value.startsWith(ENGINE_DIR + '/') && /^[^/]+\/(?:rules|skills)\/.+\.md$/i.test(value));
}

function extractPatchAdditions(command) {
  if (typeof command !== 'string') return [];
  return command.split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

function extractDirectWriteText(rawPayload) {
  const input = (rawPayload && rawPayload.tool_input) ||
    (rawPayload && rawPayload.toolCall && rawPayload.toolCall.args) ||
    {};
  if (!input || typeof input !== 'object') return [];
  const candidateKeys = ['content', 'text', 'replacement', 'new_string', 'newString', 'Text', 'Content', 'CodeContent', 'ReplacementContent'];
  const texts = [];
  for (const key of candidateKeys) {
    if (typeof input[key] === 'string') texts.push(input[key]);
  }
  return texts;
}

function isTechnicalLine(line, insideFence) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (insideFence) return true;
  if (/^(?:[-*+]|\d+\.)\s*\[[ xX]\]/.test(trimmed)) return false;
  if (/^[A-Z0-9_./\-\\]+$/.test(trimmed)) return true;
  if (/^\|.*\|$/.test(trimmed)) return false;
  if (/^[`#>-]/.test(trimmed)) return false;
  return false;
}

function detectEnglishProse(lines) {
  let insideFence = false;
  let englishHits = 0;
  let sampleLine = '';

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```')) {
      insideFence = !insideFence;
      continue;
    }
    if (isTechnicalLine(rawLine, insideFence)) continue;

    const words = trimmed
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    let lineHits = 0;
    for (const word of words) {
      if (ENGLISH_FUNCTION_WORDS.has(word)) {
        lineHits++;
      }
    }

    if (words.length >= 6 && (lineHits / words.length) >= 0.35) {
      englishHits++;
      if (!sampleLine) sampleLine = trimmed;
    }
  }

  return { englishHits, sampleLine };
}

const context = parseContext();

// Dự án tự tắt hook bằng một dòng `LANGUAGE-GUARD: off` đứng riêng trong AGENTS.md (cho tài liệu tiếng Anh).
function isDisabledByProject(cwd) {
  try {
    return /^\s*(?:[-*]\s*)?LANGUAGE-GUARD:\s*off\s*$/mi.test(fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8'));
  } catch (err) {
    return false;
  }
}
if (isDisabledByProject(context.cwd)) {
  allow();
}
// Engine có thể truyền path tuyệt đối (Claude Code luôn vậy) — quy về path tương đối so với cwd trước khi so khớp.
const toRelative = (filePath) => (path.isAbsolute(filePath) ? normalizePath(path.relative(context.cwd, filePath)) : normalizePath(filePath));
const targets = context.filePaths.map(toRelative).filter(isNarrativeDocument);
if (targets.length === 0) {
  allow();
}

const candidateLines = [];
for (const command of context.commands) {
  candidateLines.push(...extractPatchAdditions(command));
}
for (const text of extractDirectWriteText(context.rawPayload)) {
  candidateLines.push(...text.split(/\r?\n/));
}

if (candidateLines.length === 0) {
  allow();
}

const { englishHits, sampleLine } = detectEnglishProse(candidateLines);
if (englishHits >= 2) {
  deny(
    `[LANGUAGE POLICY VIOLATION] Phát hiện đoạn văn xuôi bằng tiếng Anh trong tài liệu tiếng Việt: "${sampleLine}". ` +
    'Quy định bắt buộc: văn xuôi (prose) trong AGENTS.md, Docs/ và Rules phải viết bằng tiếng Việt có dấu (≥90%).'
  );
}

allow();
