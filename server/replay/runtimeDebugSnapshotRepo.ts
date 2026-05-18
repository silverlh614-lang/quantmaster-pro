// @responsibility 15:30 KST market-close runtime debug snapshot 영속 SSOT + frozen supply rows + replay adapter metadata.

/**
 * Patch-AFTER-HOURS-RUNTIME-DEBUG-SNAPSHOT-001/002/003 — Runtime Debug Snapshot Repo.
 *
 * 사용자 명시 framing (Patch-001, Patch-003 시간 격상):
 *   "15:30에 스냅샷을 찍고, 15:30에 찍는 스냅샷은 sell only 용이 아니고 장중 스냅샷과
 *    동일하게 취급한다. 15:30에 신규 KIS/KRX/Yahoo/Naver 호출 금지.
 *    저장 대상은 마지막 장중 runtime snapshot/cache/diagnostic state.
 *    replay에서는 SELL_ONLY 의미 부여 금지."
 *
 *   현재 capture 기준: 15:30 KST 장마감 스냅샷. 장후 KIS/KRX 400/500 가능성을 피하고
 *   추천종목 탐색의 frozen supply 기준으로 사용한다. 다른 invariant 100% 보존.
 *
 * 사용자 명시 framing (Patch-002):
 *   "스냅샷을 단순 조회용으로만 쓰지 않고, SnapshotInvestorFlowReplayAdapter 를
 *    추가하여 snapshot 에 저장된 frozen per-symbol supply rows 를 실제 preflight
 *    merge 경로에 주입할 수 있게 한다. 주말에도 providerCalls=0 상태에서
 *    '수급이 candidate context 에 정상적으로 들어가는지' 검증할 수 있어야 한다."
 *
 * Lifecycle 정책:
 *   - 매 평일 15:30 KST 자동 capture (ScheduleClass='TRADING_DAY_ONLY')
 *   - **단일 latest overwrite 모델** — FIFO revision 누적 X, latest 1 개만 유지
 *   - **다음 거래일 개장 시 초기화 안 함** — snapshot 은 다음 평일 15:30 까지 유지
 *   - 다음 평일 15:30 성공 capture 가 직전 latest atomic overwrite
 *   - 금요일 snapshot → 월요일 15:30 capture 가 덮어쓰기 (주말 내내 Fri snapshot 보존)
 *   - 월요일 장 시작 시 금요일 snapshot 삭제 절대 금지 (cron 미존재)
 *   - capture 실패 시 직전 latest 보존 (atomic write tmp→rename + preserveOnFailure)
 *
 * 절대 invariants (15 항목):
 *   1.  raw API payload 영속 0건 (sanitized fields 만)
 *   2.  민감정보 영속 0건 (token / accountNo / orderId / authorization 등)
 *   3.  replayOnly: true literal 강제 (TypeScript 컴파일 타임)
 *   4.  diagnosticOnly: true literal 강제
 *   5.  executionImpact: 'NONE' literal 강제 (replay 결과는 매매 의사결정 입력 절대 금지)
 *   6.  runtimeStateBasis: 'LATEST_INTRADAY_RUNTIME_STATE' literal 강제
 *   7.  sessionInterpretation: 'INTRADAY_REPLAY_EQUIVALENT' literal 강제 (SELL_ONLY 의미 부여 금지)
 *   8.  captureTimeKst: '15:30' literal 강제
 *   9.  sellOnlySemanticApplied: false literal 강제
 *   10. priceSemantics: 'REFERENCE_ONLY_NOT_FOR_TRADE_DECISION' literal 강제
 *   11. replayDecisionMode: 'FROZEN_RUNTIME_STATE' literal 강제
 *   12. replayGuard.providerCallsAllowed: false literal 강제
 *   13. replayGuard.providerCalls/kisCalls/krxCalls/yahooCalls/naverCalls: 0 literal 강제
 *   14. retention.model: 'SINGLE_LATEST_OVERWRITE' literal 강제
 *   15. sanitize.applied: true / sanitize.rawPayloadStored: false literal 강제
 *
 * Patch-002 추가 invariants:
 *   16. frozenSupplyRows 는 normalized supply row schema 만 영속 (raw KIS/KRX response 영속 0건)
 *   17. SnapshotInvestorFlowReplayAdapter 는 LIVE execution path 에 절대 연결 0건
 *   18. UNKNOWN 을 임의로 VERIFIED 로 조작 금지 (frozen row 가 없으면 'row missing' 진단)
 */

