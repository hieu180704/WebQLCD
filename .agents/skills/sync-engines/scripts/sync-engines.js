#!/usr/bin/env node

/**
 * sync-engines.js — Bộ chuyển đổi cơ học và đồng bộ tri thức 3 AI Engine:
 * Antigravity (.agents/) <---> Claude Code (.claude/) <---> Codex CLI (.codex/)
 *
 * Tính năng:
 * - Rules: Giữ nguyên body Markdown, tự transpile Frontmatter phù hợp từng engine.
 * - Skills: Đồng bộ 1-1 giữa .agents/skills/ và .claude/skills/ (Codex đọc ké .agents/skills/).
 * - Subagents: Chuyển đổi giữa Markdown Frontmatter (.md) và TOML (.toml của Codex), map model tier.
 *   Sync từ Codex: tools/model không có trong TOML -> giữ của agent đích hiện có, hoặc suy từ sandbox_mode.
 * - Hooks (--hooks): copy nguyên văn các hook logic (giống hệt nhau ở 3 engine); khác biệt engine
 *   nằm trong hook-adapter.js, script này không bao giờ đụng tới adapter & registry.
 * - File ở đích không còn ở nguồn (orphan): báo cáo; chỉ xoá khi có --prune.
 * - --dry-run: preview. --check: preview và exit 1 nếu có drift (kể cả hooks và orphan).
 */

const fs = require('fs');
const path = require('path');

function findRepoRoot(startDir) {
  let curr = startDir;
  while (curr && curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, '.git'))) return curr;
    curr = path.dirname(curr);
  }
  return path.resolve(startDir, '..', '..', '..', '..');
}

const ROOT = findRepoRoot(__dirname);

const ENGINES = {
  agents: { dir: path.join(ROOT, '.agents'), name: 'Antigravity (.agents/)' },
  claude: { dir: path.join(ROOT, '.claude'), name: 'Claude Code (.claude/)' },
  codex: { dir: path.join(ROOT, '.codex'), name: 'Codex CLI (.codex/)' },
};

// Model mapping giữa Claude và Antigravity
const MODEL_MAP = {
  opus: 'pro',
  sonnet: 'flash',
  pro: 'opus',
  flash: 'sonnet',
};

// Hook scripts dùng chung
const COMMON_HOOK_SCRIPTS = [
  'closeout-trigger.js',
  'doc-budget.js',
  'language-guard.js',
  'safety-guard.js',
];

// Số thay đổi cần làm (ghi / copy / orphan) — --check dựa vào đây để trả exit 1.
let pendingChanges = 0;
let pruneOrphans = false;

// Helper: Đọc text UTF-8
function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return null;
  }
}

