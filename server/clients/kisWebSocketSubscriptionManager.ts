/**
 * @responsibility KIS WebSocket 30-슬롯 구독 우선순위 큐 SSOT — eviction/min-hold/invalid-code-guard.
 *
 * ADR-0437 (= 사용자 명시 ADR-0439) — KIS WebSocket Subscription Priority Queue.
 * 사용자 핵심 의도: "30개 슬롯은 자원이다. 보유종목과 진입 직전 후보가 먼저고,
 * 관측 후보와 degraded 후보는 밀려나야 한다. ADR-0439 는 매수 로직을 바꾸는 패치가 아니라
 * 실시간 추적 슬롯을 제대로 배분하는 운영 안정화 패치다."
 *
 * 12 invariants (정적 grep 회귀 가드 의무):
 *   1. 보유 종목 = priority 1000 (절대 evict 금지)
 *   2. liveEligible = priority 900 (가능한 한 evict 보호)
 *   3. ENTRY_CANDIDATE = 800
 *   4. shadowObservable = 700
 *   5. WATCHLIST = 500 (default 보수 fallback)
 *   6. invalid KRX code = priority 0 reject (subscribeStock 호출 0)
 *   7. 중복 구독 0
 *   8. 30개 상한 초과 시 낮은 우선순위 evict 또는 신규 거절
 *   9. min-hold 5분 (default) — priority 상승 즉시 반영, 하락은 만료 후 evict
 *  10. LIVE 주문 경로 0줄 변경
 *  11. KIS 주문 함수 5종 import 0건
 *  12. 신규 fetch / 외부 호출 0건
 *
 * ADR-0436 GateEligibility 결과 (liveEligible / shadowObservable) 자연 활용 — 호출자 wrapper 가
 * ctx.gateEligibility 를 단순 propagate 하면 본 SSOT 가 priority 매핑 자동 적용.
 *
 * ADR-0442 후속 PR 에서 server/utils/symbolNormalizer SSOT 로 통합 예정 — 본 PR 은 inline
 * normalizeKrxCodeForWs 만 정착 (회귀 위험 격리).
 */

import {
  MAX_SUBSCRIPTIONS,
  subscribeStock as kisSubscribeStock,
  unsubscribeStock as kisUnsubscribeStock,
} from './kisStreamClient.js';
// ADR-0438 (= 사용자 명시 ADR-0442) — Symbol Resolver SSOT 위임.
// ADR-0437 의 inline normalizeKrxCodeForWs 가 SSOT 통합 (정규식 인라인 제거).
import { normalizeKrxCode as normalizeKrxCodeSsot } from '../utils/symbolNormalizer.js';
import { logger as appLogger, logNoiseDetail } from '../utils/logger.js';

/**
 * 12-value SubscriptionPriorityReason union.
 * 1000 OPEN_POSITION → 0 INVALID_CODE / HARD_RISK_BLOCK 까지 절대 변경 금지.
 *
 * ADR-0450 — pre-breakout retry candidates 5종 reason 추가 (PRE_BREAKOUT_RETRY_ELIGIBLE
 * 850 / WAIT_PRICE_TOO_FAR / WAIT_VOLUME_WEAK / WAIT_GATE_RECHECK_FAILED 300 /
 * WAIT_COOLDOWN 250). 기존 12-value (OPEN_POSITION ~ UNKNOWN) priority 0 변경.
 */
export type SubscriptionPriorityReason =
  | 'OPEN_POSITION'
  | 'LIVE_ELIGIBLE'
  | 'PRE_BREAKOUT_RETRY_ELIGIBLE'
  | 'ENTRY_CANDIDATE'
  | 'SHADOW_OBSERVABLE'
  | 'DART_CATALYST'
  | 'WATCHLIST'
  | 'OBSERVE_ONLY'
  | 'WAIT_PRICE_TOO_FAR'
  | 'WAIT_VOLUME_WEAK'
  | 'WAIT_GATE_RECHECK_FAILED'
  | 'WAIT_COOLDOWN'
  | 'WAIT_LONG'
  | 'PROVIDER_DEGRADED'
  | 'DATA_UNAVAILABLE'
  | 'INVALID_CODE'
  | 'HARD_RISK_BLOCK'
  | 'UNKNOWN';