import fs from 'fs';
import path from 'path';
import {
  LATEST_RUNTIME_DEBUG_SNAPSHOT_FILE,
  REPLAY_DIR,
  ensureReplayDir,
} from '../persistence/paths.js';

// ============================================================================
// Schema SSOT — literal types 컴파일 타임 강제
// ============================================================================

export type SnapshotCaptureKind = 'AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT';

/**
 * Per-symbol frozen supply row — preflight merge 경로 주입용.
 * 사용자 명시 (Patch-002 §B):
 *   "frozenSupplyRows 는 normalized supply row schema 만 영속.
 *    raw KIS/KRX response 영속 0건.
 *    foreign/institution/program net buy + score contribution 등 진단/매매 input layer."
 */
export interface SnapshotFrozenSupplyRow {
  symbol: string; // 6-digit KRX code, padded
  selectedProvider: 'KIS_API' | 'KRX_OPENAPI' | 'NAVER_INVESTOR_TREND' | 'CACHE' | 'NONE' | 'UNKNOWN';
  status: 'VERIFIED' | 'PARTIAL_VERIFIED' | 'EMPTY_VALID' | 'STALE_CACHE' | 'PROVIDER_ERROR' | 'UNKNOWN';
  semanticSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';
  foreignNetBuy?: number; // 정규화 후 numeric (천원 단위 — provider 별 정규화 의무)
  institutionNetBuy?: number;
  programNetBuy?: number;
  scoreContribution?: number; // supply_confluence evaluator 가 기록한 score 기여도
  rowAvailable: boolean; // 실제 numeric row 보유 여부 (true=>row 정상, false=>row missing)
  fetchedAtKst?: string; // 원본 fetch 시각 (KST), snapshot 영속 시점 아님
  source: 'INVESTOR_FLOW_PROVIDER_ROUTER_ADR_0477'; // literal — 출처 추적
  [key: string]: unknown; // forward-compat — sanitized 통과 보장
}

/**
 * SnapshotInvestorFlowReplayAdapter 메타 — adapter 호출 결과 진단 영속.
 * 사용자 명시 (Patch-002 §C/F):
 *   "adapter 는 LIVE execution path 에 절대 연결되지 않는다.
 *    diagnosticOnly: true literal 강제. UNKNOWN 을 임의로 VERIFIED 로 조작 금지."
 */
export interface SnapshotReplayAdapterMeta {
  adapterName: 'SNAPSHOT_INVESTOR_FLOW_REPLAY_ADAPTER';
  diagnosticOnly: true;
  liveExecutionAllowed: false;
  providerCalls: 0;
  kisCalls: 0;
  krxCalls: 0;
  yahooCalls: 0;
  naverCalls: 0;
  source: 'SNAPSHOT_REPLAY_ADAPTER';
}

/**
 * Replay mode guard — 15:30 capture 및 replay 시점 외부 API 호출 차단.
 * 사용자 명시 (Patch-001 §C):
 *   "15:30 에 신규 provider 호출 금지. replay 에서도 provider 호출 금지.
 *    providerCallsAllowed: false. providerCalls/kisCalls/krxCalls/yahooCalls/naverCalls = 0."
 */
export interface SnapshotReplayGuard {
  replayMode: true;
  providerCallsAllowed: false;
  providerCalls: 0;
  kisCalls: 0;
  krxCalls: 0;
  yahooCalls: 0;
  naverCalls: 0;
}

/**
 * Retention 정책 — 단일 latest overwrite 모델.
 * 사용자 명시 (Patch-001 §D):
 *   "Snapshot은 단일 latest overwrite 모델 — 매 거래일 15:30 성공 저장 시
 *    기존 latest snapshot overwrite. 금요일 snapshot 은 주말 동안 유지,
 *    월요일 15:30 성공 저장 후 금요일 snapshot 을 overwrite,
 *    월요일 장 시작 시 금요일 snapshot 을 삭제하면 안 된다."
 */
export interface SnapshotRetentionPolicy {
  model: 'SINGLE_LATEST_OVERWRITE';
  overwriteOnNextSuccessfulTradingDayCapture: true;
  preservePreviousOnCaptureFailure: true;
}

/**
 * Sanitization 정책 — raw API payload 영속 0건.
 * 사용자 명시 (Patch-001 §B):
 *   "민감정보 저장 금지 — 계좌번호 / 토큰 / authorization header / 주문번호 /
 *    체결번호 / 원주문번호 / raw API payload 전체 저장 금지."
 */
