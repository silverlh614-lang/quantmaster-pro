// @responsibility ADR-0174 §2.2 ShadowVsLiveDelta — 5 카테고리 missedAlpha 분석 SSOT (관측 전용 ENV OFF·사이징 델타 Phase 3 완성)
/**
 * shadowVsLiveDelta.ts (ADR-0174 §2.2) — Phase 2a 영속 분석 SSOT.
 *
 * Phase 1 영속 (ShadowLearningOnlySignal) + LIVE 영속 (ServerShadowTrade) 비교 →
 * 5 카테고리 missedAlpha 측정 — *Shadow 가 샀더라면 vs 실제 LIVE 결과* 의 차이.
 *
 * wiring(관측 전용):
 *   - 호출자 = learningJobs cron / nightlyReflectionEngine / missedLearningReplayDispatcher /
 *     learningRouter — 전부 read-only 리포트·학습 귀인 (LIVE 판정 미반영, ENV OFF 시 빈 배열)
 *   - signalScanner / entryEngine / exitEngine 본체 무수정
 *   - LIVE 매매 본체 0줄 변경
 *
 * 안전 invariant 4종 (ADR-0174 §3):
 *   1. LIVE 매매 본체 0줄 변경
 *   2. KIS 주문 함수 import 0건 (정적 grep 가드)
 *   3. 외부 의존성 0 (fs/외부 API/zustand store 미사용 — 순수 함수)
 *   4. ENV `SHADOW_LIVE_DELTA_REPORT_ENABLED` default OFF (`=== 'true'` 정확 비교) → 소비자 미반영
 *
 * 5 카테고리 분류 SSOT (ADR-0174 §2.2):
 *   - SHADOW_BUY_LIVE_BLOCKED       — Shadow 샀는데 Live 못 산 (signal.wouldHaveBought=true AND LIVE trade 부재)
 *   - LIVE_BUY_SHADOW_BETTER_SIZE   — Live 샀는데 Shadow 더 좋은 사이징 (basePct 미감쇠 vs finalPositionPct 실적용 델타)
 *   - EXPOSURE_CAP_REDUCED          — Exposure cap 으로 줄어든 (cappedByBudget=true 옵셔널)
 *   - MACRO_GATE_BLOCKED            — Macro gate 막힌 (FOMC/VIX/RISK_OFF/R0/R1)
 *   - LIQUIDITY_GATE_BLOCKED        — Liquidity gate 막힌 (LIQUIDITY_BLOCK)
 *
 * missedAlpha = shadowReturn - liveReturn (사용자 §4 명시):
 *   - missedAlpha > 0 — 보수적으로 막아서 *돈을 못 번 경우* (기회 손실)
 *   - missedAlpha < 0 — *살아남은 효과* (Shadow 가 샀더라면 손실)
 */

import type {
  ShadowLearningOnlySignal,
  ShadowLearningOnlyScanReason,
} from '../trading/shadowLearningOnlyScan.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

// ─── 타입 SSOT ────────────────────────────────────────────────────────────────

export type DeltaCategory =
  | 'SHADOW_BUY_LIVE_BLOCKED'
  | 'LIVE_BUY_SHADOW_BETTER_SIZE'
  | 'EXPOSURE_CAP_REDUCED'
  | 'MACRO_GATE_BLOCKED'
  | 'LIQUIDITY_GATE_BLOCKED';

export interface DeltaCategoryResult {
  category: DeltaCategory;
  sampleSize: number;
  /** Shadow 가정 수익률 합산. 대부분 signal.futureReturn{horizon}d, LIVE_BUY_SHADOW_BETTER_SIZE 는 returnPct×shadowSize(basePct). */
  shadowReturnSum: number;
  /** LIVE 수익률 합산. LIVE_BUY_SHADOW_BETTER_SIZE 는 size-weighted(returnPct×liveSize), 그 외는 raw future/return 합. */
  liveReturnSum: number;
  /** shadowReturn - liveReturn. */
  missedAlpha: number;
  /** 평균 — sampleSize=0 시 0. */
  missedAlphaAvg: number;
  /**
   * 조건은 만족했으나 `returnPct` 미해소(미청산·결손)라 집계에서 *제외* 된 표본 수.
   * sampleSize 와 별개 — >0 이면 "결과 대기 중" 이지 "효과 0" 이 아니다 (정직 표기).
   * signal 기반 카테고리는 futureReturn 부재 시 애초에 스킵되므로 항상 0.
   */
  unresolvedExcluded: number;
}

export interface ShadowVsLiveDeltaInput {
  shadowSignals: ShadowLearningOnlySignal[];
  liveTrades: ServerShadowTrade[];
  options?: {
    lookbackDays?: number;
    futureReturnHorizon?: 1 | 3 | 5 | 20;
  };
}

