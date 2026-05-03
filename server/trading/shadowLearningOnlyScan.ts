// @responsibility ADR-0173 §2 ShadowLearningOnlyScan — 매매 금지일 가상 매수 판단 학습 SSOT
/**
 * shadowLearningOnlyScan.ts (ADR-0173 §2) — Phase 1 SSOT (호출자 0건 dead code).
 *
 * 매매 금지일 (FOMC/VIX/R0/R1/Liquidity/Manual/KRX_HOLIDAY_REPLAY/RISK_OFF_REGIME) 에도
 * **실제 주문 없이** Shadow 판단 샘플 생성 — 학습 채널 단절 차단.
 *
 * Phase 1 dead code:
 *   - 호출자 0건 (signalScanner / entryEngine / exitEngine 본체 무수정)
 *   - Phase 2 wiring 별도 PR (5 early-return 직전 + ENV 활성화)
 *   - Phase 3 LIVE 활성화 별도 PR + 별도 ENV
 *
 * 안전 invariant 5종 (ADR-0173 §3, ARCHITECTURE.md):
 *   1. LIVE 매매 본체 0줄 변경
 *   2. KIS 주문 함수 import 0건 — `placeKisMarketOrder` / `placeKisSellOrder` 등 모두 정적 grep 가드
 *   3. `allowRealOrder=true` runtime throw + literal type 2중 강제
 *   4. ENV `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED` default OFF (`=== 'true'` 정확 비교)
 *   5. 호출자 0건 Phase 1 dead code (정적 grep 가드)
 *
 * Phase 2 wiring 시 candidate 평가 / 데이터 sanity / 영속 저장 로직 추가 (TODO 주석 + Phase 2 안내).
 * 본 PR 은 invariant 검증 통과 시 *빈 결과* 반환 — 실제 candidate 평가 미구현.
 */

import { appendShadowLearningOnlySignal } from '../persistence/shadowLearningOnlySignalRepo.js';

// ─── 타입 SSOT ────────────────────────────────────────────────────────────────

/**
 * 매매 차단 사유 — 사용자 §2 명세 직접 정합 (8 union).
 *
 * Phase 2 wiring 시 5 early-return → 본 enum 매핑:
 *   - `R6_DEFENSE` (signalScanner.ts:313) → `R0_CRISIS`
 *   - `vixGating.noNewEntry` (signalScanner.ts:326) → `VIX_SPIKE`
 *   - `fomcProximity.noNewEntry` (signalScanner.ts:359) → `FOMC_BLOCK`
 *   - `regimeSetbackBlock` → `RISK_OFF_REGIME`
 *   - 운영자 emergency → `MANUAL_BLOCK`
 *   - 거래대금 / 시총 임계 미달 → `LIQUIDITY_BLOCK`
 *   - KRX 휴장일 다음 영업일 missed-learning replay → `KRX_HOLIDAY_REPLAY`
 *   - regime R1_DEFENSIVE → `R1_DEFENSIVE`
 */
export type ShadowLearningOnlyScanReason =
  | 'FOMC_BLOCK'
  | 'VIX_SPIKE'
  | 'RISK_OFF_REGIME'
  | 'R0_CRISIS'
  | 'R1_DEFENSIVE'
  | 'KRX_HOLIDAY_REPLAY'
  | 'LIQUIDITY_BLOCK'
  | 'MANUAL_BLOCK';

export interface ShadowLearningOnlyScanInput {
  /**
   * 의무 — `false` literal type. `true` 또는 미전달 시 즉시 throw (LIVE 주문 격리 invariant).
   *
   * 컴파일 시점 + runtime 2중 강제:
   *   - TypeScript literal type — `true` 컴파일 fail
   *   - runtime — `as any` 캐스팅 우회 차단
   */
  allowRealOrder: false;
  /** 의무 — 호출자가 *매크로 게이트 우회 의도* 명시 (boolean). */
  bypassMacroEntryBlock: boolean;
  reason: ShadowLearningOnlyScanReason;
  /** YYYY-MM-DD KST. */
  scanDate: string;
}

/**
 * 영속 schema — 사용자 §2 명세 15+ 필드.
 *
 * 1/3/5/20일 후 future return 은 Phase 2 resolve cron 이 갱신.
 * outcome 은 future return 산출 후 분류 (WIN/LOSS/BE/PENDING).
 */
