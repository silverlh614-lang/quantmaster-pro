/**
 * @responsibility 종목별 프로그램매매 carry payload SSOT — Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 diagnostic-only path.
 *
 * Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — Phase 1 audit 결과:
 *
 *  • Producer (`normalSupplyPreviewRunner.ts:42-45`) 가 `injectPerSymbolSupplyContext`
 *    호출 후 후보별 `stockProgramFlow` 첨부를 *완전 부재* 시킴 → consumer
 *    (`normalSupplyPreview.ts:851`) 가 `candidate.stockProgramFlow` 를 read-ready
 *    상태로 대기하지만 영원히 undefined.
 *  • Consumer 는 이미 `loadLatestIntradayProgramFlowSnapshot()` 를 내부에서
 *    호출하지만 (`normalSupplyPreview.ts:472`) 그 결과를 *후보별 매칭* 하는 producer
 *    layer 가 단절 — diagnostic only path 의 forensic 정밀도 손실.
 *  • Patch-MARKET-PROGRAM-CARRY-WIRING-001 (#2 시장 프로그램매매) 는 macroState 4
 *    필드를 SSOT 로 carry — 본 SSOT 는 *종목별* `IntradayProgramFlowStockRow` 를
 *    SSOT 로 carry 해 후보별 forensic provider issue 진단 정밀도 회복.
 *
 * 본 SSOT 는 단일 stockRow 를 sanitized payload 로 합성 — 호출자 측 inline 객체
 * 조립 또는 부분 carry 의 drift 위험 영구 차단. Producer 측 단일 진입점.
 *
 * 절대 invariants (사용자 명시 직접 인용 verbatim — 절대 변경 금지):
 *
 *  • diagnostic-only carry — LIVE 매매 의사결정 입력 절대 금지
 *    (executionImpact: 'NONE' / providerIssue: false / marketSignal: false literal
 *    type 컴파일 타임 강제)
 *  • providerIssue=true 시 bearish 신호 변환 금지 — DATA_UNAVAILABLE != failed,
 *    UNKNOWN != NEUTRAL (ADR-0416 / ADR-0421 정합, 운영자 안내 layer 만)
 *  • ENV 정확 비교 의무 (ADR-0157) — `=== 'true'` 만, `'TRUE'` / `'1'` / `'yes'` 거부
 *  • 호출자 측 inline `process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED`
 *    검사 0건 (`isPerStockProgramFlowCarryWiringDisabled()` SSOT 위임 의무)
 *  • LIVE 매매 본체 0줄 변경 — `signalScanner.ts` / `signalScanner/perSymbol/**`
 *    / `signalScanner/preflight.ts` / `entryEngine.ts` / `exitEngine/**` /
 *    `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts`
 *    / `buyPipeline.ts` 모두 0줄 (normalSupplyPreviewRunner.ts 의 1 callsite 만
 *    옵셔널 첨부 추가 — diagnostic-only path)
 *  • KIS/KRX/Yahoo/Naver outbound 0건 추가
 *    (`intradayProgramFlowSnapshotRepo` read-only consumer 만)
 *  • ENV `PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED=true` 1줄 즉시 legacy 100%
 *    복원 (default OFF — 현행 동작 보존이 default)
 *  • ADR 발급 0건 (patch type), INDEX.md 갱신 0건
 *  • 기존 SSOT 본체 무수정 — `intradayProgramFlowSnapshotRepo.ts` /
 *    `injectPerSymbolSupplyContext.ts` / `normalSupplyPreview.ts` 본체 0줄 변경
 *
 * 잘못된 해결 방법 영구 차단:
 *
 *  • 호출자 측 inline `process.env` 검사 (SSOT 위임 의무)
 *  • 호출자 측 inline 객체 조립 (`buildPerStockProgramFlowCarryPayload()` SSOT 단일
 *    호출 의무로 drift 차단)
 *  • `stockProgramFlow` carry 결과를 매매 의사결정 입력 (literal type 컴파일 타임 차단)
 *  • `intradayProgramFlowSnapshotRepo` 본체 변경 (read-only consumer 의무)
 *  • 신규 외부 API 호출 (snapshot read-only 만 — KIS/KRX/Yahoo/Naver outbound 0)
 *  • ENV default ON (운영 회귀 안전망 — default OFF 의무)
 *  • providerIssue / marketSignal 변형 (DATA_UNAVAILABLE != failed, UNKNOWN !=
 *    NEUTRAL ADR-0416/0421 정합 — literal type 강제)
 */

import type {
  IntradayProgramFlowDataStatus,
  IntradayProgramFlowSourceProvider,
  IntradayProgramFlowStockRow,
} from '../../replay/intradayProgramFlowSnapshotRepo.js';

