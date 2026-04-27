/**
 * check_market_overview_boundary.js  —  marketOverview ↔ 자동매매 경로 boundary 가드 (ADR-0067)
 *
 * 규칙: `src/services/stock/marketOverview*.ts` 와 `useMarketData` hook 은 UI 전용 SSOT 다.
 *       `server/trading/`, `server/orchestrator/`, `server/scheduler/`, `server/services/aiUniverseService.ts`
 *       등 자동매매·신호 경로는 *반드시* `macroState` (`server/persistence/macroStateRepo.ts`)
 *       만 사용해야 한다. AI hallucinate 가능성이 있는 marketOverview 데이터가 자동매매
 *       결정에 들어가면 안 된다.
 *
 *       차단 경로:
 *         - server/trading/**
 *         - server/orchestrator/**
 *         - server/scheduler/**
 *         - server/services/aiUniverseService.ts (AI 추천 universe — KIS/KRX 격리, ADR-0011)
 *
 *       자동매매 본체에서 marketOverview / useMarketData / useMarketStore import 발견 시 FAIL.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, sep } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

/** 자동매매·신호 경로 — 본 디렉토리/파일에서 marketOverview import 절대 금지. */
const FORBIDDEN_PREFIXES = [
  'server/trading/',
  'server/orchestrator/',
  'server/scheduler/',
];

const FORBIDDEN_EXACT = new Set([
  'server/services/aiUniverseService.ts',
]);

/** marketOverview / useMarketData / useMarketStore import 패턴. */
const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"][^'"]*marketOverview['"]/,
  /from\s+['"][^'"]*marketOverviewCache['"]/,
  /from\s+['"][^'"]*marketOverviewIndicators['"]/,
  /from\s+['"][^'"]*useMarketData['"]/,
  /from\s+['"][^'"]*useMarketStore['"]/,
  /import\s*\(\s*['"][^'"]*marketOverview['"]/,
];

function shouldCheckFile(relPath) {
  if (FORBIDDEN_EXACT.has(relPath)) return true;
  return FORBIDDEN_PREFIXES.some(prefix => relPath.startsWith(prefix));
}

function walkDir(dir, base) {
  const out = [];
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkDir(full, base));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      const rel = full.slice(base.length + 1).split(sep).join('/');
      out.push(rel);
    }
  }
  return out;
}

function checkFile(absPath, relPath) {
  const src = readFileSync(absPath, 'utf-8');
  const lines = src.split('\n');
  const violations = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // 주석 라인 무시 (단일 라인 주석 + 블록 주석 라인 prefix)
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    for (const pat of FORBIDDEN_IMPORT_PATTERNS) {
      if (pat.test(line)) {
        violations.push({ relPath, lineNo: i + 1, line: trimmed });
        break;
      }
    }
  }
  return violations;
}

function main() {
  const candidates = [];
  const serverDir = join(ROOT, 'server');
  candidates.push(...walkDir(serverDir, ROOT));

  const violations = [];
  let scannedCount = 0;
  for (const relPath of candidates) {
    if (!shouldCheckFile(relPath)) continue;
    scannedCount += 1;
    const v = checkFile(join(ROOT, relPath), relPath);
    violations.push(...v);
  }

  if (violations.length > 0) {
    console.error('[MarketOverviewBoundary] ❌ 자동매매 경로에서 marketOverview / useMarketData import 발견');
    console.error('  ADR-0067: 자동매매·신호 경로는 macroState (server/persistence/macroStateRepo.ts) 만 사용해야 합니다.');
    console.error('  marketOverview 는 AI hallucinate 가능성이 있는 UI 전용 SSOT 입니다.\n');
    for (const v of violations) {
      console.error(`  ${v.relPath}:${v.lineNo}`);
      console.error(`    ${v.line}`);
    }
    console.error(`\n  총 ${violations.length}건 위반`);
    process.exit(1);
  }

  console.log(`[MarketOverviewBoundary] OK — ${scannedCount}개 파일 검사, marketOverview 누출 없음`);
}

main();