export interface ShadowLearningOnlySignal {
  symbol: string;
  signalDate: string;
  blockedReason: ShadowLearningOnlyScanReason;
  wouldHaveBought: boolean;
  hypotheticalEntryPrice: number;
  hypotheticalStopLoss: number;
  hypotheticalTargetPrice: number;
  signalGrade: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'NONE';
  gateScore: number;
  regime: string;
  macroBlockReason: string;
  dataQualityStatus: 'OK' | 'STALE' | 'INVALID';
  futureReturn1d?: number;
  futureReturn3d?: number;
  futureReturn5d?: number;
  futureReturn20d?: number;
  outcome?: 'WIN' | 'LOSS' | 'BE' | 'PENDING';
}

export type ShadowLearningOnlyScanResult =
  | { skipped: true; reason: 'ENV_DISABLED' }
  | {
      skipped: false;
      reason: ShadowLearningOnlyScanReason;
      candidates: number;
      wouldBuyCount: number;
      signalsRecorded: number;
    };

// ─── ENV 헬퍼 ─────────────────────────────────────────────────────────────────

/**
 * ENV `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED=true` 정확 비교.
 *   - `'1'` / `'TRUE'` / 임의 truthy 모두 거부
 *   - default OFF — 운영자 명시 활성화 의무
 */
export function isShadowLearningOnBlockedDaysEnabled(): boolean {
  return process.env.SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED === 'true';
}

// ─── 진입점 ───────────────────────────────────────────────────────────────────

/**
 * 매매 금지일 가상 매수 판단 — 학습 전용 SSOT.
 *
 * **Phase 1 (본 PR)**: 안전 invariant 검증만, 실제 candidate 평가 / 영속 저장 미구현
 * (호출자 0건 dead code). Phase 2 wiring 시 `preScreenStocks` / `scoreBuyCandidate` /
 * `safePctChangeStrict` (ADR-0117) / `getDataTrustTier` (ADR-0114) 결합.
 *
 * 안전 invariant:
 *   - `allowRealOrder !== false` → throw (LIVE 주문 격리 invariant)
 *   - ENV OFF → skipped 즉시 반환
 *   - KIS 주문 함수 호출 0건 (정적 grep 가드 회귀 테스트로 강제)
 *
 * @returns Phase 1 dead code → 빈 결과 (`candidates:0, wouldBuyCount:0, signalsRecorded:0`)
 */
export async function runShadowLearningOnlyScan(
  input: ShadowLearningOnlyScanInput,
): Promise<ShadowLearningOnlyScanResult> {
  // 안전 invariant — runtime throw (literal type 우회 차단)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (input.allowRealOrder !== false) {
    throw new Error(
      `[ShadowLearningOnlyScan] allowRealOrder=false invariant violated (received: ${String(
        (input as { allowRealOrder?: unknown }).allowRealOrder,
      )}). LIVE 주문 경로 격리 — ADR-0173 §3.`,
    );
  }

  // ENV gate — default OFF
  if (!isShadowLearningOnBlockedDaysEnabled()) {
    return { skipped: true, reason: 'ENV_DISABLED' };
  }

  // bypassMacroEntryBlock 명시 검증 (boolean 의무) — 호출자 의도 명시
  if (typeof input.bypassMacroEntryBlock !== 'boolean') {
    throw new Error(
      `[ShadowLearningOnlyScan] bypassMacroEntryBlock 은 boolean 의무 (received: ${typeof input.bypassMacroEntryBlock}). 호출자 의도 명시 — ADR-0173 §2.3.`,
    );
  }

  // Phase 1 dead code — 실제 candidate 평가 미구현.
  // Phase 2 wiring 시 다음 plumbing 추가:
  //   1. preScreenStocks(input.scanDate) → candidates
  //   2. 각 candidate: safePctChangeStrict (ADR-0117) + getDataTrustTier (ADR-0114) 검증
  //   3. wouldHaveBought 판단 (gateScore / signalGrade / RRR)
  //   4. appendShadowLearningOnlySignal(signal) 영속 (학습 채널)
  //   5. counterfactualShadow.recordCounterfactual(...) (학습 5채널 중 #1)
  //   6. rejectionShadowTracker.recordRejection(...) (학습 5채널 중 #2)
  //   7. shadowTradeRepo.appendShadow(...) wouldHaveBought=true 시 (학습 5채널 중 #3)

  // Phase 1 dead code: 호출자 0건이지만 ENV ON 시 정합 검증 통과 결과 반환.
  // Phase 2 wiring 후 본 빈 결과는 실제 카운트로 교체.
  void input.scanDate;
  void input.reason;
  void appendShadowLearningOnlySignal; // import 검증 (Phase 2 wiring 입력)

  return {
    skipped: false,
    reason: input.reason,
    candidates: 0,
    wouldBuyCount: 0,
    signalsRecorded: 0,
  };
}