export interface SnapshotSanitizationPolicy {
  applied: true;
  rawPayloadStored: false;
  forbiddenFieldPatternsApplied: number; // 적용된 패턴 수 (15+)
}

export interface RuntimeDebugSnapshot {
  // Identity + invariants
  snapshotId: string;
  capturedAt: string; // ISO 8601 UTC
  marketDate: string; // YYYY-MM-DD KST
  captureKind: SnapshotCaptureKind;
  timezone: 'Asia/Seoul';
  source: 'RUNTIME_SNAPSHOT';
  captureTimeKst: '15:30';
  schemaVersion: 2;

  // 절대 invariants (literal types — TypeScript 컴파일 타임 강제)
  replayOnly: true;
  diagnosticOnly: true;
  executionImpact: 'NONE';
  runtimeStateBasis: 'LATEST_INTRADAY_RUNTIME_STATE';
  sessionInterpretation: 'INTRADAY_REPLAY_EQUIVALENT';
  sellOnlySemanticApplied: false;
  priceSemantics: 'REFERENCE_ONLY_NOT_FOR_TRADE_DECISION';
  replayDecisionMode: 'FROZEN_RUNTIME_STATE';

  // Policy blocks (literal types)
  replayGuard: SnapshotReplayGuard;
  retention: SnapshotRetentionPolicy;
  sanitize: SnapshotSanitizationPolicy;

  // Capture quality
  captureStatus: 'OK' | 'PARTIAL';
  missingSections?: string[];
  warnings?: string[];

  // Runtime state (sanitized — 민감정보 0건)
  runtime?: SanitizedRuntimeBlock;
  universe?: SanitizedUniverseBlock;
  gate?: SanitizedGateBlock;
  supply?: SanitizedSupplyBlock;
  watchlist?: SanitizedWatchlistBlock;
  sectorEnergy?: SanitizedSectorEnergyBlock;
  programTrading?: SanitizedProgramTradingBlock;
  shadow?: SanitizedShadowBlock;
  counterfactual?: SanitizedCounterfactualBlock;
  providerDiagnostics?: SanitizedProviderDiagnosticsBlock;

  // Patch-002 — per-symbol frozen supply rows + replay adapter metadata
  frozenSupplyRows?: SnapshotFrozenSupplyRow[];
  snapshotReplayAdapter?: SnapshotReplayAdapterMeta;
}

// 각 블록 schema — 모두 옵셔널·sanitized. 호출자(capture orchestrator) 가 채움.
export interface SanitizedRuntimeBlock {
  marketSession?: string;
  sellOnly?: boolean;
  kisLoadState?: string;
  regime?: string;
  fomcPhase?: string;
  kellyMultiplier?: number;
  engineAlive?: boolean;
  shadowLearningEnabled?: boolean;
  emergencyStop?: boolean;
  [key: string]: unknown;
}

export interface SanitizedUniverseBlock {
  candidateCount?: number;
  watchlistCount?: number;
  sections?: Record<string, number>;
  [key: string]: unknown;
}

export interface SanitizedGateBlock {
  gate1Pass?: number;
  gate2Pass?: number;
  gate3Pass?: number;
  blockers?: Array<{ reason: string; count: number }>;
  [key: string]: unknown;
}

export interface SanitizedSupplyBlock {
  selectedProvider?: string;
  semanticAvailable?: number;
  rawInvestorRowAvailable?: number;
  scoreUsageDistribution?: Record<string, number>;
  providerIssue?: boolean;
  marketSignal?: boolean;
  [key: string]: unknown;
}

export interface SanitizedWatchlistBlock {
  imported?: number;
  momentumCount?: number;
  saturationStatus?: string;
  detachedShadowCount?: number;
  [key: string]: unknown;
}

export interface SanitizedSectorEnergyBlock {
  dataQuality?: string;
  validSectorCount?: number;
  sourceTier?: string;
  sectorBoostAllowed?: boolean;
  strongBuyAllowed?: boolean;
  [key: string]: unknown;
}

export interface SanitizedProgramTradingBlock {
  stockProgramStatus?: string;
  marketProgramStatus?: string;
  sessionState?: string;
  [key: string]: unknown;
}

export interface SanitizedShadowBlock {
  openPositions?: number;
  detachedPositions?: number;
  todayCreated?: number;
  todayClosed?: number;
  [key: string]: unknown;
}

export interface SanitizedCounterfactualBlock {
  recordedCount?: number;
  nearMissCount?: number;
  dryRunRows?: number;
  [key: string]: unknown;
}