// ─── 상수 SSOT ────────────────────────────────────────────────────────────────

export const DEFAULT_LOOKBACK_DAYS = 90;
export const DEFAULT_FUTURE_RETURN_HORIZON: 1 | 3 | 5 | 20 = 5;

/**
 * 5 카테고리 모두 entry 반환 — sampleSize=0 dead entry 도 호출자 일관성 위해 항상 포함.
 */
export const ALL_DELTA_CATEGORIES: readonly DeltaCategory[] = [
  'SHADOW_BUY_LIVE_BLOCKED',
  'LIVE_BUY_SHADOW_BETTER_SIZE',
  'EXPOSURE_CAP_REDUCED',
  'MACRO_GATE_BLOCKED',
  'LIQUIDITY_GATE_BLOCKED',
] as const;

/**
 * MACRO_GATE_BLOCKED 식별 reason set — ShadowLearningOnlyScanReason 5 union.
 */
export const MACRO_GATE_REASONS: ReadonlySet<ShadowLearningOnlyScanReason> = new Set<ShadowLearningOnlyScanReason>([
  'FOMC_BLOCK',
  'VIX_SPIKE',
  'RISK_OFF_REGIME',
  'R0_CRISIS',
  'R1_DEFENSIVE',
]);

// ─── ENV 헬퍼 ─────────────────────────────────────────────────────────────────

/**
 * ENV `SHADOW_LIVE_DELTA_REPORT_ENABLED=true` 정확 비교.
 *   - `'1'` / `'TRUE'` / 임의 truthy 모두 거부
 *   - default OFF — Phase 4 Dashboard 또는 Phase 2b cron read 후 활성화
 */