/**
 * 우선순위 매트릭스 SSOT (사용자 §2 절대 변경 금지 — ADR-0437 12-value 0 변경 + ADR-0450 5 신규).
 * Priority Queue eviction 정책의 단일 입력.
 */
export const SUBSCRIPTION_PRIORITY_TABLE: Readonly<
  Record<SubscriptionPriorityReason, number>
> = Object.freeze({
  OPEN_POSITION: 1000,
  LIVE_ELIGIBLE: 900,
  PRE_BREAKOUT_RETRY_ELIGIBLE: 850, // ADR-0450 — WAIT_RETRY_ELIGIBLE 후보 (WATCHLIST 500 < 850 < ENTRY_CANDIDATE+50)
  ENTRY_CANDIDATE: 800,
  SHADOW_OBSERVABLE: 700,
  DART_CATALYST: 600,
  WATCHLIST: 500,
  OBSERVE_ONLY: 300,
  WAIT_PRICE_TOO_FAR: 300, // ADR-0450 — 진입가 3% 초과 (WATCHLIST 500 보다 낮춰 evict 1순위)
  WAIT_VOLUME_WEAK: 300, // ADR-0450 — 거래량 0.4 미만
  WAIT_GATE_RECHECK_FAILED: 300, // ADR-0450 — 직전 진입 재검증 탈락
  WAIT_COOLDOWN: 250, // ADR-0450 — waitCount≥3 cooldown
  WAIT_LONG: 100,
  PROVIDER_DEGRADED: 300,
  DATA_UNAVAILABLE: 300,
  INVALID_CODE: 0,
  HARD_RISK_BLOCK: 0,
  UNKNOWN: 100,
});

export interface SubscriptionCandidate {
  code: string;
  name?: string;
  priority: number;
  reasons: SubscriptionPriorityReason[];
  liveEligible?: boolean;
  shadowObservable?: boolean;
  entryCandidate?: boolean;
  openPosition?: boolean;
  observeOnly?: boolean;
  lastUpdatedAt: number;
}

export type SubscriptionDecision =
  | { action: 'SUBSCRIBE'; code: string; priority: number; reasons: SubscriptionPriorityReason[] }
  | { action: 'UNSUBSCRIBE'; code: string; priority: number; reasons: SubscriptionPriorityReason[] }
  | { action: 'KEEP'; code: string; priority: number; reasons: SubscriptionPriorityReason[] }
  | {
      action: 'REJECT_LOW_PRIORITY';
      code: string;
      priority: number;
      reasons: SubscriptionPriorityReason[];
      minSubscribedPriority: number;
    }
  | { action: 'REJECT_INVALID_CODE'; code: string; reasons: SubscriptionPriorityReason[] };

export interface SubscriptionDiagnosis {
  total: number;
  limit: number;
  openPositionCount: number;
  liveEligibleCount: number;
  shadowObservableCount: number;
  watchlistCount: number;
  observeOnlyCount: number;
  invalidRejectedCount: number;
  lowPriorityRejectedCount: number;
  evictedCount: number;
  lastEvictedCode?: string;
  lastEvictedReason?: SubscriptionPriorityReason;
}

interface SubscribedEntry {
  code: string;
  priority: number;
  reasons: SubscriptionPriorityReason[];
  lastUpdatedAt: number;
  openPosition?: boolean;
  liveEligible?: boolean;
  shadowObservable?: boolean;
}


export interface KisWsNoiseSummary {
  active: number;
  queued: number;
  keep: number;
  rejectedLowPriority: number;
  limitReached: number;
}

export function summarizeKisWsDecisions(
  decisions: SubscriptionDecision[],
  active: number,
  limit = KIS_WS_SUBSCRIPTION_LIMIT,
): KisWsNoiseSummary {
  const queued = decisions.filter((d) => d.action === 'SUBSCRIBE').length;
  const keep = decisions.filter((d) => d.action === 'KEEP').length;
  const rejectedLowPriority = decisions.filter((d) => d.action === 'REJECT_LOW_PRIORITY').length;
  return {
    active,
    queued,
    keep,
    rejectedLowPriority,
    limitReached: active >= limit ? rejectedLowPriority : 0,
  };
}