/**
 * Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — SSOT ENV gate (ADR-0157 정확 비교).
 *
 * default OFF — 현행 동작 100% 보존이 default. 운영 회귀 발견 시
 * `PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED=true` 1줄 즉시 legacy 동작 복원.
 *
 * ADR-0157 정합 — `=== 'true'` 만 비활성. `'TRUE'` / `'1'` / `'yes'` 모두 거부 (오타
 * 또는 다른 환경의 boolean 표기 우회 차단).
 */
export function isPerStockProgramFlowCarryWiringDisabled(): boolean {
  return process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED === 'true';
}

/**
 * Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — caller-facing carry payload.
 *
 * `injectPerSymbolSupplyContext` 가 채운 후보 객체에 본 schema 를 따르는 객체를
 * `stockProgramFlow` 키로 첨부. literal type 세 필드 (`executionImpact: 'NONE'` /
 * `providerIssue: false` / `marketSignal: false`) 는 TypeScript 컴파일 타임에 호출자
 * 측 invariant 위반 즉시 fail — `stockProgramFlow` 결과가 매매 의사결정 입력으로
 * 변환되는 것 영구 차단.
 *
 * `IntradayProgramFlowStockRow` 가 보유한 9 데이터 필드 (programNetBuyAmount /
 * programBuyAmount / programSellAmount / programNetVolume / programNetValue /
 * sourceProvider / dataStatus / capturedAt / reason) 를 그대로 propagate — drift
 * 위험 차단을 위해 schema 일치 (옵셔널 필드는 옵셔널 그대로).
 */
export interface PerStockProgramFlowCarryPayload {
  /** 종목코드 (6자리 정규화). */
  readonly symbol: string;
  /** 종목명 (snapshot 보유 시). */
  readonly name?: string;
  /** 종목별 프로그램 순매수 금액 (원, 양수=순매수). undefined=미수집. */
  readonly programNetBuyAmount?: number;
  /** 종목별 프로그램 매수 금액 (원). undefined=미수집. */
  readonly programBuyAmount?: number;
  /** 종목별 프로그램 매도 금액 (원). undefined=미수집. */
  readonly programSellAmount?: number;
  /** 종목별 프로그램 순매수 수량 (주). undefined=미수집. */
  readonly programNetVolume?: number;
  /** 종목별 프로그램 순매수 가치 (원). undefined=미수집. */
  readonly programNetValue?: number;
  /** snapshot 출처 provider — 'KIS_API'/'KRX_API'/'CACHE'/'SNAPSHOT'/'NONE'. */
  readonly sourceProvider: IntradayProgramFlowSourceProvider;
  /** snapshot 데이터 상태 — 'VERIFIED'/'EMPTY_VALID'/'STALE'/'MISSING'/'UNKNOWN'. */
  readonly dataStatus: IntradayProgramFlowDataStatus;
  /** snapshot capture 시각 (ISO). 미수집 시 undefined. */
  readonly capturedAt?: string;
  /** snapshot reason (운영자 안내 텍스트). 미수집 시 undefined. */
  readonly reason?: string;
  /** literal type 컴파일 타임 강제 — 매매 결정 입력 영구 차단 (ADR-0451 정합). */
  readonly executionImpact: 'NONE';
  /** literal type 컴파일 타임 강제 — DATA_UNAVAILABLE != failed (ADR-0416 정합). */
  readonly providerIssue: false;
  /** literal type 컴파일 타임 강제 — UNKNOWN != NEUTRAL (ADR-0421 정합). */
  readonly marketSignal: false;
}

const VALID_SOURCE_PROVIDERS: ReadonlySet<IntradayProgramFlowSourceProvider> =
  new Set(['KIS_API', 'KRX_API', 'CACHE', 'SNAPSHOT', 'NONE']);

const VALID_DATA_STATUSES: ReadonlySet<IntradayProgramFlowDataStatus> = new Set([
  'VERIFIED',
  'EMPTY_VALID',
  'STALE',
  'MISSING',
  'UNKNOWN',
]);

const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — sanitized number guard.
 *
 * NaN / Infinity / non-number → undefined. 0 은 유효한 값 (예: 프로그램 거래 0건).
 */
function sanitizeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
}

/**
 * Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — sourceProvider enum guard.
 *
 * 알 수 없는 값 / null / undefined → 'NONE' fallback (forensic provider issue 진단의
 * sourceProvider='NONE' 의미와 정합).
 */
function sanitizeSourceProvider(
  value: unknown,
): IntradayProgramFlowSourceProvider {
  if (typeof value !== 'string') return 'NONE';
  if (!VALID_SOURCE_PROVIDERS.has(value as IntradayProgramFlowSourceProvider))
    return 'NONE';
  return value as IntradayProgramFlowSourceProvider;
}