export interface SanitizedProviderDiagnosticsBlock {
  kis?: Record<string, unknown>;
  krx?: Record<string, unknown>;
  naver?: Record<string, unknown>;
  cache?: Record<string, unknown>;
  yahoo?: Record<string, unknown>;
  [key: string]: unknown;
}

// ============================================================================
// Sensitive Field Redaction SSOT — 영속 직전 자동 제거
// ============================================================================

/**
 * 영속 전 sanitize 통과 의무 — 민감정보 키 자동 제거.
 * 사용자 명시 (§"민감정보 저장 금지"):
 *   "계좌번호 / 토큰 / authorization header / 주문번호 / 체결번호 / 원주문번호 /
 *    raw API payload 전체 저장 금지."
 * 키 매칭은 대소문자 무관 + 부분 매치 (`appkey`, `appKey`, `APP_KEY` 모두 제거).
 */
const FORBIDDEN_FIELD_PATTERNS = [
  /token/i,
  /authorization/i,
  /appkey/i,
  /appsecret/i,
  /^cano$/i,
  /accountno/i,
  /accountnumber/i,
  /orderno/i,
  /orderid/i,
  /custtype/i,
  /password/i,
  /secret/i,
  /credential/i,
  /^auth$/i,
  /cookie/i,
];

export const SANITIZE_FORBIDDEN_PATTERN_COUNT = FORBIDDEN_FIELD_PATTERNS.length;

export function isForbiddenSnapshotField(key: string): boolean {
  return FORBIDDEN_FIELD_PATTERNS.some((re) => re.test(key));
}

/**
 * 객체에서 민감 키를 재귀적으로 제거 — 영속 전 자동 호출.
 * - Object: 키 단위 검사 + nested 재귀
 * - Array: 각 element 재귀
 * - Primitive: 그대로 반환
 * - circular reference 차단을 위해 depth 6 제한 (정상 sanitized block 충분)
 */
export function redactSensitiveFields<T>(value: T, depth = 0): T {
  if (depth > 6) return value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item, depth + 1)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenSnapshotField(key)) continue;
    result[key] = redactSensitiveFields(val, depth + 1);
  }
  return result as T;
}

// ============================================================================
// 영속 IO — atomic write tmp → rename + 손상 JSON fallback + preserveOnFailure
// ============================================================================

