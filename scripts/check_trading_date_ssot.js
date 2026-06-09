/**
 * check_trading_date_ssot.js  —  ADR-0591 Market Truth Layer 날짜 SSOT 가드 (BUG-2026-05-07-001).
 *
 * 규칙: 신호생성 경로(server/trading/signalScanner/**)는 기준일(trading date)을 자체 계산하지 않는다.
 *       `new Date().toISOString().slice(0, 10)` 같은 ad-hoc 날짜키 추출(=UTC 캘린더 날짜)은
 *       휴장일·장전(KST≠UTC)·장마감 경계에서 모듈별 기준일을 어긋나게 해 가짜 Confluence/STRONG_BUY
 *       를 유발한다(BUG-2026-05-07-001 "휴장일 기준일 혼합"). 기준일은 반드시
 *       `resolveTradingContext().effectiveTradingDate` (server/calendar/tradingContext.ts SSOT) 경유.
 *
 *       baseline = 0 (2026-06-09 신호경로 3건 SSOT 주입 완료). 신규 위반 발견 시 [FAIL] + 파일:라인, EXIT 1.
 *       주석 라인(// ...)은 문서 목적이므로 제외. 테스트 파일 제외.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const SCAN_DIR = join(ROOT, 'server', 'trading', 'signalScanner');
const REL_SCAN_DIR = 'server/trading/signalScanner';

// ad-hoc 기준일 추출 안티패턴 — `new Date().toISOString().slice(0, 10)` (공백 변형 허용).
const ANTIPATTERN = /new Date\(\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;

const BASELINE = 0;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(SCAN_DIR)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return; // 주석 제외
    if (ANTIPATTERN.test(line)) {
      violations.push(`${file.slice(ROOT.length + 1)}:${i + 1}  ${line.trim().slice(0, 100)}`);
    }
  });
}

if (violations.length > BASELINE) {
  console.error(
    `\n[TradingDateSSOT] [FAIL] 신호생성 경로 ad-hoc 기준일 ${violations.length}건 (baseline ${BASELINE}) — ${REL_SCAN_DIR}`,
  );
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    '  해결: `new Date().toISOString().slice(0,10)` 대신 `resolveTradingContext().effectiveTradingDate`' +
      ' (server/calendar/tradingContext.ts) 사용 — BUG-2026-05-07-001 기준일 혼합 차단.',
  );
  process.exit(1);
}

console.log(
  `[TradingDateSSOT] OK — ${REL_SCAN_DIR} 신호경로 ad-hoc 기준일 ${violations.length}건 (baseline ${BASELINE}). ` +
    'effectiveTradingDate SSOT 강제 (ADR-0591).',
);
