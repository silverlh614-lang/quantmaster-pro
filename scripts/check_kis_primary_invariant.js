#!/usr/bin/env node
/**
 * @responsibility KIS(L1) Primary 절대불변식 정적 가드 — 모든 Yahoo(L3)-first 진입(quote 직접호출·직접
 *   URL·.KS/.KQ raw concat·국내심볼 fetchCloses·Yahoo client 직접호출)을 커밋타임 차단(ADR-0561/0562).
 *
 * 사양 SSOT: docs/adr/0562-yahoo-dependency-boundary-lock.md §"가드 확장 사양"(DETECTORS·심볼셋·
 *   WHITELIST(B+D)·GRANDFATHER) + ADR-0561 §"위반 탐지 가드 사양"(계승·강화).
 *   ADR-0563: 실행경로(매수·매도·Gate score) Yahoo burn-down 완료 선언 → GRANDFATHER 7파일/13 hit
 *   (전부 비실행: 학습 귀인·텔레그램 표시·KRX-fallback)을 FROZEN_NON_EXECUTION_ADR0563 으로 동결(추적 유지).
 * 검증 모델: check_ssot_drift_registry.js / check_ssot_single_funnel.js / check_yahoo_symbol_resolver.js
 *   (텍스트 정규식, AST 미사용, allowlist/grandfather, checkFile/export 재사용).
 *
 * 탐지(텍스트 정규식, false positive 최소화 — DETECTORS):
 *   - D-QUOTE   : `fetchYahooQuoteByCode(` · `fetchYahooQuote(` (ADR-0561 기존 2종, 계승).
 *   - D-URL     : `query1/query2.finance.yahoo.com` · `finance.yahoo.com/v8` · `/v10/finance/quoteSummary`
 *                 · `/v10/quoteSummary` 직접 URL 호출(가장 흔한 사각지대).
 *   - D-SUFFIX  : `` `${...}.KS` `` · `` `${...}.KQ` `` raw template concat — Yahoo 국내심볼 합성.
 *                 check_yahoo_symbol_resolver.js(ADR-0444) 의 graceful 인정과 동일 규칙으로 SSOT 위임·
 *                 ADR-marker opt-in 은 제외(중복 차단 회피, 신규 무-opt-in concat 만 위반).
 *   - D-CLOSES-DOMESTIC : `fetchCloses(` 의 1번 인자가 국내심볼 리터럴(^KS11/^KQ11/KRW=X) 일 때만 위반.
 *                 글로벌심볼(^GSPC/^VIX/DX-Y.NYB/=F/EWY 등)은 위반 아님(B2/B4 심볼셋).
 *   - D-CLOSES-VAR : `fetchCloses(<식별자>)` 변수 인자 — 리터럴 분류 불가한 Yahoo close fetch entry.
 *                 위반후보로 점화 → callsite 파일을 WHITELIST(글로벌 전용 globalScan/preMarket)/
 *                 GRANDFATHER(exit 경로 ma60/priceHistory·learning newsSupplyLogger)로 명시 분류(ADR-0562 §FP).
 *                 신규 무-분류 변수-인자 fetchCloses 도메인 호출 = EXIT 1(보수적).
 *   - D-YAHOO-CLIENT : `fetchYahooConsensus(`·`fetchYahooIntradayBars(`·`fetchYahooBundle(`·`fetchYahooSector(`
 *                 Yahoo client 직접호출(정의처 owner 는 WHITELIST 면제, 외부 호출만 검사).
 *   - 주석·import·정의/위임·문자열 리터럴 내부 토큰은 모든 DETECTOR 공통 제외.
 *
 * WHITELIST(영구, ADR-0562 D1 = (B)4 + (D)1 + 라우터/SSOT/policy/research): 파일별 사유 주석. §2 참조.
 * GRANDFATHER_ALLOWLIST(잔존 비실행 동결, 사유 `FROZEN_NON_EXECUTION_ADR0563`): 파일 단위 grandfather
 *   (줄이동 false-fail 방지 — drift_registry 패턴). 라인 번호는 추적 진단 메타. §3 참조.
 *   allowlist/whitelist 외 신규 Yahoo-first = EXIT 1. 두더지잡기 종료(systematic 경계 잠금 완료).
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const SCAN_ROOTS = ['server', 'src'];

/**
 * YAHOO_PRIMARY_PATTERNS — D-QUOTE: Yahoo(L3) quote primary 직접호출 심볼(ADR-0561 계승).
 * 라인에서 `<symbol>(` 형태(호출)로 등장하면 후보. 정의·위임·주석·import 는 별도 제외.
 */