export function isShadowVsLiveDeltaEnabled(): boolean {
  return process.env.SHADOW_LIVE_DELTA_REPORT_ENABLED === 'true';
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/**
 * KST YYYY-MM-DD 일자 ms 변환 (lookbackDays 비교 + LIVE 일자 매칭용).
 * 잘못된 형식 → null. 외부 의존성 0 invariant — 자체 inline 변환.
 */
function parseSignalDateKstMs(signalDate: string): number | null {
  if (typeof signalDate !== 'string' || signalDate.length < 10) return null;
  const ymd = signalDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const ms = new Date(`${ymd}T00:00:00Z`).getTime();
  if (!Number.isFinite(ms)) return null;
  return ms;
}

/**
 * ServerShadowTrade.signalTime (ISO) → KST YYYY-MM-DD 일자 string.
 * 잘못된 ISO → null. 외부 의존성 0 invariant.
 *
 * 우선순위: signalTime → 부재 시 null (호출자 분류 제외).
 */
function tradeKstDate(trade: ServerShadowTrade): string | null {
  const ts = trade.signalTime;
  if (typeof ts !== 'string' || ts.length < 10) return null;
  // ISO 8601 — `2026-05-03T01:23:45.000Z` 또는 YYYY-MM-DD
  // KST = UTC + 9h
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstMs = ms + KST_OFFSET_MS;
  const kstDate = new Date(kstMs);
  if (!Number.isFinite(kstDate.getTime())) return null;
  return kstDate.toISOString().slice(0, 10);
}

/**
 * signal 의 horizon 별 future return 추출.
 * undefined / NaN / Infinity 시 null.
 */
function getFutureReturn(
  signal: ShadowLearningOnlySignal,
  horizon: 1 | 3 | 5 | 20,
): number | null {
  let value: number | undefined;
  switch (horizon) {
    case 1:
      value = signal.futureReturn1d;
      break;
    case 3:
      value = signal.futureReturn3d;
      break;
    case 5:
      value = signal.futureReturn5d;
      break;
    case 20:
      value = signal.futureReturn20d;
      break;
    default:
      return null;
  }
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * trade 의 returnPct 추출 (LIVE 결과 수익률). **미해소(미청산·결손) → null.**
 *
 * 구 `getTradeReturn` 은 값 부재를 0 으로 대체했는데, 그러면 "아직 결과가 없음" 이
 * "수익률 0%" 으로 둔갑해 missedAlpha=0 이 *산출된 답* 처럼 보였다 (silent degradation).
 * 운영 실측에서 LIVE_BUY_SHADOW_BETTER_SIZE n=12 인데 양쪽 합이 정확히 0 이던 원인.
 * 호출자는 null 표본을 집계에서 제외하고 `unresolvedExcluded` 로 별도 노출한다.
 */
function resolveTradeReturn(trade: ServerShadowTrade): number | null {
  const value = trade.returnPct;
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * trade 의 cappedByBudget 옵셔널 read — ServerShadowTrade schema 영속 부재 대응.
 * 향후 (ADR-0166 wiring 후) schema 추가되면 자동 활성. 본 PR 은 optional chaining + fallback false.
 */
function getCappedByBudget(trade: ServerShadowTrade): boolean {
  // ServerShadowTrade schema 부재 시 안전 fallback (Phase 3 wiring 의존)
  const value = (trade as { cappedByBudget?: boolean }).cappedByBudget;
  return value === true;
}

/**
 * sizingEngineSnapshot 에서 shadow(감쇠 전 basePct) / live(감쇠 후 finalPositionPct) 사이징 추출.
 * 두 값 모두 fraction(0.10 = 10%). 스냅샷 부재 또는 어느 하나라도 non-finite → null
 * (호출자 분류 제외 — 회귀 안전, 기존 "부재→sampleSize=0" 계약 보존).
 */
function getSizingShadowLivePct(
  trade: ServerShadowTrade,
): { shadowPct: number; livePct: number } | null {
  const snap = trade.sizingEngineSnapshot;
  if (snap === undefined) return null;
  const shadowPct = snap.basePct;
  const livePct = snap.finalPositionPct;
  if (!Number.isFinite(shadowPct) || !Number.isFinite(livePct)) return null;
  return { shadowPct, livePct };
}

// ─── 진입점 ───────────────────────────────────────────────────────────────────

/**
 * Shadow vs Live 5 카테고리 missedAlpha 측정 — 사용자 §4 정합.
 *
 * 동작:
 *   1. ENV OFF → 빈 배열 즉시 반환
 *   2. shadowSignals lookback 필터
 *   3. shadowSignals → 카테고리 분류 (LIQUIDITY_GATE / MACRO_GATE / SHADOW_BUY_LIVE_BLOCKED)
 *   4. liveTrades → 카테고리 분류 (EXPOSURE_CAP_REDUCED / LIVE_BUY_SHADOW_BETTER_SIZE plumbing)
 *   5. 각 카테고리 sum 누적 + missedAlpha = shadowReturn - liveReturn
 *   6. 5 DeltaCategory 모두 entry 반환 (sampleSize=0 dead 포함)
 *
 * 입력 — 영속 read 결과 (호출자 책임). 본 함수는 *순수* — fs/외부 API 호출 0건.
 *
 * @returns ENV OFF → [] / ENV ON → 5 DeltaCategory entry
 */
export function computeShadowVsLiveDelta(
  input: ShadowVsLiveDeltaInput,
): DeltaCategoryResult[] {
  if (!isShadowVsLiveDeltaEnabled()) return [];

  const lookbackDays = input.options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const horizon = input.options?.futureReturnHorizon ?? DEFAULT_FUTURE_RETURN_HORIZON;

  // 5 DeltaCategory 누적기 초기화 (sampleSize=0 dead 일관성)
  const buckets = new Map<
    DeltaCategory,
    { sampleSize: number; shadowReturnSum: number; liveReturnSum: number; unresolvedExcluded: number }
  >();
  for (const cat of ALL_DELTA_CATEGORIES) {
    buckets.set(cat, { sampleSize: 0, shadowReturnSum: 0, liveReturnSum: 0, unresolvedExcluded: 0 });
  }

  // lookback cutoff
  const nowMs = Date.now();
  const cutoffMs = nowMs - lookbackDays * 24 * 60 * 60 * 1000;

  // LIVE trade 인덱스 — 매칭 효율 + lookback 필터
  // key: `${stockCode}:${kstDateYmd}` → trade
  const liveTradeIndex = new Map<string, ServerShadowTrade>();
  for (const trade of input.liveTrades) {
    const kstDate = tradeKstDate(trade);
    if (kstDate === null) continue;
    const sigMs = parseSignalDateKstMs(kstDate);
    if (sigMs === null) continue;
    if (sigMs < cutoffMs) continue;
    if (typeof trade.stockCode !== 'string' || trade.stockCode.length === 0) continue;
    const key = `${trade.stockCode}:${kstDate}`;
    // 동일 key 중복 시 첫 번째 보존 (FIFO — 영속 순서 의존)
    if (!liveTradeIndex.has(key)) {
      liveTradeIndex.set(key, trade);
    }
  }

  // 1. shadowSignals → 분류
  for (const signal of input.shadowSignals) {
    // lookback 필터
    const sigMs = parseSignalDateKstMs(signal.signalDate);
    if (sigMs === null) continue;
    if (sigMs < cutoffMs) continue;

    if (typeof signal.symbol !== 'string' || signal.symbol.length === 0) continue;

    const fr = getFutureReturn(signal, horizon);
    if (fr === null) continue;

    // LIQUIDITY_GATE_BLOCKED
    if (signal.blockedReason === 'LIQUIDITY_BLOCK') {
      const bucket = buckets.get('LIQUIDITY_GATE_BLOCKED');
      if (bucket) {
        bucket.sampleSize += 1;
        bucket.shadowReturnSum += fr;
        // LIVE 부재 (signal 이 차단된 경우라 LIVE trade 도 부재 가정)
      }
      continue;
    }

    // MACRO_GATE_BLOCKED
    if (MACRO_GATE_REASONS.has(signal.blockedReason)) {
      const bucket = buckets.get('MACRO_GATE_BLOCKED');
      if (bucket) {
        bucket.sampleSize += 1;
        bucket.shadowReturnSum += fr;
      }
      continue;
    }

    // SHADOW_BUY_LIVE_BLOCKED — wouldHaveBought=true AND LIVE 부재 (KST 일자 매칭)
    if (signal.wouldHaveBought === true) {
      const ymd = signal.signalDate.slice(0, 10);
      const liveKey = `${signal.symbol}:${ymd}`;
      const liveTrade = liveTradeIndex.get(liveKey);
      if (liveTrade === undefined) {
        // LIVE 부재 → SHADOW_BUY_LIVE_BLOCKED
        const bucket = buckets.get('SHADOW_BUY_LIVE_BLOCKED');
        if (bucket) {
          bucket.sampleSize += 1;
          bucket.shadowReturnSum += fr;
        }
      }
      // LIVE 존재 시 → 본 PR 은 LIVE_BUY_SHADOW_BETTER_SIZE plumbing 으로 별도 분류
    }
  }

  // 2. liveTrades → 분류 (EXPOSURE_CAP_REDUCED / LIVE_BUY_SHADOW_BETTER_SIZE)
  // EXPOSURE_CAP_REDUCED: cappedByBudget=true (ADR-0166 영속 부재 시 빈 결과 fallback)
  // LIVE_BUY_SHADOW_BETTER_SIZE: sizingEngineSnapshot 정의된 trade 만 plumbing 카운트
  for (const [, trade] of liveTradeIndex) {
    // 미해소(미청산·결손) → null. 0 으로 대체하지 않는다 — "결과 대기" 를 "수익률 0" 으로
    // 둔갑시키면 missedAlpha=0 이 산출된 답처럼 보인다 (silent degradation 금지).
    const liveReturn = resolveTradeReturn(trade);

    // EXPOSURE_CAP_REDUCED — cappedByBudget=true
    if (getCappedByBudget(trade)) {
      const bucket = buckets.get('EXPOSURE_CAP_REDUCED');
      if (bucket) {
        if (liveReturn === null) {
          bucket.unresolvedExcluded += 1;
        } else {
          bucket.sampleSize += 1;
          bucket.liveReturnSum += liveReturn;
          // shadowReturn — 본 PR plumbing only, 후속 PR 에서 정확 산출
        }
      }
    }

    // LIVE_BUY_SHADOW_BETTER_SIZE — 사이징 감쇠 미실행(shadow) vs 실적용(live) 델타 (Phase 3 완성).
    //   shadowSize = basePct(리스크 배수 감쇠 전 기본 티어 사이징)
    //   liveSize   = finalPositionPct(감쇠 후 실제 적용)
    //   기여 = returnPct × size(둘 다 fraction) → missedAlpha = returnPct × (shadowSize - liveSize).
    //   감쇠로 줄인 승자 → missedAlpha>0(과소사이징 기회손실) / 패자 → <0(감쇠가 손실 방어).
    const sizing = getSizingShadowLivePct(trade);
    if (sizing !== null) {
      const bucket = buckets.get('LIVE_BUY_SHADOW_BETTER_SIZE');
      if (bucket) {
        if (liveReturn === null) {
          // 사이징 스냅샷은 있으나 아직 실현 수익률이 없다 — 집계 제외 + 별도 카운트.
          bucket.unresolvedExcluded += 1;
        } else {
          bucket.sampleSize += 1;
          bucket.liveReturnSum += liveReturn * sizing.livePct;
          bucket.shadowReturnSum += liveReturn * sizing.shadowPct;
        }
      }
    }
  }

  // 결과 합성 — 5 DeltaCategory 모두 entry
  return ALL_DELTA_CATEGORIES.map((category) => {
    const bucket = buckets.get(category);
    if (!bucket) {
      return {
        category,
        sampleSize: 0,
        shadowReturnSum: 0,
        liveReturnSum: 0,
        missedAlpha: 0,
        missedAlphaAvg: 0,
        unresolvedExcluded: 0,
      };
    }
    const missedAlpha = bucket.shadowReturnSum - bucket.liveReturnSum;
    const missedAlphaAvg =
      bucket.sampleSize === 0 ? 0 : missedAlpha / bucket.sampleSize;
    return {
      category,
      sampleSize: bucket.sampleSize,
      shadowReturnSum: bucket.shadowReturnSum,
      liveReturnSum: bucket.liveReturnSum,
      missedAlpha,
      missedAlphaAvg,
      unresolvedExcluded: bucket.unresolvedExcluded,
    };
  });
}
