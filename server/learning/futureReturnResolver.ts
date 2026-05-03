// @responsibility ADR-0175 Phase 2b-1 — ShadowLearningOnlySignal 영속 갱신 cron SSOT (호출자 1건)
/**
 * futureReturnResolver.ts (ADR-0175) — Phase 2b-1 영속 갱신 SSOT.
 *
 * Phase 1 (ADR-0173) `ShadowLearningOnlySignal` 영속의 `futureReturn1d/3d/5d/20d` +
 * `outcome` 필드를 **영속 갱신** — Phase 2a (ADR-0174) SafetyGateAttribution +
 * ShadowVsLiveDelta 분석 SSOT 의 입력 데이터 활성화.
 *
 * ## 동작 결정 트리 (ADR-0175 §2.1)
 *
 * 1. ENV `FUTURE_RETURN_RESOLVER_ENABLED !== 'true'` → 즉시 `{ ... durationMs: 0 }` 반환
 * 2. `loadShadowLearningOnlySignals()` (Phase 1 SSOT) read
 * 3. 각 signal 순회:
 *    - `outcome ∈ {WIN, LOSS, BE}` 이미 closed → skip (불변성 보장)
 *    - signalDate 부터 horizon 영업일 후 *현재 시점 도달* horizon 만 갱신
 *    - `priceFetcher(symbol, asOf=signalDate+horizon영업일)` 호출 →
 *      `(price - hypotheticalEntryPrice) / hypotheticalEntryPrice * 100` 계산
 *    - 가격 fetch 실패 (null/throw) → `errors++` + 다음 horizon 시도 (try/catch 격리)
 *    - 20d 도달 + 모든 horizon (1/3/5/20) 갱신 완료 → outcome 분류 (ADR-0112 임계):
 *      - `futureReturn20d > +1.0` → `outcome='WIN'`
 *      - `futureReturn20d < -0.5` → `outcome='LOSS'`
 *      - 그 외 → `outcome='BE'`
 * 4. `saveShadowLearningOnlySignals(updated)` 영속 (변경된 signal 만, 변경 없으면 skip)
 * 5. 결과 통계 반환
 *
 * ## 안전 invariant 6종 (ADR-0175 §3 절대 규칙)
 *
 *   1. LIVE 매매 본체 0줄 변경 — git diff signalScanner/entryEngine/exitEngine/kisClient
 *      /orchestrator/autoTradeEngine 0 줄
 *   2. KIS 주문 함수 import 0건 — placeKisMarketOrder / placeKisSellOrder /
 *      cancelKisOrder / placeKisStopLossOrder / placeKisTakeProfitOrder 모두 정적
 *      grep 가드 회귀 테스트
 *   3. KIS 호출은 read-only 만 — `priceFetcher` 의존성 주입 (테스트 mock 가능)
 *   4. ENV default OFF — `=== 'true'` 정확 비교 (`'1'`/`'TRUE'` 거부)
 *   5. 호출자 1건 (cron 만) — grep `resolveFutureReturns` = 모듈 + 테스트 + cron 등록
 *   6. closed signal 불변성 — outcome ∈ {WIN/LOSS/BE} 재방문 차단
 *
 * ## priceFetcher 의존성 주입 (ADR-0175 §2.3)
 *
 * 본 PR scope 는 **SSOT + cron 등록 + ENV gate 만** — default `priceFetcher` 미정의.
 * 호출자가 의무적으로 전달. 미전달 시 모든 signal `errors++` + console.warn 1회 (cron
 * 1회당 polling 노이즈 차단).
 *
 * Phase 2b-2 또는 Phase 3 에서 KIS 일봉 API / Yahoo historical API wiring 결정 —
 * 본 PR 은 SSOT 패턴 정착 + 운영자 관측 데이터 확보.
 */

import {
  loadShadowLearningOnlySignals,
  saveShadowLearningOnlySignals,
} from '../persistence/shadowLearningOnlySignalRepo.js';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';
import { isTradingDay } from '../utils/marketDayClassifier.js';
import { EXIT_OUTCOME_THRESHOLDS } from '../trading/exitOutcomeClassifier.js';

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;

/** plan §"horizons default" — 1/3/5/20 영업일 4 분기. */
export const FUTURE_RETURN_HORIZONS = [1, 3, 5, 20] as const;
export type FutureReturnHorizon = (typeof FUTURE_RETURN_HORIZONS)[number];