export function formatKisWsNoiseSummary(summary: KisWsNoiseSummary): string {
  return `[KIS-WSSummary] active=${summary.active} queued=${summary.queued} keep=${summary.keep} rejectedLowPriority=${summary.rejectedLowPriority} limitReached=${summary.limitReached}`;
}

export function logKisWsNoiseSummary(
  summary: KisWsNoiseSummary,
  logger: Pick<Console, 'info'> = appLogger,
): void {
  logger.info(formatKisWsNoiseSummary(summary));
}

function isCoreWatchlistHighPriorityFailure(candidate: { priority?: number; reasons: SubscriptionPriorityReason[] }): boolean {
  const priority = typeof candidate.priority === 'number' && Number.isFinite(candidate.priority)
    ? candidate.priority
    : derivePriorityFromReasons(candidate.reasons);
  return priority >= SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST && candidate.reasons.includes('WATCHLIST');
}

// ── ENV / 상수 SSOT ────────────────────────────────────────────────────────

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0 || n > 100) return MAX_SUBSCRIPTIONS;
  return n;
}

function clampHoldMs(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 300_000;
  return n;
}

export const KIS_WS_SUBSCRIPTION_LIMIT = clampLimit(
  Number.parseInt(process.env.KIS_WS_MAX_SUBSCRIPTIONS ?? '', 10),
);

export const KIS_WS_SUBSCRIPTION_MIN_HOLD_MS = clampHoldMs(
  Number.parseInt(process.env.KIS_WS_SUBSCRIPTION_MIN_HOLD_MS ?? '', 10),
);

/**
 * ENV gate — ADR-0157 정확 비교 의무 (`'1'` / `'TRUE'` / `'yes'` 거부).
 * 활성 시 legacy `subscribeStock` 직접 호출 동작 100% 복원.
 */
export function isKisWsSubscriptionPriorityDisabled(): boolean {
  return process.env.KIS_WS_SUBSCRIPTION_PRIORITY_DISABLED === 'true';
}

/**
 * ADR-0442 — 진단 섹션 노출 ENV gate (default OFF).
 *
 * ADR-0157 정확 비교 의무 (`'1'` / `'TRUE'` / `'yes'` 거부).
 *
 * 활성 시 `/scan_blockers` 와 `/health` 명령에서 KIS WebSocket Subscription
 * 진단 섹션 미노출 (운영자 표시 비활성화). ADR-0437 SSOT 본체는 그대로 작동 —
 * `buildSubscriptionDiagnosis` / `formatKisWsSubscriptionSection` 호출 자체는
 * 호출자 측 분기로만 차단.
 */
export function isKisWsSubscriptionDiagDisabled(): boolean {
  return process.env.KIS_WS_SUBSCRIPTION_DIAG_DISABLED === 'true';
}

// ── invalid KRX code guard (ADR-0438 SSOT 위임) ────────────────────────────

/**
 * 6자리 숫자 KRX code 정규화. invalid 시 null.
 *
 * ADR-0438 (= 사용자 명시 ADR-0442) — `server/utils/symbolNormalizer.ts` SSOT 위임.
 * 본 함수는 호출자 후방호환 wrapper — inline 정규식 영구 제거 (정적 grep 가드).
 *
 * 동작 보존:
 *   - 정상 6자리: 그대로 반환 ('005930')
 *   - .KS / .KQ / .KOSPI / .KOSDAQ suffix: strip ('005930.KS' → '005930')
 *   - 그 외 (4자리 / 알파벳 / 빈 / null / non-string): null
 */
export function normalizeKrxCodeForWs(raw: unknown): string | null {
  const result = normalizeKrxCodeSsot(raw);
  return result.valid ? result.code : null;
}

// ── 정렬 / dedup SSOT ──────────────────────────────────────────────────────

/**
 * 같은 code 다중 entry → highest priority 하나만 + reasons 병합.
 */