/**
 * Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — dataStatus enum guard.
 *
 * 알 수 없는 값 / null / undefined → 'UNKNOWN' fallback (snapshot schema 정합).
 */
function sanitizeDataStatus(value: unknown): IntradayProgramFlowDataStatus {
  if (typeof value !== 'string') return 'UNKNOWN';
  if (!VALID_DATA_STATUSES.has(value as IntradayProgramFlowDataStatus))
    return 'UNKNOWN';
  return value as IntradayProgramFlowDataStatus;
}

/**
 * Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — ISO timestamp guard.
 *
 * ISO-8601 with timezone 형식만 허용. 잘못된 형식 → undefined (forensic capture
 * 시각이 잘못된 데이터로 의사결정 오염되는 것 차단).
 */
function sanitizeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!ISO_TIMESTAMP_RE.test(value)) return undefined;
  return value;
}

/**
 * Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — non-empty string guard.
 *
 * 빈 문자열 / non-string → undefined.
 */
function sanitizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

/**
 * Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — symbol normalization (6-digit pad).
 *
 * 빈 문자열 / non-string → null (호출자가 attachment skip).
 */
function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // injectPerSymbolSupplyContext 의 normalizeSupplySymbol 패턴 정합 (6-digit pad).
  if (/^\d{1,6}$/.test(trimmed)) return trimmed.padStart(6, '0');
  return trimmed;
}

/**
 * Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — stockRow → carry payload SSOT.
 *
 * 결정 트리:
 *  1. ENV `PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED === 'true'` → undefined
 *     (호출자가 `stockProgramFlow` 첨부를 자연스럽게 skip)
 *  2. stockRow === null / undefined → undefined (snapshot 부재)
 *  3. symbol 정규화 실패 → undefined (잘못된 데이터로 의사결정 오염 차단)
 *  4. 정상 경로 — 9 필드 모두 sanitize 후 propagate, sourceProvider/dataStatus
 *     enum fallback ('NONE'/'UNKNOWN'), capturedAt ISO 검증, 숫자 NaN/Infinity 거부
 *
 * literal type 세 필드 (`executionImpact: 'NONE'` / `providerIssue: false` /
 * `marketSignal: false`) 는 TypeScript 컴파일 타임에 호출자 측 invariant 위반 즉시
 * fail.
 */
export function buildPerStockProgramFlowCarryPayload(
  stockRow: IntradayProgramFlowStockRow | null | undefined,
): PerStockProgramFlowCarryPayload | undefined {
  if (isPerStockProgramFlowCarryWiringDisabled()) return undefined;
  if (!stockRow) return undefined;

  const symbol = normalizeSymbol(stockRow.symbol);
  if (!symbol) return undefined;

  return {
    symbol,
    name: sanitizeOptionalString(stockRow.name),
    programNetBuyAmount: sanitizeNumber(stockRow.programNetBuyAmount),
    programBuyAmount: sanitizeNumber(stockRow.programBuyAmount),
    programSellAmount: sanitizeNumber(stockRow.programSellAmount),
    programNetVolume: sanitizeNumber(stockRow.programNetVolume),
    programNetValue: sanitizeNumber(stockRow.programNetValue),
    sourceProvider: sanitizeSourceProvider(stockRow.sourceProvider),
    dataStatus: sanitizeDataStatus(stockRow.dataStatus),
    capturedAt: sanitizeIsoTimestamp(stockRow.capturedAt),
    reason: sanitizeOptionalString(stockRow.reason),
    executionImpact: 'NONE',
    providerIssue: false,
    marketSignal: false,
  };
}

/**
 * Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — symbol-keyed map builder SSOT.
 *
 * Producer 측 호출자가 snapshot 의 stockRows 배열을 1회 변환해 symbol-keyed Map 으로
 * 캐싱 — N 후보 × O(N) snapshot scan 회피 (O(N+M) 효율).
 *
 * 결정 트리:
 *  1. ENV disabled → 빈 Map (호출자 자연 fallback)
 *  2. rows null/undefined → 빈 Map
 *  3. 정상 경로 — 각 row 를 buildPerStockProgramFlowCarryPayload 로 변환, 정상
 *     payload 만 symbol 키로 등록 (drift 위험 0)
 */
export function buildPerStockProgramFlowCarryMap(
  rows: ReadonlyArray<IntradayProgramFlowStockRow> | null | undefined,
): Map<string, PerStockProgramFlowCarryPayload> {
  const map = new Map<string, PerStockProgramFlowCarryPayload>();
  if (isPerStockProgramFlowCarryWiringDisabled()) return map;
  if (!rows || !Array.isArray(rows)) return map;
  for (const row of rows) {
    const payload = buildPerStockProgramFlowCarryPayload(row);
    if (payload) map.set(payload.symbol, payload);
  }
  return map;
}