const YAHOO_PRIMARY_PATTERNS = ['fetchYahooQuoteByCode', 'fetchYahooQuote'];

/**
 * D-YAHOO-CLIENT — Yahoo client 직접호출 심볼(ADR-0562 §1). 정의처(owner)는 WHITELIST 면제,
 * 외부 호출만 위반후보. `<symbol>(` 호출 + 정의/주석/import/문자열 제외(D-QUOTE 와 동일 규칙).
 */
const YAHOO_CLIENT_PATTERNS = [
  'fetchYahooConsensus',
  'fetchYahooIntradayBars',
  'fetchYahooBundle',
  'fetchYahooSector',
];

/**
 * DOMESTIC_YAHOO_SYMBOLS — D-CLOSES-DOMESTIC 위반후보 국내심볼(ADR-0562 §1). KIS/ECOS/KRX 대체가능 →
 * fetchCloses 1번 인자가 이 리터럴이면 위반(burn-down 대상). 따옴표 변형 모두 포함.
 */
const DOMESTIC_YAHOO_SYMBOLS = new Set(['^KS11', '^KQ11', 'KRW=X']);

/**
 * GLOBAL_WHITELIST_SYMBOLS — B2/B4 KIS 미커버 글로벌심볼(ADR-0562 §1). fetchCloses 인자가 이 리터럴이면
 * 어느 파일에서도 위반 아님(미국/일본/중국 지수·VIX·DXY·글로벌ETF·선물). FP 제거 핵심.
 */
const GLOBAL_WHITELIST_SYMBOLS = new Set([
  '^GSPC',
  '^IXIC',
  '^DJI',
  '^VIX',
  '^N225',
  '000300.SS',
  'DX-Y.NYB',
  'EWY',
  'SOXX',
  'XLE',
  'WOOD',
  'ITA',
  'GC=F',
  'CL=F',
  'ES=F',
  'NQ=F',
]);

/**
 * WHITELIST — 합법 owner/fallback 파일 전체 면제(ROOT 상대, POSIX). ADR-0562 D1·§2.
 *   value = 사유(파일별 주석 의무). (B)KIS 미커버 영구차용 + (D)ADR-0011 별도경로 +
 *   라우터/SSOT/policy/research(페칭 위임처·정책·연구).
 */