// Helper: Ghi text UTF-8
function writeText(filePath, content, dryRun = false) {
  pendingChanges++;
  if (dryRun) {
    console.log(`[DRY-RUN] Ghi file: ${path.relative(ROOT, filePath)}`);
    return true;
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[SYNCED] ${path.relative(ROOT, filePath)}`);
  return true;
}

// Helper: Copy recursive directory
function copyDirRecursive(src, dest, dryRun = false) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest) && !dryRun) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, dryRun);
    } else {
      const srcContent = fs.readFileSync(srcPath);
      let needCopy = true;
      if (fs.existsSync(destPath)) {
        const destContent = fs.readFileSync(destPath);
        if (srcContent.equals(destContent)) {
          needCopy = false;
        }
      }
      if (needCopy) {
        pendingChanges++;
        if (dryRun) {
          console.log(`[DRY-RUN] Copy file: ${path.relative(ROOT, destPath)}`);
        } else {
          fs.writeFileSync(destPath, srcContent);
          console.log(`[SYNCED] ${path.relative(ROOT, destPath)}`);
        }
      }
    }
  }
}

// -------------------------------------------------------------
// 1. RULE PARSER & TRANSPILER
// -------------------------------------------------------------

function parseRule(content) {
  if (!content) return null;
  const lines = content.split(/\r?\n/);
  
  if (lines[0] && lines[0].trim() === '---') {
    let closingIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        closingIndex = i;
        break;
      }
    }
    if (closingIndex !== -1) {
      const frontmatterLines = lines.slice(1, closingIndex);
      const bodyLines = lines.slice(closingIndex + 1);
      
      let description = '';
      let trigger = '';
      let globs = [];

      for (let i = 0; i < frontmatterLines.length; i++) {
        const line = frontmatterLines[i];
        if (/^description:\s*/.test(line)) {
          description = line.replace(/^description:\s*/, '').trim();
        } else if (/^trigger:\s*/.test(line)) {
          trigger = line.replace(/^trigger:\s*/, '').trim();
        } else if (/^globs:\s*/.test(line)) {
          const rawGlobs = line.replace(/^globs:\s*/, '').trim();
          globs = rawGlobs.split(',').map((s) => s.trim()).filter(Boolean);
        } else if (/^paths:\s*$/.test(line)) {
          while (i + 1 < frontmatterLines.length && /^\s*-\s*/.test(frontmatterLines[i + 1])) {
            i++;
            const item = frontmatterLines[i].replace(/^\s*-\s*["']?/, '').replace(/["']?\s*$/, '').trim();
            if (item) globs.push(item);
          }
        }
      }

      let body = bodyLines.join('\n');
      if (body.startsWith('\n')) body = body.replace(/^\n+/, '');

      return {
        hasFrontmatter: true,
        description,
        trigger,
        globs,
        body,
      };
    }
  }

  return {
    hasFrontmatter: false,
    description: '',
    trigger: '',
    globs: [],
    body: content.trimStart(),
  };
}

function renderRule(parsed, targetEngine, sourceEngine) {
  let body = parsed.body;

  if (sourceEngine && targetEngine && sourceEngine !== targetEngine) {
    const fromDir = sourceEngine === 'agents' ? '.agents/' : sourceEngine === 'claude' ? '.claude/' : '.codex/';
    const toDir = targetEngine === 'agents' ? '.agents/' : targetEngine === 'claude' ? '.claude/' : '.codex/';
    body = body.split(fromDir).join(toDir);
  }

  if (targetEngine === 'codex') {
    return body;
  }

  const isAlwaysOn = parsed.globs.length === 0;

  if (targetEngine === 'claude') {
    const fmLines = ['---'];
    let desc = parsed.description;
    if (!desc) {
      const titleMatch = body.match(/^#\s+(.+)$/m);
      desc = titleMatch ? titleMatch[1].trim() : 'Quy chuẩn UniversalAgent';
    }
    fmLines.push(`description: ${desc}`);
    if (!isAlwaysOn) {
      fmLines.push('paths:');
      for (const g of parsed.globs) {
        let mappedGlob = g;
        if (sourceEngine && targetEngine && sourceEngine !== targetEngine) {
          const fromDir = sourceEngine === 'agents' ? '.agents/' : sourceEngine === 'claude' ? '.claude/' : '.codex/';
          const toDir = targetEngine === 'agents' ? '.agents/' : targetEngine === 'claude' ? '.claude/' : '.codex/';
          mappedGlob = mappedGlob.split(fromDir).join(toDir);
        }
        fmLines.push(`  - "${mappedGlob}"`);
      }
    }
    fmLines.push('---', '');
    return fmLines.join('\n') + '\n' + body;
  }

  if (targetEngine === 'agents') {
    const fmLines = ['---'];
    if (isAlwaysOn) {
      fmLines.push('trigger: always_on');
    } else {
      fmLines.push('trigger: glob');
      const mappedGlobs = parsed.globs.map((g) => {
        if (sourceEngine && targetEngine && sourceEngine !== targetEngine) {
          const fromDir = sourceEngine === 'agents' ? '.agents/' : sourceEngine === 'claude' ? '.claude/' : '.codex/';
          const toDir = targetEngine === 'agents' ? '.agents/' : targetEngine === 'claude' ? '.claude/' : '.codex/';
          return g.split(fromDir).join(toDir);
        }
        return g;
      });
      fmLines.push(`globs: ${mappedGlobs.join(', ')}`);
    }
    fmLines.push('---', '');
    return fmLines.join('\n') + '\n' + body;
  }

  return body;
}

// -------------------------------------------------------------
// 2. SUBAGENT PARSER & TRANSPILER
// -------------------------------------------------------------

const TOOLS_READONLY = ['Read', 'Grep', 'Glob'];
const TOOLS_WRITE = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'];
const WRITE_CAPABLE_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

// Đọc chuỗi TOML dạng "..." (có escape \" và \\).
function tomlString(content, key) {
  const match = content.match(new RegExp(`^${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'm'));
  return match ? match[1].replace(/\\(["\\])/g, '$1') : null;
}

function parseAgent(filePath) {
  const content = readText(filePath);
  if (!content) return null;
  const ext = path.extname(filePath);

  if (ext === '.toml') {
    const instructMatch = content.match(/developer_instructions\s*=\s*'''([\s\S]*?)'''/m);

    // TOML của Codex không mang tools/model: để null, renderAgent lấy từ agent đích hoặc suy từ sandbox_mode.
    return {
      name: tomlString(content, 'name') || path.basename(filePath, '.toml'),
      description: tomlString(content, 'description') || '',
      model: tomlString(content, 'model'),
      tools: null,
      sandbox: tomlString(content, 'sandbox_mode'),
      instructions: instructMatch ? instructMatch[1].trim() : '',
      extra: {},
    };
  }

  const lines = content.split(/\r?\n/);
  if (lines[0] && lines[0].trim() === '---') {
    let closing = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        closing = i;
        break;
      }
    }
    if (closing !== -1) {
      const fmLines = lines.slice(1, closing);
      const instructions = lines.slice(closing + 1).join('\n').trim();

      let name = path.basename(filePath, '.md');
      let description = '';
      let model = null;
      const tools = [];
      const extra = {};

      for (let i = 0; i < fmLines.length; i++) {
        const line = fmLines[i];
        if (/^name:\s*/.test(line)) name = line.replace(/^name:\s*/, '').trim();
        else if (/^description:\s*/.test(line)) description = line.replace(/^description:\s*/, '').trim();
        else if (/^model:\s*/.test(line)) model = line.replace(/^model:\s*/, '').trim();
        else if (/^model_tier:\s*/.test(line)) extra.model_tier = line.replace(/^model_tier:\s*/, '').trim();
        else if (/^tools_access:\s*/.test(line)) extra.tools_access = line.replace(/^tools_access:\s*/, '').trim();
        else if (/^tools:\s*$/.test(line)) {
          while (i + 1 < fmLines.length && /^\s*-\s*/.test(fmLines[i + 1])) {
            i++;
            const t = fmLines[i].replace(/^\s*-\s*/, '').trim();
            if (t) tools.push(t);
          }
        }
      }

      return { name, description, model, tools: tools.length ? tools : null, sandbox: null, instructions, extra };
    }
  }

  return null;
}

function resolveTools(parsed, existingTarget) {
  if (parsed.tools) return parsed.tools;
  if (existingTarget && existingTarget.tools) return existingTarget.tools;
  return parsed.sandbox === 'workspace-write' ? TOOLS_WRITE : TOOLS_READONLY;
}

function renderAgent(parsed, targetEngine, existingTarget) {
  const tools = resolveTools(parsed, existingTarget);

  if (targetEngine === 'codex') {
    const sandbox = tools.some((t) => WRITE_CAPABLE_TOOLS.includes(t)) ? 'workspace-write' : 'read-only';
    return [
      `name = "${parsed.name}"`,
      `description = "${parsed.description.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
      `sandbox_mode = "${sandbox}"`,
      `developer_instructions = '''`,
      parsed.instructions,
      `'''`,
      '',
    ].join('\n');
  }

  const model = parsed.model || (existingTarget && existingTarget.model) || 'pro';
  const isLightTier = model === 'flash' || model === 'sonnet';
  let modelTier = parsed.extra && parsed.extra.model_tier;
  let toolsAccess = parsed.extra && parsed.extra.tools_access;

  if (existingTarget && existingTarget.extra) {
    if (!modelTier && existingTarget.extra.model_tier) modelTier = existingTarget.extra.model_tier;
    if (!toolsAccess && existingTarget.extra.tools_access) toolsAccess = existingTarget.extra.tools_access;
  }

  let mappedModel;
  if (targetEngine === 'claude') {
    mappedModel = isLightTier ? 'sonnet' : 'opus';
    if (!modelTier) modelTier = isLightTier ? 'flash' : 'pro';
  } else {
    mappedModel = isLightTier ? 'flash' : 'pro';
  }

  const fmLines = [
    '---',
    `name: ${parsed.name}`,
    `description: ${parsed.description}`,
  ];
  if (targetEngine === 'claude') {
    if (modelTier) fmLines.push(`model_tier: ${modelTier}`);
    if (toolsAccess) fmLines.push(`tools_access: ${toolsAccess}`);
    fmLines.push(`model: ${mappedModel}`);
  }
  fmLines.push('tools:');
  for (const t of tools) {
    fmLines.push(`  - ${t}`);
  }
  if (targetEngine === 'agents') {
    fmLines.push(`model: ${mappedModel}`);
  }
  fmLines.push('---', '', parsed.instructions, '');

  return fmLines.join('\n');
}

// -------------------------------------------------------------
// 3. ORPHAN — file ở đích không còn ở nguồn
// -------------------------------------------------------------

function handleOrphan(destPath, dryRun) {
  pendingChanges++;
  const rel = path.relative(ROOT, destPath);
  if (!pruneOrphans) {
    console.log(`[ORPHAN] ${rel} — không còn ở nguồn; chạy lại với --prune để xoá.`);
    return;
  }
  if (dryRun) {
    console.log(`[DRY-RUN] Xoá: ${rel}`);
    return;
  }
  fs.rmSync(destPath, { recursive: true, force: true });
  console.log(`[PRUNED] ${rel}`);
}

function findDirOrphans(src, dest, dryRun) {
  if (!fs.existsSync(dest)) return;
  for (const entry of fs.readdirSync(dest, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (!fs.existsSync(srcPath)) handleOrphan(destPath, dryRun);
    else if (entry.isDirectory()) findDirOrphans(srcPath, destPath, dryRun);
  }
}

// -------------------------------------------------------------
// 4. CHÍNH SÁCH ĐỒNG BỘ CHÍNH
// -------------------------------------------------------------

function syncRules(sourceEngine, targets, dryRun, stats) {
  console.log(`\n=== [1/3] Đồng Bộ Rules (Nguồn: ${ENGINES[sourceEngine].name}) ===`);
  const srcDir = path.join(ENGINES[sourceEngine].dir, 'rules');
  if (!fs.existsSync(srcDir)) return;

  const ruleFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'));

  for (const file of ruleFiles) {
    const srcPath = path.join(srcDir, file);
    const content = readText(srcPath);
    const parsed = parseRule(content);
    if (!parsed) continue;

    for (const target of targets) {
      const destPath = path.join(ENGINES[target].dir, 'rules', file);
      const destParsed = fs.existsSync(destPath) ? parseRule(readText(destPath)) : null;
      let targetDesc = parsed.description;
      if (!targetDesc && destParsed && destParsed.description) targetDesc = destParsed.description;
      // Rule Codex không có frontmatter: giữ glob của đích, nếu không lazy rule sẽ bị biến thành always-on.
      const targetGlobs = !parsed.hasFrontmatter && destParsed ? destParsed.globs : parsed.globs;

      const ruleToRender = { ...parsed, description: targetDesc, globs: targetGlobs };
      const rendered = renderRule(ruleToRender, target, sourceEngine);
      const existing = readText(destPath);

      if (existing !== rendered) {
        stats.rules++;
        writeText(destPath, rendered, dryRun);
      }
    }
  }

  const sourceSet = new Set(ruleFiles);
  for (const target of targets) {
    const destDir = path.join(ENGINES[target].dir, 'rules');
    if (!fs.existsSync(destDir)) continue;
    for (const file of fs.readdirSync(destDir).filter((f) => f.endsWith('.md'))) {
      if (!sourceSet.has(file)) handleOrphan(path.join(destDir, file), dryRun);
    }
  }
}

function syncSkills(sourceEngine, targets, dryRun, stats) {
  console.log(`\n=== [2/3] Đồng Bộ Skills (Nguồn: ${ENGINES[sourceEngine].name}) ===`);
  const agentsSkills = path.join(ENGINES.agents.dir, 'skills');
  const claudeSkills = path.join(ENGINES.claude.dir, 'skills');

  // Codex đọc chung .agents/skills/, nên nguồn codex coi như nguồn agents.
  const [src, dest] = sourceEngine === 'claude' ? [claudeSkills, agentsSkills] : [agentsSkills, claudeSkills];
  copyDirRecursive(src, dest, dryRun);
  findDirOrphans(src, dest, dryRun);
  stats.skills++;
}

function syncAgents(sourceEngine, targets, dryRun, stats) {
  console.log(`\n=== [3/3] Đồng Bộ Subagents (Nguồn: ${ENGINES[sourceEngine].name}) ===`);
  const srcDir = path.join(ENGINES[sourceEngine].dir, 'agents');
  if (!fs.existsSync(srcDir)) return;

  const agentFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md') || f.endsWith('.toml'));
  const sourceNames = new Set();

  for (const file of agentFiles) {
    const srcPath = path.join(srcDir, file);
    const parsed = parseAgent(srcPath);
    if (!parsed) continue;
    sourceNames.add(parsed.name);

    for (const target of targets) {
      const destExt = target === 'codex' ? '.toml' : '.md';
      const destFile = parsed.name + destExt;
      const destPath = path.join(ENGINES[target].dir, 'agents', destFile);

      const existingParsed = fs.existsSync(destPath) ? parseAgent(destPath) : null;
      const rendered = renderAgent(parsed, target, existingParsed);
      const existing = readText(destPath);

      if (existing !== rendered) {
        stats.agents++;
        writeText(destPath, rendered, dryRun);
      }
    }
  }

  for (const target of targets) {
    const destDir = path.join(ENGINES[target].dir, 'agents');
    if (!fs.existsSync(destDir)) continue;
    const ext = target === 'codex' ? '.toml' : '.md';
    for (const file of fs.readdirSync(destDir).filter((f) => f.endsWith(ext))) {
      if (!sourceNames.has(path.basename(file, ext))) handleOrphan(path.join(destDir, file), dryRun);
    }
  }
}

function syncHooks(sourceEngine, targets, dryRun, stats) {
  console.log(`\n=== [*] Đồng Bộ Hooks Logic (copy nguyên văn) ===`);
  const srcDir = path.join(ENGINES[sourceEngine].dir, 'hooks');
  if (!fs.existsSync(srcDir)) return;

  for (const scriptName of COMMON_HOOK_SCRIPTS) {
    const content = readText(path.join(srcDir, scriptName));
    if (!content) continue;

    for (const target of targets) {
      const destPath = path.join(ENGINES[target].dir, 'hooks', scriptName);
      if (readText(destPath) !== content) {
        stats.hooks++;
        writeText(destPath, content, dryRun);
      }
    }
  }
}

// -------------------------------------------------------------
// 5. MAIN ENTRY POINT
// -------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let sourceEngine = 'agents';
  let dryRun = false;
  let checkOnly = false;
  let includeHooks = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sourceEngine = args[i + 1].toLowerCase();
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--check') {
      checkOnly = true;
      dryRun = true;
    } else if (args[i] === '--hooks') {
      includeHooks = true;
    } else if (args[i] === '--prune') {
      pruneOrphans = true;
    }
  }

  if (!ENGINES[sourceEngine]) {
    console.error(`[ERROR] Engine nguồn không hợp lệ: "${sourceEngine}". Chọn một trong: agents, claude, codex`);
    process.exit(1);
  }

  const targets = Object.keys(ENGINES).filter((e) => e !== sourceEngine);

  console.log('---------------------------------------------------------');
  console.log(`  AI Engine Synchronizer — UniversalAgent`);
  console.log(`  Engine nguồn: ${ENGINES[sourceEngine].name}`);
  console.log(`  Engine đích : ${targets.map((t) => ENGINES[t].name).join(', ')}`);
  console.log(`  Chế độ      : ${dryRun ? (checkOnly ? 'CHECK ONLY' : 'DRY-RUN') : 'LIVE WRITE'}${pruneOrphans ? ' + PRUNE' : ''}`);
  console.log('---------------------------------------------------------');

  const stats = { rules: 0, skills: 0, agents: 0, hooks: 0 };

  syncRules(sourceEngine, targets, dryRun, stats);
  syncSkills(sourceEngine, targets, dryRun, stats);
  syncAgents(sourceEngine, targets, dryRun, stats);

  // --check luôn soát cả hooks, để drift hook không lọt qua cổng kiểm tra.
  if (includeHooks || checkOnly) {
    syncHooks(sourceEngine, targets, dryRun, stats);
  }

  console.log('\n---------------------------------------------------------');
  console.log(`  TỔNG KẾT:`);
  console.log(`  - Rules cập nhật    : ${stats.rules}`);
  console.log(`  - Subagents cập nhật: ${stats.agents}`);
  console.log(`  - Hooks cập nhật    : ${stats.hooks}`);
  console.log(`  - Tổng thay đổi     : ${pendingChanges} (gồm skills và orphan)`);
  console.log('---------------------------------------------------------');

  if (includeHooks && stats.hooks > 0 && !dryRun) {
    console.warn('\n[CẢNH BÁO QUAN TRỌNG VỀ CODEX]:');
    console.warn('Bạn vừa cập nhật script hook. Codex lưu trust theo hash của file.');
    console.warn('BẮT BUỘC mở Codex CLI và gõ lệnh `/hooks` để review và trust lại!\n');
  }

  if (checkOnly) {
    if (pendingChanges > 0) {
      console.error(`\n[DRIFT] Có ${pendingChanges} điểm lệch giữa các engine. Chạy lại không có --check để đồng bộ.`);
      process.exit(1);
    }
    console.log('\n[PASS] 3 engine đồng bộ, không có drift.');
    return;
  }

  console.log(dryRun ? '\n[DRY-RUN] Không ghi gì.' : '\n[PASS] Hoàn tất đồng bộ các AI Engine.');
}

main();
