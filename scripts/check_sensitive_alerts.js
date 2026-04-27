/**
 * check_sensitive_alerts.js  —  채널 발송 메시지의 잔고/자산 키워드 누출 차단 (ADR-0038 §2)
 *
 * 규칙: 채널 발송 함수(`dispatchAlert` / `channelBuySignalEmitted` /
 *       `channelBuyFilled` / `channelSellSignal` / `channelMarketBriefing` /
 *       `channelRegimeChange` / `channelWatchlistAdded` / `channelWatchlistRemoved` /
 *       `channelWatchlistSummary` / `channelGlobalScan` / `channelPerformance`) 를
 *       import 한 파일에서 본문 string literal / template literal 안에 잔고·자산
 *       키워드가 나타나면 FAIL.
 *
 *       민감 정보(잔고/자산/평가손익)는 채널이 아닌 `sendPrivateAlert(...)` 또는
 *       `sendTelegramAlert(...)` (개인 DM) 로만 발송해야 한다.
 *
 * 탐지 키워드 (채널 발송 메시지에 절대 없어야 함):
 *   - 총자산 / 총 자산
 *   - 주문가능현금
 *   - 잔여 현금 / 잔여현금
 *   - 보유자산 / 보유 자산
 *   - 평가손익 (개별 종목 P&L 은 OK, 계좌 전체 평가손익은 NG — 키워드 단순 매칭)
 *
 * 매칭 패턴: 백틱(`...`) / 더블따옴표("...") / 싱글따옴표('...') 안에서만 검사.
 * 주석/JSDoc/식별자(변수명) 등장은 허용. 필드명 정의(`{ 총자산: ... }`) 같은
 * 객체 키도 string literal 이 아니면 허용.
 *
 * 화이트리스트:
 *   - alertRouter.ts (라우팅 SSOT — 검사 대상 아님)
 *   - 본 스크립트 자체 (시그니처 정의)
 *   - .test.ts 파일 (테스트 픽스처)
 *   - server/persona/personaIdentity.ts ("총자산회전율" 같은 분석 어휘 — 채널
 *     발송과 무관, 페르소나 텍스트 SSOT)
 *
 * 사용:
 *   node scripts/check_sensitive_alerts.js
 *   node scripts/check_sensitive_alerts.js --changed
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

const ROOTS = ['src', 'server'];
const EXTS = new Set(['.ts', '.tsx']);
const IGNORED_SUFFIX = ['.d.ts', '.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

// 채널 발송 함수 시그니처 — 이 함수를 import 한 파일만 검사 대상
const CHANNEL_EMITTERS = [
  'dispatchAlert',
  'channelBuySignalEmitted',
  'channelBuyFilled',
  'channelBuySignal',
  'channelSellSignal',
  'channelMarketBriefing',
  'channelRegimeChange',
  'channelWatchlistAdded',
  'channelWatchlistRemoved',
  'channelWatchlistSummary',
  'channelGlobalScan',
  'channelPerformance',
];

// 잔고/자산 키워드 — 채널 발송 메시지에 절대 없어야 함
const SENSITIVE_KEYWORDS = [
  '총자산',
  '총 자산',
  '주문가능현금',
  '잔여 현금',
  '잔여현금',
  '보유자산',
  '보유 자산',
  '평가손익',
];

// SSOT 라우팅 자체 + 본 스크립트는 검사 대상 아님
const ALLOWED_FILES = [
  'server/alerts/alertRouter.ts',
  'server/alerts/telegramClient.ts',
  'scripts/check_sensitive_alerts.js',
  // 페르소나 텍스트 SSOT — "총자산회전율" 같은 분석 어휘 포함
  'server/persona/personaIdentity.ts',
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(p)) && !IGNORED_SUFFIX.some((suf) => p.endsWith(suf))) out.push(p);
  }
  return out;
}

function changedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf-8' });
    return out
      .split('\n')
      .filter((n) => n && EXTS.has(extname(n)) && !IGNORED_SUFFIX.some((suf) => n.endsWith(suf)));
  } catch {
    return [];
  }
}

function stripComments(src) {
  let stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped = stripped.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return stripped;
}

/** 파일이 채널 발송 함수를 import 하는지 검사 */
function importsChannelEmitter(src) {
  const code = stripComments(src);
  // import { ..., dispatchAlert, ... } from '...';
  for (const fn of CHANNEL_EMITTERS) {
    const pattern = new RegExp(`\\bimport\\s+(?:type\\s+)?\\{[^}]*\\b${fn}\\b[^}]*\\}\\s+from`);
    if (pattern.test(code)) return true;
    // 또는 named re-export: export { dispatchAlert }
    const reexport = new RegExp(`\\bexport\\s+\\{[^}]*\\b${fn}\\b[^}]*\\}`);
    if (reexport.test(code)) return true;
  }
  return false;
}