const WHITELIST = new Map([
  // ── (B) KIS 미커버 영구 정당 차용 (ADR-0562 D1) ──
  ['server/clients/yahooConsensusClient.ts', 'B1 컨센서스: KIS 미커버(투자의견/목표주가 endpoint 0).'],
  ['server/routes/yahooConsensusRouter.ts', 'B1 컨센서스 라우터(fetchYahooConsensus 노출, KIS 미커버).'],
  ['server/alerts/dxyIntradayClient.ts', 'B3 DXY: DX-Y.NYB ICE 합성지수 KIS 부재(fetchYahooIntradayBars).'],
  ['server/alerts/dxyMonitor.ts', 'B3 DXY 모니터(fetchCloses DX-Y.NYB/EWY; KRW=X 라인은 C4 burn-down 노트).'],
  ['server/alerts/globalScanAgent.ts', 'B2/B4 미국지수·VIX·글로벌ETF(fetchCloses ^GSPC/^VIX/EWY/SOXX/XLE/WOOD/ITA).'],
  ['server/alerts/preMarketSignal.ts', 'B2/B4 Nikkei·VIX·선물(^N225/ES=F/NQ=F/^VIX) 글로벌 선행.'],
  ['server/alerts/sectorEtfMomentum.ts', 'B4 미국 섹터ETF 30분봉(XLK/XLB/XLE/IYT/XLF) 글로벌 모멘텀.'],
  ['server/trading/macroSectorSync.ts', 'B2 VIX(fetchCloses ^VIX) 글로벌 변동성.'],
  ['src/services/stock/marketOverviewIndicators.ts', 'B2/B4 클라 prefill 글로벌 지수(^GSPC/^N225/CSI300/GC=F/CL=F 등).'],
  ['src/services/stock/enrichment.ts', 'B1 클라 컨센서스 enrichment(fetchYahooConsensus, KIS 미커버).'],
  ['src/api/yahooConsensusClient.ts', 'B1 클라 컨센서스 client(fetchYahooConsensus 본체, KIS 미커버).'],
  // ── (D) ADR-0011 별도 경로 — 자동매매 분리, 발굴용 ──
  ['server/services/quantitativeCandidateGenerator.ts', 'D1 AI추천 Tier3 OHLCV(ADR-0011, 자동매매 import 금지 분리).'],
  // ── 라우터 / SSOT 위임 / provider adapter / policy (페칭 위임처·정책, ADR-0561 D3 계승) ──
  ['server/screener/adapters/technicalQuoteRouter.ts', 'R1 KIS-first 라우터 fallback 위치 Yahoo(합법, ADR-0547).'],
  ['server/trading/exitEngine/helpers/closeSeriesProvider.ts', 'exit 경로 KIS-first 종가 라우터 fallback 위치 Yahoo(합법, ADR-0561 burn-down; flag OFF byte-equal).'],
  ['server/screener/adapters/yahooSymbolResolver.ts', 'fetchYahooQuoteByCode SSOT 위임 본체(.KS/.KQ 합성 SSOT).'],
  ['server/screener/adapters/yahooQuoteAdapter.ts', 'fetchYahooQuote 정의 본체 + per/trailingPE 전용 경로.'],
  ['server/screener/adapters/yahooQuoteSummary.ts', 'PER/PBR/EPS opportunistic enrichment(ENV OFF default, ADR-0536).'],
  ['server/screener/adapters/yahooHistoricalRefresh.ts', 'stale/refresh 도우미(페칭 위임처).'],
  ['server/utils/yahooProbeRetry.ts', 'Yahoo health probe 재시도 SSOT(진단·관측성, 매매 quote 아님, ADR-0056).'],
  ['server/market/yahooHistoricalSnapshotWarmup.ts', 'off-hours historical snapshot warmup 도우미(페칭 위임처).'],
  ['server/routes/marketDataRouter.ts', '브라우저 CORS 우회 market-indicators 프록시 라우트(글로벌 VIX/US10Y 등).'],
  // ── 저수준 fetcher owner — fetchCloses/fetchDailyBars 정의처 + 글로벌심볼 호출(합법). ──
  // 단 동 파일 fetchCloses('KRW=X') (C4)는 burn-down 대상 → GRANDFATHER 로 분류(아래 §3),
  // 따라서 marketDataRefresh 는 WHITELIST 가 아니라 GRANDFATHER 에 등재(파일단위 hit 통과).
  // ── 학습 연구 — Yahoo OHLCV 백테스트(매매·exit 결정 비공급, 연구 전용) ──
  ['server/learning/backtestEngine.ts', '실데이터 백테스트 연구 엔진(Yahoo OHLCV, LIVE 매매·exit 무관).'],
]);