export interface FutureReturnResolveResult {
  /** 평가 대상 signal 수 (closed 제외, ENV OFF 시 0) */
  totalSignals: number;
  /** futureReturn{N}d 갱신된 signal 수 (한 signal 다중 horizon 갱신 시 1로 카운트) */
  resolvedCount: number;
  /** outcome 분류 갱신 (PENDING → WIN/LOSS/BE) 수 */
  outcomesUpdated: number;
  /** 가격 fetch 실패 (null/throw/priceFetcher 미전달) 등 */
  errors: number;
  /** cron 실행 시간 (ms) */
  durationMs: number;
}

export interface FutureReturnResolveInput {
  /** default `new Date()` — 테스트 시 시각 주입 가능 */
  now?: Date;
  /**
   * 의존성 주입 — `(symbol, asOf) => Promise<number | null>`.
   *
   * 미전달 시 모든 signal `errors++` + console.warn 1회 (KIS quota 0 침범 안전 default).
   * Phase 2b-2/3 wiring 후 cron 호출자가 의무적으로 전달.
   */
  priceFetcher?: PriceFetcher;
  /** default `[1, 3, 5, 20]` — 테스트 시 horizon 일부만 평가 가능 */
  horizons?: readonly FutureReturnHorizon[];
}

export type PriceFetcher = (
  symbol: string,
  asOf: Date,
) => Promise<number | null>;

/**
 * ENV `FUTURE_RETURN_RESOLVER_ENABLED=true` 정확 비교.
 *   - `'1'` / `'TRUE'` / 임의 truthy 모두 거부
 *   - default OFF — 운영자 명시 활성화 의무
 */
export function isFutureReturnResolverEnabled(): boolean {
  return process.env.FUTURE_RETURN_RESOLVER_ENABLED === 'true';
}

// ── 영업일 산출 헬퍼 ────────────────────────────────────────────────────────────
//
// marketDayClassifier 의 `nextTradingDay(ymd)` 는 *본인 또는 본인 이후 첫 영업일* 만
// 반환. N 영업일 후 산출은 자체 헬퍼 필요 — `addBusinessDays` SSOT.