export function dedupeCandidates(
  candidates: SubscriptionCandidate[],
): SubscriptionCandidate[] {
  const map = new Map<string, SubscriptionCandidate>();
  for (const c of candidates) {
    const existing = map.get(c.code);
    if (!existing) {
      map.set(c.code, { ...c, reasons: [...c.reasons] });
      continue;
    }
    if (c.priority > existing.priority) {
      map.set(c.code, {
        ...c,
        reasons: Array.from(new Set([...c.reasons, ...existing.reasons])),
      });
    } else {
      existing.reasons = Array.from(new Set([...existing.reasons, ...c.reasons]));
      // priority 동률 시 openPosition / liveEligible / shadowObservable / entryCandidate 우선 보존
      if (c.openPosition && !existing.openPosition) existing.openPosition = true;
      if (c.liveEligible && !existing.liveEligible) existing.liveEligible = true;
      if (c.shadowObservable && !existing.shadowObservable) existing.shadowObservable = true;
      if (c.entryCandidate && !existing.entryCandidate) existing.entryCandidate = true;
    }
  }
  return Array.from(map.values());
}

/**
 * priority desc → openPosition / liveEligible / entryCandidate / shadowObservable 동률 우선
 * → 최근 업데이트 우선 → code asc (deterministic).
 */
export function sortCandidatesByPriority(
  candidates: SubscriptionCandidate[],
): SubscriptionCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const ao = a.openPosition ? 1 : 0;
    const bo = b.openPosition ? 1 : 0;
    if (ao !== bo) return bo - ao;
    const al = a.liveEligible ? 1 : 0;
    const bl = b.liveEligible ? 1 : 0;
    if (al !== bl) return bl - al;
    const ae = a.entryCandidate ? 1 : 0;
    const be = b.entryCandidate ? 1 : 0;
    if (ae !== be) return be - ae;
    const as = a.shadowObservable ? 1 : 0;
    const bs = b.shadowObservable ? 1 : 0;
    if (as !== bs) return bs - as;
    if (a.lastUpdatedAt !== b.lastUpdatedAt) return b.lastUpdatedAt - a.lastUpdatedAt;
    return a.code.localeCompare(b.code);
  });
}

// ── 모듈-로컬 구독 상태 ────────────────────────────────────────────────────

const _subscribedPriorities = new Map<string, SubscribedEntry>();
let _stats = {
  invalidRejectedCount: 0,
  lowPriorityRejectedCount: 0,
  evictedCount: 0,
  lastEvictedCode: undefined as string | undefined,
  lastEvictedReason: undefined as SubscriptionPriorityReason | undefined,
};

/** 테스트 격리 — 모듈 로컬 상태 reset. */
export function __resetKisWsSubscriptionStateForTests(): void {
  _subscribedPriorities.clear();
  _stats = {
    invalidRejectedCount: 0,
    lowPriorityRejectedCount: 0,
    evictedCount: 0,
    lastEvictedCode: undefined,
    lastEvictedReason: undefined,
  };
}

// ── eviction 정책 SSOT (사용자 §3 절대 변경 금지) ─────────────────────────

/**
 * eviction 후보 선정. openPosition 은 절대 evict 금지.
 *   - asc priority (최저 먼저)
 *   - 동률 시 OBSERVE_ONLY/DATA_UNAVAILABLE/PROVIDER_DEGRADED/WAIT_LONG 먼저
 *   - 그 다음 lastUpdatedAt 오래된 것 먼저
 *   - min-hold 미만은 후보에서 제외 (단 forceImmediate=true 시 우회)
 */
export function chooseEvictionTarget(
  subscribed: SubscribedEntry[],
  options: { now?: number; forceImmediate?: boolean; minHoldMs?: number } = {},
): SubscribedEntry | null {
  const now = options.now ?? Date.now();
  const minHold = options.minHoldMs ?? KIS_WS_SUBSCRIPTION_MIN_HOLD_MS;
  let evictable = subscribed.filter((s) => !s.openPosition);
  if (evictable.length === 0) return null;
  if (!options.forceImmediate) {
    evictable = evictable.filter((s) => now - s.lastUpdatedAt >= minHold);
    if (evictable.length === 0) return null;
  }
  const lowPriorityReasons = new Set<SubscriptionPriorityReason>([
    'OBSERVE_ONLY',
    'DATA_UNAVAILABLE',
    'PROVIDER_DEGRADED',
    'WAIT_LONG',
  ]);
  evictable.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aLow = a.reasons.some((r) => lowPriorityReasons.has(r));
    const bLow = b.reasons.some((r) => lowPriorityReasons.has(r));
    if (aLow !== bLow) return aLow ? -1 : 1;
    return a.lastUpdatedAt - b.lastUpdatedAt;
  });
  return evictable[0] ?? null;
}