/**
 * 라인 컨텍스트가 채널 발송 메시지가 아닌 것이 명확한 경우 검사 제외.
 * - console.log / console.warn / console.error / console.debug → Railway 서버 로그
 * - throw new Error(...) → 예외 메시지 (Telegram 미전송)
 * - 인라인 opt-out: `// safe-channel-keyword` (해당 라인 또는 직전 라인)
 */
function isExcludedLineContext(rawLines, idx) {
  const line = rawLines[idx] ?? '';
  if (/\bconsole\.(log|warn|error|debug|info)\s*\(/.test(line)) return true;
  if (/\bthrow\s+new\s+(Error|TypeError|RangeError|RuntimeError)\s*\(/.test(line)) return true;
  if (/\bsafe-channel-keyword\b/.test(line)) return true;
  // 직전 라인의 주석 opt-out 도 허용
  if (idx > 0 && /\bsafe-channel-keyword\b/.test(rawLines[idx - 1] ?? '')) return true;
  return false;
}

/** string/template literal 안의 잔고 키워드 탐지 */
function findSensitiveLeaks(src) {
  const rawLines = src.split('\n');
  const stripped = stripComments(src);
  const lines = stripped.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const hasQuote = /["'`]/.test(line);
    if (!hasQuote) continue;
    if (isExcludedLineContext(rawLines, i)) continue;
    for (const kw of SENSITIVE_KEYWORDS) {
      const re = new RegExp(`["'\`][^"'\`\n]*${kw}[^"'\`\n]*["'\`]`);
      if (re.test(line)) {
        found.push({ line: i + 1, keyword: kw, snippet: line.trim().slice(0, 120) });
      }
    }
  }
  return found;
}

function main() {
  const args = process.argv.slice(2);
  const onlyChanged = args.includes('--changed');

  const files = onlyChanged ? changedFiles() : ROOTS.flatMap((r) => walk(r));
  if (files.length === 0) {
    console.log('[SensitiveAlerts] 검사할 파일 없음');
    return;
  }

  const violations = [];
  let scannedChannelFiles = 0;
  for (const f of files) {
    const norm = f.replace(/\\/g, '/');
    if (ALLOWED_FILES.some((allowed) => norm.endsWith(allowed))) continue;
    const src = readFileSync(f, 'utf-8');
    if (!importsChannelEmitter(src)) continue;
    scannedChannelFiles += 1;
    const leaks = findSensitiveLeaks(src);
    if (leaks.length > 0) violations.push({ f: norm, leaks });
  }

  if (violations.length > 0) {
    console.error(
      `[SensitiveAlerts][FAIL] 채널 발송 경로에 잔고/자산 키워드 누출 의심 (${violations.length}건)`,
    );
    console.error(
      `  → 민감 정보는 sendPrivateAlert(...) (개인 DM) 로 발송하거나, 메시지 본문에서 키워드를 제거하세요.`,
    );
    for (const { f, leaks } of violations) {
      console.error(`  - ${f}`);
      for (const { line, keyword, snippet } of leaks) {
        console.error(`      L${line}  [${keyword}]  ${snippet}`);
      }
    }
    process.exit(1);
  }

  console.log(
    `[SensitiveAlerts] OK — ${scannedChannelFiles}/${files.length}개 채널 발송 파일 검사, 잔고 키워드 누출 없음`,
  );
}

main();