/**
 * GRANDFATHER_ALLOWLIST — 잔존 Yahoo-first 진입(파일:라인 → 사유). ADR-0562 §3 → ADR-0563 동결.
 * 사유 `FROZEN_NON_EXECUTION_ADR0563` — ADR-0563 이 실행경로(매수·매도·Gate score) Yahoo burn-down
 * 완료를 선언하고, 잔존 7파일/13 hit(전부 학습 귀인·텔레그램 표시·KRX-fallback quote = 비실행)을
 * bounded backlog 로 *동결*했다. 두더지잡기 종료 — 일괄·즉흥 마이그레이션 하지 않는다.
 * 재활성(KIS-first 치환)은 shape 별 deliberate ADR(라우터 신설+shadow A/B+회귀) only.
 * 라인 번호는 추적용 진단 메타이며, 매칭은 파일 단위 grandfather 로 한다
 * (파일 내부 줄이동으로 가드가 false-fail 하지 않도록 — drift_registry 의 파일단위 grandfather 패턴).
 * 탐지 로직·EXIT 코드는 무변경 — 신규 Yahoo-first 진입은 여전히 EXIT 1 차단(drift 봉쇄 유지).
 * key=relPath, value={ lines:number[], reason, c }(c=ADR-0562 카탈로그 분류).
 */
const GRANDFATHER_ALLOWLIST = new Map([
  ['server/learning/lateWinEvaluator.ts', { lines: [68], reason: 'FROZEN_NON_EXECUTION_ADR0563', c: 'C2' }], // 학습 90일 OHLCV raw URL(learningOrchestrator, 비실행)
  ['server/clients/historicalClosePrice.ts', { lines: [65], reason: 'FROZEN_NON_EXECUTION_ADR0563', c: 'C2' }], // 학습 라벨러 단일시점 종가 — 이미 KIS-first, Yahoo 잔존 fallback
  ['server/learning/newsSupplyLogger.ts', { lines: [85], reason: 'FROZEN_NON_EXECUTION_ADR0563', c: 'C2' }], // 학습 뉴스-수급 귀인 N일 종가 fetchCloses(var) — 국내 code+EWY 글로벌 혼재(비실행)
  ['server/clients/koreanQuoteBridge.ts', { lines: [142, 154], reason: 'FROZEN_NON_EXECUTION_ADR0563', c: 'C3' }], // KRX(L1)-first → Yahoo fallback(.KS/.KQ) — L1 primary 충족
  ['server/screener/sectorSources.ts', { lines: [272, 277], reason: 'FROZEN_NON_EXECUTION_ADR0563', c: 'C5' }], // Yahoo assetProfile 섹터 메타데이터(비실행)
  ['server/alerts/reportGenerator.ts', { lines: [896, 905], reason: 'FROZEN_NON_EXECUTION_ADR0563', c: 'C3/C4' }], // 텔레그램 시황요약 ^KS11/KRW=X 표시(비실행)
  ['server/trading/marketDataRefresh.ts', { lines: [855], reason: 'FROZEN_NON_EXECUTION_ADR0563', c: 'C4' }], // KRW=X 환율 — 이미 ECOS 교차검증(ADR-0071), 표시·매크로(비실행)
]);

/**
 * ── D-SUFFIX graceful 인정 (check_yahoo_symbol_resolver.js ADR-0444 와 동일 규칙) ──
 * `.KS`/`.KQ` raw concat 은 symbol-resolver 가드(별도 SSOT)가 1차 통치한다. 본 가드 D-SUFFIX 는
 * 중복 차단을 피하려 그 graceful 인정을 그대로 재사용 — SSOT 위임 동반·ADR-marker opt-in·SSOT 정의
 * 파일은 비위반. 신규 무-opt-in `.KS`/`.KQ` concat 만 본 가드에서 위반.
 */
const SSOT_DELEGATION_RE =
  /tryGetYahooSymbol|fetchYahooQuoteByCode|getYahooSymbol|resolveYahooSymbolForCode|fetchYahooQuoteWithMarketFallback/;
const SUFFIX_OPT_IN_MARKER_RE = /ADR-0231|ADR-0241|ADR-0438|ADR-0443|ADR-0444|ADR-0561|ADR-0562/;
/** D-SUFFIX SSOT/normalizer 정의 파일 — concat 정상 등장(가드 면제). */
const SUFFIX_SSOT_FILES = new Set([
  'server/screener/adapters/yahooSymbolResolver.ts',
  'server/utils/symbolNormalizer.ts',
  'server/learning/defectEvolutionLedger.ts',
]);
const SUFFIX_TEMPLATE_RE = /\$\{[^}]+\}\.K[SQ]\b/;