// ── 메인 진입점 ────────────────────────────────────────────────────────────

interface RequestContext {
  now?: number;
  /** 테스트 또는 외부 영속 시 직접 주입 가능 — production 은 module-local Map 사용 */
  subscribedPriorities?: Map<string, SubscribedEntry>;
  subscribeFn?: (code: string) => boolean;
  unsubscribeFn?: (code: string) => void;
  minHoldMs?: number;
  limit?: number;
  /**
   * priority 가 명시되지 않은 경우 reasons 의 최댓값 매트릭스를 priority 로 채택.
   * spec §"매트릭스 SSOT 절대 변경 금지" 정합.
   */
  derivePriorityFromReasons?: boolean;
}

function derivePriorityFromReasons(
  reasons: SubscriptionPriorityReason[],
): number {
  if (reasons.length === 0) return SUBSCRIPTION_PRIORITY_TABLE.UNKNOWN;
  let max = 0;
  for (const r of reasons) {
    const p = SUBSCRIPTION_PRIORITY_TABLE[r];
    if (p > max) max = p;
  }
  return max;
}

/**
 * candidate 1건 등록 — subscribe / keep / unsubscribe / reject 결정.
 *
 * 호출자 (helpers.ts:getPrice) 가 GateEligibility 결과 / 보유 여부 / watchlist 여부를
 * candidate 인자로 전달. priority 는 reasons 로부터 자동 도출 또는 명시.
 */