function atomicWriteJson(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function safeReadJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(
      `[RuntimeDebugSnapshotRepo] 손상 JSON 무시 (file=${filePath}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return null;
  }
}

// ============================================================================
// Public API — 단일 latest overwrite 모델
// ============================================================================

/**
 * Sanitize 미통과 입력을 통과 형태로 정규화 — 민감 키 자동 제거 + literal type 강제.
 * 호출자가 미리 redact 했어도 한 번 더 통과 (방어적).
 */
export function sanitizeRuntimeDebugSnapshot(
  input: Partial<RuntimeDebugSnapshot> & Pick<RuntimeDebugSnapshot, 'snapshotId' | 'capturedAt' | 'marketDate'>
): RuntimeDebugSnapshot {
  const redacted = redactSensitiveFields(input);
  return {
    ...redacted,
    captureKind: 'AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT',
    timezone: 'Asia/Seoul',
    source: 'RUNTIME_SNAPSHOT',
    captureTimeKst: '15:30',
    schemaVersion: 2,
    replayOnly: true,
    diagnosticOnly: true,
    executionImpact: 'NONE',
    runtimeStateBasis: 'LATEST_INTRADAY_RUNTIME_STATE',
    sessionInterpretation: 'INTRADAY_REPLAY_EQUIVALENT',
    sellOnlySemanticApplied: false,
    priceSemantics: 'REFERENCE_ONLY_NOT_FOR_TRADE_DECISION',
    replayDecisionMode: 'FROZEN_RUNTIME_STATE',
    replayGuard: {
      replayMode: true,
      providerCallsAllowed: false,
      providerCalls: 0,
      kisCalls: 0,
      krxCalls: 0,
      yahooCalls: 0,
      naverCalls: 0,
    },
    retention: {
      model: 'SINGLE_LATEST_OVERWRITE',
      overwriteOnNextSuccessfulTradingDayCapture: true,
      preservePreviousOnCaptureFailure: true,
    },
    sanitize: {
      applied: true,
      rawPayloadStored: false,
      forbiddenFieldPatternsApplied: SANITIZE_FORBIDDEN_PATTERN_COUNT,
    },
    captureStatus: redacted.captureStatus ?? 'OK',
  } as RuntimeDebugSnapshot;
}

/**
 * 최신 runtime debug snapshot 영속 — 단일 latest overwrite.
 *
 * 알고리즘:
 *   1. ensureReplayDir() — 디렉토리 보장
 *   2. sanitizeRuntimeDebugSnapshot() 한 번 더 통과 (literal types + redaction)
 *   3. atomic write — tmp 파일 작성 후 rename
 *   4. 실패 시 throw — 호출자가 try/catch 격리. 직전 latest 는 atomic rename 패턴으로 자동 보존.
 *
 * 사용자 명시 lifecycle 정합:
 *   - 매 평일 15:30 성공 capture 시 직전 latest atomic overwrite
 *   - capture 실패 시 직전 latest 보존 (tmp 파일만 leftover, rename 미실행)
 */
export function saveLatestRuntimeDebugSnapshot(
  snapshot: RuntimeDebugSnapshot
): RuntimeDebugSnapshot {
  ensureReplayDir();
  const sanitized = sanitizeRuntimeDebugSnapshot(snapshot);
  atomicWriteJson(LATEST_RUNTIME_DEBUG_SNAPSHOT_FILE, sanitized);
  return sanitized;
}

/**
 * 최신 runtime debug snapshot 로드.
 * 파일 부재 / 손상 JSON / literal invariants 위반 시 null.
 */
export function loadLatestRuntimeDebugSnapshot(): RuntimeDebugSnapshot | null {
  const snapshot = safeReadJson<RuntimeDebugSnapshot>(LATEST_RUNTIME_DEBUG_SNAPSHOT_FILE);
  if (!snapshot) return null;
  if (snapshot.replayOnly !== true) return null;
  if (snapshot.diagnosticOnly !== true) return null;
  if (snapshot.executionImpact !== 'NONE') return null;
  if (snapshot.sellOnlySemanticApplied !== false) return null;
  return snapshot;
}

/** 최신 snapshot 존재 여부 (read-only). */
export function hasLatestRuntimeDebugSnapshot(): boolean {
  return fs.existsSync(LATEST_RUNTIME_DEBUG_SNAPSHOT_FILE);
}

/** 테스트 격리 / 운영자 수동 삭제 (예: /snapshot_clear). 정상 운영에서 호출 금지. */
export function deleteLatestRuntimeDebugSnapshot(): boolean {
  if (!fs.existsSync(LATEST_RUNTIME_DEBUG_SNAPSHOT_FILE)) return false;
  try {
    fs.unlinkSync(LATEST_RUNTIME_DEBUG_SNAPSHOT_FILE);
    return true;
  } catch (err) {
    console.warn(
      `[RuntimeDebugSnapshotRepo] delete latest 실패: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return false;
  }
}

/**
 * snapshot ID 생성기. 형식: `rds-YYYYMMDD-HHMMSS-NNNN` (Runtime Debug Snapshot).
 * `nnnn` = capturedAtMs % 10000 — 같은 초 안 중복 capture 시도 시 차별.
 */
export function generateSnapshotId(marketDate: string, capturedAtMs: number): string {
  const date = new Date(capturedAtMs);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  const nnnn = String(capturedAtMs % 10000).padStart(4, '0');
  return `rds-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${nnnn}`;
}

/**
 * KST 일자 문자열 (YYYY-MM-DD) — UTC 시각으로부터 변환.
 * Asia/Seoul = UTC+9 — DST 미적용.
 */
export function kstDateString(nowMs: number): string {
  const kstMs = nowMs + 9 * 60 * 60 * 1000;
  const date = new Date(kstMs);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** 테스트 격리 헬퍼 — 운영 환경 호출 금지. */
export function __resetRuntimeDebugSnapshotRepoForTests(): void {
  if (fs.existsSync(LATEST_RUNTIME_DEBUG_SNAPSHOT_FILE)) {
    try {
      fs.unlinkSync(LATEST_RUNTIME_DEBUG_SNAPSHOT_FILE);
    } catch {
      // silent — 테스트 격리만
    }
  }
  if (fs.existsSync(REPLAY_DIR)) {
    try {
      const entries = fs.readdirSync(REPLAY_DIR);
      for (const entry of entries) {
        try {
          fs.rmSync(path.join(REPLAY_DIR, entry), { recursive: true, force: true });
        } catch {
          // silent
        }
      }
    } catch {
      // silent
    }
  }
}