const URL_DETECTOR_RE =
  /query1\.finance\.yahoo\.com|query2\.finance\.yahoo\.com|finance\.yahoo\.com\/v8|\/v10\/finance\/quoteSummary|\/v10\/quoteSummary/;

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** import / export ... from '...' 라인인가? (값/타입 import 모두 제외 — fetch 가 아님). */
function isImportLine(line) {
  return /^\s*import\b/.test(line) || /^\s*export\b[^;]*\bfrom\s*['"`]/.test(line);
}

/**
 * <symbol> 의 *정의/위임* 라인인가? (호출이 아니라 선언/alias 면 검사 제외).
 *   - export (default) (async) function|const|let|var <symbol>
 *   - (export) async function <symbol>(  — owner 정의처
 *   - const <symbol> = ...   (위임 alias)
 *   - export { <symbol> } ...  (재export)
 */
function isDefinitionLine(line, symbol) {
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (
    new RegExp(
      `^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var)\\s+${s}\\b`,
    ).test(line)
  ) {
    return true;
  }
  // owner 정의처(비-export async function fetchYahooSector(...) 등)
  if (new RegExp(`^\\s*(?:async\\s+)?function\\s+${s}\\b`).test(line)) return true;
  // 위임 alias: const fetchYahooQuoteByCode = fetchYahooQuoteWithMarketFallback;
  if (new RegExp(`^\\s*(?:export\\s+)?const\\s+${s}\\s*=`).test(line)) return true;
  // 재export: export { fetchYahooQuote } from '...'
  if (new RegExp(`^\\s*export\\s*\\{[^}]*\\b${s}\\b[^}]*\\}`).test(line)) return true;
  return false;
}

/**
 * 라인에서 <symbol>( 호출 토큰의 인덱스를 반환(없으면 -1). word-boundary 로 유사명 오탐 방지.
 * fetchYahooQuoteByCode 가 fetchYahooQuote 의 부분문자열을 포함하므로 word-boundary 필수.
 */
function callTokenIndex(line, symbol) {
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?<![\\w$])${s}\\s*\\(`).exec(line);
  return m ? m.index : -1;
}

/** prefix 의 따옴표 짝이 홀수면(=문자열 안) true. */
function insideStringAt(line, idx) {
  const prefix = line.slice(0, idx);
  const singles = (prefix.match(/'/g) || []).length;
  const doubles = (prefix.match(/"/g) || []).length;
  const backticks = (prefix.match(/`/g) || []).length;
  return singles % 2 === 1 || doubles % 2 === 1 || backticks % 2 === 1;
}

/**
 * 라인에 <symbol>( 호출이 있고, 그 호출이 문자열 리터럴 *밖* 인가?
 * 토큰 인덱스 이전 구간의 따옴표 짝 수가 홀수면 문자열 안(에러 메시지·JSDoc 예시) → 위반 아님.
 */
function isCallLine(line, symbol) {
  const idx = callTokenIndex(line, symbol);
  if (idx < 0) return false;
  return !insideStringAt(line, idx);
}

/**
 * fetchCloses(...) 호출 분류. 반환:
 *   'DOMESTIC' = 1번 인자 국내심볼 리터럴(D-CLOSES-DOMESTIC 위반후보),
 *   'VAR'      = 1번 인자 변수 식별자(D-CLOSES-VAR 위반후보, 파일 분류로 해소),
 *   null       = 글로벌심볼 리터럴(B2/B4, 위반 아님) · 호출 아님 · 문자열 인용.
 */