export function requestKisWsSubscription(
  candidate: {
    code: string;
    name?: string;
    priority?: number;
    reasons: SubscriptionPriorityReason[];
    liveEligible?: boolean;
    shadowObservable?: boolean;
    entryCandidate?: boolean;
    openPosition?: boolean;
    observeOnly?: boolean;
  },
  ctx: RequestContext = {},
): SubscriptionDecision {
  const now = ctx.now ?? Date.now();
  const limit = ctx.limit ?? KIS_WS_SUBSCRIPTION_LIMIT;
  const minHold = ctx.minHoldMs ?? KIS_WS_SUBSCRIPTION_MIN_HOLD_MS;
  const subscribedMap = ctx.subscribedPriorities ?? _subscribedPriorities;
  const subscribeFn = ctx.subscribeFn ?? kisSubscribeStock;
  const unsubscribeFn = ctx.unsubscribeFn ?? kisUnsubscribeStock;

  // 1. invalid code guard
  const normalizedCode = normalizeKrxCodeForWs(candidate.code);
  if (!normalizedCode) {
    _stats.invalidRejectedCount++;
    logNoiseDetail({ category: 'KIS_WS_DETAIL', message: `[KIS-WS] reject invalid code ${candidate.code}` });
    return {
      action: 'REJECT_INVALID_CODE',
      code: typeof candidate.code === 'string' ? candidate.code : String(candidate.code),
      reasons: ['INVALID_CODE'],
    };
  }

  // 2. priority 도출 (명시 우선, 미명시 시 reasons 매트릭스 최댓값)
  const priority =
    typeof candidate.priority === 'number' && Number.isFinite(candidate.priority)
      ? candidate.priority
      : derivePriorityFromReasons(candidate.reasons);

  // 3. HARD_RISK_BLOCK / INVALID_CODE reasons (priority 0) — 즉시 unsubscribe (보유 시)
  const hasHardBlock = candidate.reasons.some(
    (r) => r === 'HARD_RISK_BLOCK' || r === 'INVALID_CODE',
  );
  if (hasHardBlock || priority === 0) {
    const existing = subscribedMap.get(normalizedCode);
    if (existing) {
      // openPosition 은 그래도 보호 (HARD_RISK_BLOCK 자체가 무효화되어야 정상)
      if (existing.openPosition) {
        return {
          action: 'KEEP',
          code: normalizedCode,
          priority: existing.priority,
          reasons: existing.reasons,
        };
      }
      subscribedMap.delete(normalizedCode);
      try {
        unsubscribeFn(normalizedCode);
      } catch {
        // unsubscribe 실패는 매수 흐름 차단 안 함
      }
      _stats.evictedCount++;
      _stats.lastEvictedCode = normalizedCode;
      _stats.lastEvictedReason = 'HARD_RISK_BLOCK';
      logNoiseDetail({
        category: 'KIS_WS_DETAIL',
        message: `[KIS-WS] evict ${normalizedCode} priority=${existing.priority} reason=HARD_RISK_BLOCK (immediate)`,
      });
      return {
        action: 'UNSUBSCRIBE',
        code: normalizedCode,
        priority,
        reasons: candidate.reasons,
      };
    }
    // 보유 중이 아니면 그냥 reject low priority
    _stats.lowPriorityRejectedCount++;
    return {
      action: 'REJECT_LOW_PRIORITY',
      code: normalizedCode,
      priority,
      reasons: candidate.reasons,
      minSubscribedPriority: 0,
    };
  }

  // 4. 이미 구독 중 → KEEP (priority 갱신, lastUpdatedAt 갱신 없음 — min-hold 정책 보존)
  const existing = subscribedMap.get(normalizedCode);
  if (existing) {
    // priority 상승 시 즉시 반영 (unsubscribe 없음)
    if (priority > existing.priority) {
      existing.priority = priority;
      existing.reasons = Array.from(new Set([...existing.reasons, ...candidate.reasons]));
      existing.openPosition = candidate.openPosition || existing.openPosition;
      existing.liveEligible = candidate.liveEligible || existing.liveEligible;
      existing.shadowObservable = candidate.shadowObservable || existing.shadowObservable;
      logNoiseDetail({
        category: 'KIS_WS_DETAIL',
        message: `[KIS-WS] keep ${normalizedCode} priority=${priority} reason=${candidate.reasons[0] ?? 'UNKNOWN'} (priority 상승)`,
      });
    } else {
      logNoiseDetail({
        category: 'KIS_WS_DETAIL',
        message: `[KIS-WS] keep ${normalizedCode} priority=${existing.priority} reason=${existing.reasons[0] ?? 'UNKNOWN'}`,
      });
    }
    return {
      action: 'KEEP',
      code: normalizedCode,
      priority: existing.priority,
      reasons: existing.reasons,
    };
  }

  // 5. 신규 구독 — 슬롯 여유 시 즉시 SUBSCRIBE
  if (subscribedMap.size < limit) {
    const entry: SubscribedEntry = {
      code: normalizedCode,
      priority,
      reasons: [...candidate.reasons],
      lastUpdatedAt: now,
      openPosition: candidate.openPosition,
      liveEligible: candidate.liveEligible,
      shadowObservable: candidate.shadowObservable,
    };
    subscribedMap.set(normalizedCode, entry);
    try {
      subscribeFn(normalizedCode);
    } catch (e) {
      // subscribe 실패 시 entry 제거 (장중 disconnected 등)
      subscribedMap.delete(normalizedCode);
      if (isCoreWatchlistHighPriorityFailure({ priority, reasons: candidate.reasons })) {
        console.warn(
          `[KIS-WS] subscribe failed core watchlist ${normalizedCode} priority=${priority} reason=${candidate.reasons[0] ?? 'UNKNOWN'}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    logNoiseDetail({
      category: 'KIS_WS_DETAIL',
      message: `[KIS-WS] subscribe queued ${normalizedCode} priority=${priority} reason=${candidate.reasons[0] ?? 'UNKNOWN'}`,
    });
    return {
      action: 'SUBSCRIBE',
      code: normalizedCode,
      priority,
      reasons: candidate.reasons,
    };
  }

  // 6. 슬롯 포화 — eviction 시도
  const subscribedArr = Array.from(subscribedMap.values());
  const evictionTarget = chooseEvictionTarget(subscribedArr, { now, minHoldMs: minHold });

  // 6-1. evict 가능한 후보가 있고 + 신규 priority > evict 후보 priority 면 evict + subscribe
  if (evictionTarget && priority > evictionTarget.priority) {
    subscribedMap.delete(evictionTarget.code);
    try {
      unsubscribeFn(evictionTarget.code);
    } catch {
      // unsubscribe 실패는 매수 흐름 차단 안 함
    }
    _stats.evictedCount++;
    _stats.lastEvictedCode = evictionTarget.code;
    _stats.lastEvictedReason = evictionTarget.reasons[0] ?? 'UNKNOWN';
    const entry: SubscribedEntry = {
      code: normalizedCode,
      priority,
      reasons: [...candidate.reasons],
      lastUpdatedAt: now,
      openPosition: candidate.openPosition,
      liveEligible: candidate.liveEligible,
      shadowObservable: candidate.shadowObservable,
    };
    subscribedMap.set(normalizedCode, entry);
    try {
      subscribeFn(normalizedCode);
    } catch (e) {
      subscribedMap.delete(normalizedCode);
      if (isCoreWatchlistHighPriorityFailure({ priority, reasons: candidate.reasons })) {
        console.warn(
          `[KIS-WS] subscribe failed core watchlist ${normalizedCode} priority=${priority} reason=${candidate.reasons[0] ?? 'UNKNOWN'}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    logNoiseDetail({
      category: 'KIS_WS_DETAIL',
      message: `[KIS-WS] evict ${evictionTarget.code} priority=${evictionTarget.priority} reason=${evictionTarget.reasons[0] ?? 'UNKNOWN'} → subscribe ${normalizedCode} priority=${priority} reason=${candidate.reasons[0] ?? 'UNKNOWN'}`,
    });
    return {
      action: 'SUBSCRIBE',
      code: normalizedCode,
      priority,
      reasons: candidate.reasons,
    };
  }

  // 6-2. evict 불가 또는 신규 priority 가 더 낮음 → REJECT_LOW_PRIORITY
  const minSubscribedPriority = subscribedArr.reduce(
    (min, s) => (s.priority < min ? s.priority : min),
    Number.MAX_SAFE_INTEGER,
  );
  _stats.lowPriorityRejectedCount++;
  logNoiseDetail({
    category: 'KIS_WS_DETAIL',
    message: `[KIS-WS] reject low priority ${normalizedCode} priority=${priority} limit=${limit} minPriority=${minSubscribedPriority}`,
  });
  return {
    action: 'REJECT_LOW_PRIORITY',
    code: normalizedCode,
    priority,
    reasons: candidate.reasons,
    minSubscribedPriority,
  };
}

/**
 * 일괄 진입점 — startKisStream 패턴.
 * 후보 정렬 후 top-N 만 SUBSCRIBE, 나머지는 REJECT_LOW_PRIORITY.
 *
 * 본 PR scope 외 호출자 wiring (reconnectWs.cmd.ts, kisStreamJobs.ts 등) 은 후속 PR.
 */
export function bulkApplySubscriptionsByPriority(
  candidates: SubscriptionCandidate[],
  ctx: RequestContext = {},
): SubscriptionDecision[] {
  const limit = ctx.limit ?? KIS_WS_SUBSCRIPTION_LIMIT;
  const deduped = dedupeCandidates(candidates);
  const sorted = sortCandidatesByPriority(deduped);
  const decisions: SubscriptionDecision[] = [];
  // top-N 은 subscribe 시도, 나머지는 reject
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (i < limit) {
      const decision = requestKisWsSubscription(
        {
          code: c.code,
          name: c.name,
          priority: c.priority,
          reasons: c.reasons,
          liveEligible: c.liveEligible,
          shadowObservable: c.shadowObservable,
          entryCandidate: c.entryCandidate,
          openPosition: c.openPosition,
          observeOnly: c.observeOnly,
        },
        ctx,
      );
      decisions.push(decision);
    } else {
      // 32~50번째는 limit 초과 — REJECT_LOW_PRIORITY 결정만 영속 (subscribe 호출 0)
      decisions.push({
        action: 'REJECT_LOW_PRIORITY',
        code: c.code,
        priority: c.priority,
        reasons: c.reasons,
        minSubscribedPriority: sorted[limit - 1]?.priority ?? 0,
      });
    }
  }
  const active = (ctx.subscribedPriorities ?? _subscribedPriorities).size;
  logKisWsNoiseSummary(summarizeKisWsDecisions(decisions, active, limit));
  return decisions;
}

// ── 진단 SSOT ──────────────────────────────────────────────────────────────

export function buildSubscriptionDiagnosis(
  ctx: { subscribedPriorities?: Map<string, SubscribedEntry> } = {},
): SubscriptionDiagnosis {
  const subscribedMap = ctx.subscribedPriorities ?? _subscribedPriorities;
  const arr = Array.from(subscribedMap.values());
  const openPositionCount = arr.filter((s) => s.openPosition).length;
  const liveEligibleCount = arr.filter((s) => s.liveEligible).length;
  const shadowObservableCount = arr.filter((s) => s.shadowObservable).length;
  const observeReasons = new Set<SubscriptionPriorityReason>([
    'OBSERVE_ONLY',
    'PROVIDER_DEGRADED',
    'DATA_UNAVAILABLE',
    'WAIT_LONG',
  ]);
  const observeOnlyCount = arr.filter((s) =>
    s.reasons.some((r) => observeReasons.has(r)),
  ).length;
  // watchlist 는 open/live/shadow + observe 분류 모두 아닌 잔여
  const watchlistCount = arr.filter(
    (s) =>
      !s.openPosition &&
      !s.liveEligible &&
      !s.shadowObservable &&
      !s.reasons.some((r) => observeReasons.has(r)),
  ).length;
  return {
    total: arr.length,
    limit: KIS_WS_SUBSCRIPTION_LIMIT,
    openPositionCount,
    liveEligibleCount,
    shadowObservableCount,
    watchlistCount,
    observeOnlyCount,
    invalidRejectedCount: _stats.invalidRejectedCount,
    lowPriorityRejectedCount: _stats.lowPriorityRejectedCount,
    evictedCount: _stats.evictedCount,
    lastEvictedCode: _stats.lastEvictedCode,
    lastEvictedReason: _stats.lastEvictedReason,
  };
}

/**
 * /scan_blockers 또는 /health 임베드용 SSOT.
 *
 * ADR-0442 — `/scan_blockers` (full section) 와 `/health` (compact line) 양 명령
 * wiring 정착. 운영자 슬롯 분배 가시화 (open/live/shadow/watchlist/observe/rejected/evicted).
 *
 * 사용자 §8 명시 형식:
 *   [KIS-WS] subscription summary total=30 open=2 live=5 shadow=8 watchlist=10 observe=5 rejected=12
 */
export function formatKisWsSubscriptionSection(diag: SubscriptionDiagnosis): string {
  const lines: string[] = [];
  lines.push('🛰️ KIS WebSocket Subscription Queue (ADR-0437)');
  lines.push(
    `total: ${diag.total}/${diag.limit} | open: ${diag.openPositionCount} | live: ${diag.liveEligibleCount} | shadow: ${diag.shadowObservableCount} | watchlist: ${diag.watchlistCount} | observe: ${diag.observeOnlyCount}`,
  );
  if (diag.invalidRejectedCount > 0 || diag.lowPriorityRejectedCount > 0 || diag.evictedCount > 0) {
    const rejected = diag.invalidRejectedCount + diag.lowPriorityRejectedCount;
    lines.push(
      `rejected: ${rejected} (invalid: ${diag.invalidRejectedCount}, low-priority: ${diag.lowPriorityRejectedCount}) | evicted: ${diag.evictedCount}`,
    );
    if (diag.lastEvictedCode) {
      lines.push(
        `lastEvicted: ${diag.lastEvictedCode} reason=${diag.lastEvictedReason ?? 'UNKNOWN'}`,
      );
    }
  }
  return lines.join('\n');
}