function ymdToUtcMidnight(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function shiftYmd(ymd: string, days: number): string {
  const t = ymdToUtcMidnight(ymd) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * `dateYmd` 기준 N 영업일 후 YYYY-MM-DD 반환 (본인이 영업일이 아니어도 N 만큼 카운트).
 *
 * 알고리즘: `dateYmd + 1` 부터 매일 검사, `isTradingDay` true 일 때만 카운트 증가,
 * count===N 도달 시 해당 날짜 반환. 60일 안전 lookahead (추석 7일 연휴 + N=20 충분).
 *
 * @returns YYYY-MM-DD 또는 빈 문자열 (lookahead 초과 시)
 */
export function addBusinessDays(dateYmd: string, n: number): string {
  if (n <= 0) return dateYmd;
  let count = 0;
  // n=20 + 추석 7일 + 주말 누적 안전 마진 — 60일 lookahead.
  const MAX_LOOKAHEAD = 60;
  for (let i = 1; i <= MAX_LOOKAHEAD; i++) {
    const candidate = shiftYmd(dateYmd, i);
    if (isTradingDay(candidate)) {
      count++;
      if (count === n) return candidate;
    }
  }
  return '';
}

/**
 * `signalDate` (YYYY-MM-DD 또는 ISO) 를 KST 일자로 정규화.
 * - ISO `2026-04-21T...` → `2026-04-21`
 * - YYYY-MM-DD 그대로
 * - 잘못된 형식 → 빈 문자열
 */
function normalizeSignalDate(signalDate: string): string {
  if (!signalDate || typeof signalDate !== 'string') return '';
  // 첫 10자리만 사용 (YYYY-MM-DD prefix 보존)
  const head = signalDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return '';
  return head;
}

/**
 * `now` (UTC Date) 를 KST YYYY-MM-DD 로 변환.
 */
function nowToKstYmd(now: Date): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return kst.toISOString().slice(0, 10);
}

/**
 * horizon 도달 여부 — `signalDate + horizon 영업일 ≤ nowYmd` 이면 true.
 */
function isHorizonReached(signalDate: string, horizon: number, nowYmd: string): boolean {
  const target = addBusinessDays(signalDate, horizon);
  if (!target) return false;
  return target <= nowYmd;
}

// ── outcome 분류 (ADR-0112 임계 정합) ──────────────────────────────────────────

/**
 * 20d 도달 + 모든 horizon 갱신 완료 시 outcome 분류.
 *
 * ADR-0112 `EXIT_OUTCOME_THRESHOLDS` 직접 import 사용 — 임계 drift 차단.
 *   - `futureReturn20d > WIN_PCT_MIN (=1.0)` → WIN
 *   - `futureReturn20d < LOSS_PCT_MAX (=-0.5)` → LOSS
 *   - 그 외 → BE
 */
function classifyOutcomeByFutureReturn(
  futureReturn20d: number,
): 'WIN' | 'LOSS' | 'BE' {
  if (!Number.isFinite(futureReturn20d)) return 'BE';
  if (futureReturn20d > EXIT_OUTCOME_THRESHOLDS.WIN_PCT_MIN) return 'WIN';
  if (futureReturn20d < EXIT_OUTCOME_THRESHOLDS.LOSS_PCT_MAX) return 'LOSS';
  return 'BE';
}

// ── 메인 진입점 ─────────────────────────────────────────────────────────────────

/**
 * Shadow 학습 신호의 future return 영속 갱신 + outcome 분류.
 *
 * **Phase 2b-1 (본 PR)**: cron 단일 호출자. ENV default OFF.
 *
 * 안전 invariant:
 *   - ENV OFF → 즉시 `{ ... durationMs: 0 }` 반환
 *   - priceFetcher 미전달 → 모든 signal `errors++` + console.warn (KIS quota 0)
 *   - closed signal (`outcome ∈ {WIN/LOSS/BE}`) skip — 불변성 보장
 *   - try/catch 격리 — 한 signal throw 가 전체 cron 차단 안 함
 */
export async function resolveFutureReturns(
  input?: FutureReturnResolveInput,
): Promise<FutureReturnResolveResult> {
  const t0 = Date.now();
  const empty: FutureReturnResolveResult = {
    totalSignals: 0,
    resolvedCount: 0,
    outcomesUpdated: 0,
    errors: 0,
    durationMs: 0,
  };

  // (1) ENV gate — default OFF
  if (!isFutureReturnResolverEnabled()) {
    return empty;
  }

  const now = input?.now ?? new Date();
  const nowYmd = nowToKstYmd(now);
  const horizons = input?.horizons ?? FUTURE_RETURN_HORIZONS;
  const priceFetcher = input?.priceFetcher;

  // (2) Phase 1 영속 read
  const signals = loadShadowLearningOnlySignals();

  // closed signal (outcome ∈ {WIN/LOSS/BE}) 자동 제외 — 불변성 invariant.
  const openSignals = signals.filter(
    (s) => !s.outcome || (s.outcome !== 'WIN' && s.outcome !== 'LOSS' && s.outcome !== 'BE'),
  );

  if (openSignals.length === 0) {
    return { ...empty, durationMs: Date.now() - t0 };
  }

  // priceFetcher 미전달 가드 — 모든 signal errors + console.warn 1회.
  if (!priceFetcher) {
    console.warn(
      '[FutureReturnResolver] priceFetcher 미전달 — 모든 signal errors. ADR-0175 §2.3 의무 (Phase 2b-2/3 wiring 결정 대기).',
    );
    return {
      totalSignals: openSignals.length,
      resolvedCount: 0,
      outcomesUpdated: 0,
      errors: openSignals.length,
      durationMs: Date.now() - t0,
    };
  }

  let resolvedCount = 0;
  let outcomesUpdated = 0;
  let errors = 0;
  let mutated = false;

  // (3) signal 순회
  for (const signal of openSignals) {
    const signalDate = normalizeSignalDate(signal.signalDate);
    if (!signalDate) {
      // 잘못된 signalDate — silent skip (영속 데이터 손상 보호)
      continue;
    }

    let signalMutated = false;

    // 각 horizon 분기
    for (const h of horizons) {
      // 이미 갱신된 horizon → skip
      const fieldKey = horizonFieldKey(h);
      const existing = signal[fieldKey];
      if (typeof existing === 'number' && Number.isFinite(existing)) continue;

      // horizon 미도달 → skip (다음 cron 사이클에서 재시도)
      if (!isHorizonReached(signalDate, h, nowYmd)) continue;

      // asOf = signalDate + horizon 영업일 (UTC midnight Date)
      const asOfYmd = addBusinessDays(signalDate, h);
      if (!asOfYmd) continue; // lookahead 초과 (정상 시 발생 안 함)
      const asOf = new Date(ymdToUtcMidnight(asOfYmd));

      // priceFetcher 호출 — try/catch 격리
      let price: number | null = null;
      try {
        price = await priceFetcher(signal.symbol, asOf);
      } catch (e) {
        // throw → errors++ + 다음 horizon 시도
        errors++;
        console.warn(
          `[FutureReturnResolver] priceFetcher throw ${signal.symbol} h=${h}d:`,
          e instanceof Error ? e.message : String(e),
        );
        continue;
      }

      // null 반환 → errors++ + 다음 horizon 시도
      if (price === null || !Number.isFinite(price) || price <= 0) {
        errors++;
        continue;
      }

      // hypotheticalEntryPrice 검증
      const entry = signal.hypotheticalEntryPrice;
      if (!Number.isFinite(entry) || entry <= 0) {
        // entry 손상 — silent skip (영속 데이터 보호)
        continue;
      }

      // futureReturn 계산 — (price - entry) / entry * 100
      const futureReturn = ((price - entry) / entry) * 100;
      signal[fieldKey] = futureReturn;
      signalMutated = true;
    }

    // resolvedCount — 본 cron 사이클에서 horizon 1개 이상 갱신된 signal
    if (signalMutated) {
      resolvedCount++;
      mutated = true;
    }

    // outcome 분류 — 20d 도달 + 모든 horizon 갱신 완료
    const has1d = typeof signal.futureReturn1d === 'number' && Number.isFinite(signal.futureReturn1d);
    const has3d = typeof signal.futureReturn3d === 'number' && Number.isFinite(signal.futureReturn3d);
    const has5d = typeof signal.futureReturn5d === 'number' && Number.isFinite(signal.futureReturn5d);
    const has20d = typeof signal.futureReturn20d === 'number' && Number.isFinite(signal.futureReturn20d);
    const allHorizonsHaveValue = has1d && has3d && has5d && has20d;
    const outcomeNotClosed = !signal.outcome || signal.outcome === 'PENDING';

    if (allHorizonsHaveValue && outcomeNotClosed) {
      const outcome = classifyOutcomeByFutureReturn(signal.futureReturn20d as number);
      signal.outcome = outcome;
      outcomesUpdated++;
      mutated = true;
    }
  }

  // (4) 변경된 signal 만 영속 — 변경 없으면 skip (디스크 I/O 절약)
  if (mutated) {
    saveShadowLearningOnlySignals(signals);
  }

  return {
    totalSignals: openSignals.length,
    resolvedCount,
    outcomesUpdated,
    errors,
    durationMs: Date.now() - t0,
  };
}

/**
 * horizon 숫자 → ShadowLearningOnlySignal 필드 키 매핑.
 */
function horizonFieldKey(
  h: FutureReturnHorizon,
):
  | 'futureReturn1d'
  | 'futureReturn3d'
  | 'futureReturn5d'
  | 'futureReturn20d' {
  switch (h) {
    case 1:
      return 'futureReturn1d';
    case 3:
      return 'futureReturn3d';
    case 5:
      return 'futureReturn5d';
    case 20:
      return 'futureReturn20d';
  }
}

// ── 테스트 전용 export ─────────────────────────────────────────────────────────
//
// 단위 테스트가 내부 헬퍼 검증에 사용. production 호출자 0건 (tree-shake 안전).
export const __testOnly = {
  classifyOutcomeByFutureReturn,
  normalizeSignalDate,
  nowToKstYmd,
  isHorizonReached,
  horizonFieldKey,
};

// ── 호출자 표시 ─────────────────────────────────────────────────────────────────
//
// 본 모듈은 다음 1개 호출자만 가짐 (절대 규칙):
//   - server/scheduler/learningJobs.ts (cron 'future_return_resolve' KST 평일 16:30)
//
// 추가 호출자 (HTTP endpoint / 텔레그램 명령 등) 는 별도 PR + ADR.
// 정적 grep 가드 회귀 테스트가 호출자 1건 강제.