function closesHitKind(line) {
  if (isDefinitionLine(line, 'fetchCloses')) return null; // 정의처(export function fetchCloses(...))
  const idx = callTokenIndex(line, 'fetchCloses');
  if (idx < 0) return null;
  if (insideStringAt(line, idx)) return null; // 'fetchCloses(...)' 문자열 인용
  const after = line.slice(idx);
  const lit = /fetchCloses\s*\(\s*(['"`])([^'"`]+)\1/.exec(after);
  if (lit) {
    const sym = lit[2];
    if (GLOBAL_WHITELIST_SYMBOLS.has(sym)) return null; // B2/B4 글로벌 — 위반 아님
    if (DOMESTIC_YAHOO_SYMBOLS.has(sym)) return 'DOMESTIC';
    return null; // 기타 리터럴(예: ETF 티커) — 별도 정책 부재 시 비점화
  }
  // 변수 인자: fetchCloses(sym) / fetchCloses(symbol) / fetchCloses(sym.symbol)
  if (/fetchCloses\s*\(\s*[A-Za-z_$][\w$.]*/.test(after)) return 'VAR';
  return null;
}

/**
 * D-SUFFIX hit? `${...}.KS`/`.KQ` raw template concat 이 Yahoo 국내심볼 합성(ADR-0562 §1)인가?
 * 비위반 제외(ADR-0562 D-SUFFIX: yahooSymbolResolver/normalizer SSOT 외 발생 = 위반후보, 단 FP §):
 *   - SSOT 위임 동반 라인(`tryGetYahooSymbol(c) ?? `${c}.KS``) — 합법 graceful(ADR-0443).
 *   - 같은/직전 라인 ADR-marker 주석 opt-in · 파일-head ADR opt-in — symbol-resolver 가드(ADR-0444)
 *     graceful 계승(`.KS`/`.KQ` 합성은 그 가드가 1차 통치 — 본 가드는 중복 차단 회피).
 * SSOT 정의파일·src 는 호출자(checkFile)가 별도 제외. exit-path priceHistory 등 fetch entry 는
 *   D-CLOSES-VAR(별도 detector)가 grandfather 로 추적하므로 D-SUFFIX 가 symbol-builder 를 중복점화하지 않음.
 * @param {string} line 현재 라인 / @param {string} prevLine 직전 라인 / @param {boolean} fileOptIn 파일 opt-in
 */
function suffixHit(line, prevLine, fileOptIn) {
  if (!SUFFIX_TEMPLATE_RE.test(line)) return false;
  if (SSOT_DELEGATION_RE.test(line)) return false; // tryGetYahooSymbol(c) ?? `${c}.KS`
  if (SUFFIX_OPT_IN_MARKER_RE.test(line)) return false; // 같은 라인 inline ADR marker
  if (prevLine && SUFFIX_OPT_IN_MARKER_RE.test(prevLine)) return false; // 직전 라인 ADR marker
  if (fileOptIn) return false; // 파일 첫 50줄 ADR opt-in
  return true;
}

/**
 * 단일 파일에서 모든 DETECTOR 의 Yahoo-first 위반 라인을 수집(테스트 재사용 export).
 * 화이트리스트 파일은 호출자(main)가 면제하므로 여기서는 raw hit 만 반환.
 * @returns {{symbol:string, lineNo:number}[]} symbol = DETECTOR 라벨 또는 함수명.
 */
function checkFile(absPath, relPath) {
  const src = readFileSync(absPath, 'utf-8');
  const lines = src.split('\n');
  const norm = relPath.split('\\').join('/');
  const isSrc = norm.startsWith('src/');
  const suffixSsotFile = SUFFIX_SSOT_FILES.has(norm);
  const fileOptIn = SUFFIX_OPT_IN_MARKER_RE.test(lines.slice(0, 50).join('\n'));
  const hits = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (isImportLine(line)) continue;
    const lineNo = i + 1;

    // ── D-QUOTE (ADR-0561 계승) ──
    for (const symbol of YAHOO_PRIMARY_PATTERNS) {
      if (!line.includes(symbol)) continue;
      if (isDefinitionLine(line, symbol)) continue;
      if (isCallLine(line, symbol)) {
        // fetchYahooQuoteByCode 매치 시 같은 라인 fetchYahooQuote 는 인자 reference → 중복 금지.
        if (
          symbol === 'fetchYahooQuote' &&
          hits.some((h) => h.lineNo === lineNo && h.symbol === 'fetchYahooQuoteByCode')
        ) {
          continue;
        }
        hits.push({ symbol, lineNo });
      }
    }

    // ── D-YAHOO-CLIENT ──
    for (const symbol of YAHOO_CLIENT_PATTERNS) {
      if (!line.includes(symbol)) continue;
      if (isDefinitionLine(line, symbol)) continue;
      if (isCallLine(line, symbol)) hits.push({ symbol, lineNo });
    }

    // ── D-URL ──
    if (URL_DETECTOR_RE.test(line)) hits.push({ symbol: 'D-URL', lineNo });

    // ── D-CLOSES-DOMESTIC / D-CLOSES-VAR ──
    const closesKind = closesHitKind(line);
    if (closesKind === 'DOMESTIC') hits.push({ symbol: 'D-CLOSES-DOMESTIC', lineNo });
    else if (closesKind === 'VAR') hits.push({ symbol: 'D-CLOSES-VAR', lineNo });

    // ── D-SUFFIX (symbol-resolver 가드 graceful 규칙 재사용, SSOT 정의파일·src 제외) ──
    if (!suffixSsotFile && !isSrc) {
      const prevLine = i > 0 ? lines[i - 1] : '';
      if (suffixHit(line, prevLine, fileOptIn)) hits.push({ symbol: 'D-SUFFIX', lineNo });
    }
  }
  return hits;
}

function walk(absDir, relDir, out) {
  if (!existsSync(absDir)) return;
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      walk(abs, rel, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push({ abs, rel });
    }
  }
}

const VIOLATION_GUIDANCE =
  'Yahoo(L3)-first 금지(ADR-0563/0562/0561). KIS(L1) primary(fetchTechnicalQuote/KIS endpoint)로 전환하거나, ' +
  'KIS 대체불가 입증 후 WHITELIST 등재(B/D). 실행경로 Yahoo 는 burn-down 완료(ADR-0563); ' +
  '신규 진입은 GRANDFATHER 동결 대상이 아니라 차단 대상이다.';

function main() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    walk(join(ROOT, root), root, files);
  }

  const violations = [];
  let grandfatheredCount = 0;
  for (const { abs, rel } of files) {
    const norm = rel.split('\\').join('/');
    if (WHITELIST.has(norm)) continue; // 합법 owner/fallback/policy 파일 전체 면제
    const hits = checkFile(abs, norm);
    if (hits.length === 0) continue;
    if (GRANDFATHER_ALLOWLIST.has(norm)) {
      grandfatheredCount += hits.length;
      continue; // 파일단위 grandfather (burn-down 추적은 라인 메타로)
    }
    for (const h of hits) {
      violations.push({ relPath: norm, lineNo: h.lineNo, symbol: h.symbol });
    }
  }

  if (violations.length > 0) {
    console.error('[KisPrimaryInvariant] [FAIL] 신규 Yahoo(L3)-first 진입 (ADR-0562/0561)');
    for (const v of violations) {
      console.error(`  위반: ${v.relPath}:${v.lineNo} (${v.symbol}). ${VIOLATION_GUIDANCE}`);
    }
    console.error(`  총 ${violations.length}건 신규 위반 (WHITELIST/GRANDFATHER 미등재).`);
    process.exit(1);
  }

  console.log(
    `[KisPrimaryInvariant] [OK] — ${files.length}개 파일 검사, 신규 Yahoo-first 위반 0건 ` +
      `(DETECTORS: D-QUOTE/D-URL/D-SUFFIX/D-CLOSES-DOMESTIC/D-CLOSES-VAR/D-YAHOO-CLIENT; ` +
      `grandfather ${grandfatheredCount}건 FROZEN_NON_EXECUTION_ADR0563 동결(비실행, 실행경로 burn-down 완료), ` +
      `whitelist ${WHITELIST.size}개 owner/fallback/policy 면제).`,
  );
}

export {
  checkFile,
  YAHOO_PRIMARY_PATTERNS,
  YAHOO_CLIENT_PATTERNS,
  DOMESTIC_YAHOO_SYMBOLS,
  GLOBAL_WHITELIST_SYMBOLS,
  WHITELIST,
  GRANDFATHER_ALLOWLIST,
  isDefinitionLine,
  isCallLine,
  closesHitKind,
  suffixHit,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
