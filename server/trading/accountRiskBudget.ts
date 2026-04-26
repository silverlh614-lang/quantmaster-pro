// @responsibility accountRiskBudget 매매 엔진 모듈
/**
 * accountRiskBudget.ts — 계좌 레벨 리스크 예산 + Fractional Kelly 강제
 *
 * 사용자 P1-2 의견 구현:
 *   "Kelly 배율 자체를 계좌 금액과 직결하지 말고, 분리하라."
 *
 *   ① 계좌 레벨 — 총 자본, 일 최대 손실 허용, 동시 보유 총 리스크 한도, 섹터 한도
 *   ② 포지션 레벨 — 승률·RRR·신뢰도 등급·전략 레짐 가중치
 *   ③ 최종 배분 = Kelly_fraction × confidence_modifier × account_risk_budget
 *
 *   Fractional Kelly 강제 (풀 Kelly 금지):
 *     STRONG_BUY: ≤ 0.5 Kelly
 *     BUY:        ≤ 0.25 Kelly
 *     HOLD성 신규: ≤ 0.1 Kelly
 *
 * 본 모듈은 "계산기" 역할만 한다 — 실 결정은 calculateOrderQuantity 가 본 결과를
 * 입력으로 받아 수행. portfolioRiskEngine 의 sector/beta 게이트는 직교 단계로 유지.
 */

import {
  loadShadowTrades, getRemainingQty, type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { isOpenShadowStatus } from './entryEngine.js';
import { getDailyLossPct } from '../state.js';
import { applyHalfLifeDecay, type HalfLifeDecayInput } from './kellyHalfLife.js';
import {
  type BudgetPolicy,
  type SignalGrade,
  defaultBudgetPolicy,
  getBudgetPolicy,
  applyFractionalKellyWithPolicy,
} from './budgetPolicy.js';

export type { SignalGrade, BudgetPolicy } from './budgetPolicy.js';
export { defaultBudgetPolicy, getBudgetPolicy, setBudgetPolicy, withPolicyOverride } from './budgetPolicy.js';

// ── Fractional Kelly 강제 (PR-T: 정책 객체로 이전, 후방호환 const 유지) ──────
//
// 풀 Kelly 는 추정 오차 + 비대칭 페이오프 가정으로 인해 장기적으로 파산 확률이 높다.
// 이 테이블은 "어떠한 신호 등급도 풀 Kelly 를 넘지 않는다" 는 안전 캡을 강제한다.
// kellyDampener (IPS 기반) · sizingTier (CONVICTION/STANDARD/PROBING) 와 곱연산.
//
// PR-T (아이디어 8): SSOT 는 budgetPolicy.ts 로 이전됐다. 본 const 는 이전 호출자
// (perSymbolEvaluation.ts 의 entryKellySnapshot.fractionalCap 등) 호환을 위한 default
// 정책 스냅샷이다. 백테스트는 setBudgetPolicy() 로 정책을 갈아끼워 사용한다.
export const FRACTIONAL_KELLY_CAP: Record<SignalGrade, number> = defaultBudgetPolicy().fractionalKellyCap;

/**
 * 신호 등급에 Fractional Kelly 캡을 적용. 입력 multiplier 가 캡을 넘으면 캡으로 잘라낸다.
 *
 * PR-T: 정책 옵셔널 인자 추가. 미주입 시 활성 정책(getBudgetPolicy()) 사용.
 *
 * @example
 *   applyFractionalKelly('STRONG_BUY', 0.6) → 0.5  (default 캡 적용)
 *   applyFractionalKelly('BUY',        0.2) → 0.2  (캡 미달, 그대로)
 */
export function applyFractionalKelly(
  grade: SignalGrade,
  kellyMultiplier: number,
  policy?: BudgetPolicy,
): { capped: number; wasCapped: boolean; cap: number } {
  return applyFractionalKellyWithPolicy(grade, kellyMultiplier, policy ?? getBudgetPolicy());
}

/**
 * Idea 11 — Kelly Coverage Ratio.
 *
 * 회계 "이자보상배율" 과 동형: 이 포지션의 effective Kelly 가 단일 포지션 R-캡
 * (maxPerTradeRiskPct/100) 대비 얼마나 크은가?
 *
 *   KellyCoverageRatio = effectiveKelly / (maxPerTradeRiskPct / 100)
 *
 * - ≥ 1: Kelly 가 R-캡 이상 → 정상 사이즈 포지션
 * - < 1: "이 포지션은 자기 리스크 한도조차 감당 못하는 크기" → 청산 후보로 분류
 *        (작은 사이즈 = 약한 확신 + R-캡 풀세이즈 못 채움 = 유지 근거 약함)
 *
 * PR-T: maxPerTradeRiskPct 미지정 시 활성 정책(getBudgetPolicy().maxPerTradeRiskPct) 사용.
 */
export function computeKellyCoverageRatio(
  effectiveKelly: number,
  maxPerTradeRiskPct: number = getBudgetPolicy().maxPerTradeRiskPct,
): number {
  if (maxPerTradeRiskPct <= 0) return 0;
  return effectiveKelly / (maxPerTradeRiskPct / 100);
}

/** Coverage ratio < 1 이면 "저확신 포지션" 으로 분류되어 청산 후보. */
export const KELLY_COVERAGE_TRIM_THRESHOLD = 1.0;

// ── 계좌 리스크 예산 계산 ────────────────────────────────────────────────────

export interface AccountRiskBudgetSnapshot {
  /** 일일 손실 한도(%) — 환경변수 기반 */
  dailyLossLimitPct: number;
  /** 현재 누적된 일일 손실(%) — 양수 표기 */
  dailyLossPct: number;
  /** 일일 손실 한도까지 남은 여유(%). 0 이하면 신규 진입 금지. */
  dailyLossRemainingPct: number;
  /** 동시 보유 총 리스크 한도(%) */
  maxConcurrentRiskPct: number;
  /** 현재 활성 포지션의 누적 R 합산(%). (entry - stop)/totalAssets 합. */
  openRiskPct: number;
  /** 동시 리스크 한도까지 남은 여유(%). 0 이하면 신규 진입 금지. */
  concurrentRiskRemainingPct: number;
  /** 단일 포지션 최대 리스크(%). 후보 종목 사이즈 체크용. */
  maxPerTradeRiskPct: number;
  /** 섹터 한도(%) — 후보 섹터별 위반 여부 검증에 참조 */
  maxSectorWeightPct: number;
  /** 신규 진입 가능 여부 — false 면 사이즈 0. */
  canEnterNew: boolean;
  /** 차단 사유들 (canEnterNew=false 일 때) */
  blockedReasons: string[];
}

/**
 * 현재 계좌의 리스크 예산 스냅샷.
 *
 * 외부 입력(totalAssets) 만으로 계산 — 계좌 가치 평가 변동에 따라 매 진입 시점에
 * 재계산되도록 호출자가 신선한 totalAssets 를 넘긴다.
 *
 * @param input.currentPrices 선택적 실시간가 맵(stockCode → price). 제공되면 Idea 8
 *   "트레일링 스톱 반영 activeR" 계산이 적용된다 — 진입가와 현재가 중 낮은 쪽을
 *   기준점으로 써서, 하드스톱이 BE 위로 올라온 포지션의 "이미 해소된 리스크" 를
 *   동시 R 한도에서 정상적으로 해제한다. 미주입 시 진입가 기준 (레거시 동작).
 */
export function getAccountRiskBudget(input: {
  totalAssets: number;
  /** 옵션 — 미주입 시 loadShadowTrades() 로 자동 로드 */
  trades?: ServerShadowTrade[];
  /** 옵션 — Idea 8: 실시간가 맵. 제공 시 trailing hardStop 반영된 activeR 계산 */
  currentPrices?: Map<string, number> | Record<string, number>;
  /** PR-T (아이디어 8): 정책 주입 — 미주입 시 활성 정책(env 기반 default) 사용 */
  policy?: BudgetPolicy;
}): AccountRiskBudgetSnapshot {
  const totalAssets = input.totalAssets;
  const trades = input.trades ?? loadShadowTrades();
  const open = trades.filter(t => isOpenShadowStatus(t.status) && getRemainingQty(t) > 0);
  const policy = input.policy ?? getBudgetPolicy();

  // 현재 누적 일일 손실 — state.ts 가 관리. 양수 = 손실.
  const dailyLossPct = getDailyLossPct();
  const dailyLossRemainingPct = Math.max(0, policy.dailyLossLimitPct - dailyLossPct);

  // ── Idea 8: 활성 포지션 R 합 — 트레일링 hardStop 반영 ────────────────────
  // 기존 로직: Σ max(0, entry - hardStop) × qty 는 하드스톱이 entry 위로 올라간
  // 순간(BE 이상 트레일링) 구조상 음수가 되어 max(0,·) 에 의해 0 으로 clamp,
  // 결과적으로 "이미 수익 구간에 있는 포지션" 도 동시 R 한도는 제대로 해제되지만
  // 진입가 아래로 더 내려갔을 때만 해소가 반영되는 비대칭 문제가 있었다.
  //
  // 수정: 기준가 = min(entry, currentPrice). 트레일링 스톱이 올라가면서 현재가가
  // 진입가 위로 올라간 포지션은 "이제 더 이상 진입가 근처의 리스크를 지지 않는다" 는
  // 현실을 반영해 activeR = max(0, min(entry, currentPrice) - hardStop) × remainingQty
  // 로 계산한다. 현재가가 제공되지 않으면 레거시 동작(entry 기준) 으로 폴백.
  const getCurrent = (code: string): number | undefined => {
    const src = input.currentPrices;
    if (!src) return undefined;
    if (src instanceof Map) return src.get(code);
    return (src as Record<string, number>)[code];
  };
  let openRiskKrw = 0;
  for (const t of open) {
    const stop = t.hardStopLoss ?? t.stopLoss ?? 0;
    const entry = t.shadowEntryPrice;
    const current = getCurrent(t.stockCode);
    const base = current !== undefined && Number.isFinite(current) && current > 0
      ? Math.min(entry, current)
      : entry;
    const activeQty = getRemainingQty(t);
    const r = Math.max(0, base - stop) * activeQty;
    openRiskKrw += r;
  }
  const openRiskPct = totalAssets > 0 ? (openRiskKrw / totalAssets) * 100 : 0;
  const concurrentRiskRemainingPct = Math.max(0, policy.maxConcurrentRiskPct - openRiskPct);

  const blockedReasons: string[] = [];
  if (dailyLossRemainingPct <= 0) {
    blockedReasons.push(`일일 손실 한도 도달 (${dailyLossPct.toFixed(2)}% ≥ ${policy.dailyLossLimitPct}%)`);
  }
  if (concurrentRiskRemainingPct <= 0) {
    blockedReasons.push(`동시 보유 리스크 한도 도달 (${openRiskPct.toFixed(2)}% ≥ ${policy.maxConcurrentRiskPct}%)`);
  }

  return {
    dailyLossLimitPct: policy.dailyLossLimitPct,
    dailyLossPct,
    dailyLossRemainingPct,
    maxConcurrentRiskPct: policy.maxConcurrentRiskPct,
    openRiskPct,
    concurrentRiskRemainingPct,
    maxPerTradeRiskPct: policy.maxPerTradeRiskPct,
    maxSectorWeightPct: policy.maxSectorWeightPct,
    canEnterNew: blockedReasons.length === 0,
    blockedReasons,
  };
}

// ── 후보 종목별 리스크 캡 계산 ────────────────────────────────────────────────

export interface ComputeRiskAdjustedSizeInput {
  /** 후보 종목 진입가 */
  entryPrice: number;
  /** 후보 종목 손절 (hardStopLoss 우선) */
  stopLoss: number;
  /** 신호 등급 — Fractional Kelly 캡 적용 */
  signalGrade: SignalGrade;
  /** 원래 의도한 Kelly 곱셈자 (sizingTier × kellyDampener × accountScale 등의 누적) */
  kellyMultiplier: number;
  /** 신뢰도 보정자 (0~1.2) — RRR/Gate/MTAS 종합 */
  confidenceModifier?: number;
  /** 계좌 리스크 예산 스냅샷 — 호출자가 한 번만 계산해 재사용 */
  budget: AccountRiskBudgetSnapshot;
  /** 총 자본 — 사이즈 환산 */
  totalAssets: number;
  /**
   * ADR-0008: 보유 중 재평가 경로에서 시간감쇠를 반영. 미제공(신규 진입) 시 staticKelly.
   * daysHeld=0 이면 weight=1 이라 결과 불변.
   */
  timeDecayInput?: HalfLifeDecayInput;
  /**
   * PR-T (아이디어 8): 정책 주입 — 미주입 시 활성 정책(env 기반 default) 사용.
   * Fractional Kelly 캡 + 단일/동시 R 한도가 본 정책에서 결정된다.
   * budget 인자가 동일 정책으로 빌드되어야 일관성 유지.
   */
  policy?: BudgetPolicy;
}

export interface ComputeRiskAdjustedSizeResult {
  /** 권장 투입 자본(원) — 0 이면 진입 금지 */
  recommendedBudgetKrw: number;
  /** 시간감쇠 **후** 최종 Kelly (timeDecayInput 없으면 staticKelly 와 동일) */
  effectiveKelly: number;
  /** Fractional Kelly 캡 후, 시간감쇠 **전** */
  staticKelly: number;
  /** Fractional Kelly 캡이 작동했는지 */
  kellyWasCapped: boolean;
  /** R-multiple per share */
  riskPerShare: number;
  /** 단일 포지션 리스크 캡 (totalAssets × maxPerTradeRiskPct/100) */
  maxRiskKrw: number;
  /** 동시 리스크 잔여 캡 — 모두 합쳐 계좌 한도를 넘지 않도록 */
  remainingConcurrentRiskKrw: number;
  /** 인간 가독 사유 (운영자 디버깅용) */
  reason: string;
}

/**
 * 합성 사이징 — Kelly × confidence × account budget 의 최소값을 잡아 최종 권장 자본을 산출.
 *
 * 흐름:
 *   1. 계좌 게이트 (canEnterNew) 가 false 면 즉시 0.
 *   2. Fractional Kelly 캡 적용 → effectiveKelly.
 *   3. (entry-stop) per share × maxRiskKrw / riskPerShare 로 리스크 기준 최대 수량 환산.
 *   4. Kelly 기준 자본 = totalAssets × effectiveKelly × confidence.
 *   5. 둘 중 작은 쪽을 권장 자본으로 채택. 최종적으로 동시 리스크 잔여 캡으로도 한 번 더 자른다.
 */
export function computeRiskAdjustedSize(input: ComputeRiskAdjustedSizeInput): ComputeRiskAdjustedSizeResult {
  const { entryPrice, stopLoss, signalGrade, kellyMultiplier, totalAssets, budget } = input;
  const confidence = Math.max(0, Math.min(1.2, input.confidenceModifier ?? 1.0));
  const policy = input.policy ?? getBudgetPolicy();

  // 게이트 1: 계좌 한도 도달
  if (!budget.canEnterNew) {
    return {
      recommendedBudgetKrw: 0,
      effectiveKelly: 0,
      staticKelly: 0,
      kellyWasCapped: false,
      riskPerShare: Math.max(0, entryPrice - stopLoss),
      maxRiskKrw: 0,
      remainingConcurrentRiskKrw: 0,
      reason: `계좌 게이트 차단 — ${budget.blockedReasons.join(' / ')}`,
    };
  }

  // 게이트 2: Fractional Kelly 캡 (PR-T: 정책 기반)
  const kelly = applyFractionalKelly(signalGrade, kellyMultiplier, policy);
  // ADR-0008: 보유 중 재평가 경로만 timeDecayInput 을 넘긴다. 신규 진입은 undefined → decayedKelly = kelly.capped.
  const decayedKelly = applyHalfLifeDecay(kelly.capped, input.timeDecayInput);

  // 게이트 3: 리스크 기준 최대 자본 (entry-stop 캡)
  const riskPerShare = Math.max(0, entryPrice - stopLoss);
  if (riskPerShare <= 0 || entryPrice <= 0) {
    return {
      recommendedBudgetKrw: 0,
      effectiveKelly: decayedKelly,
      staticKelly: kelly.capped,
      kellyWasCapped: kelly.wasCapped,
      riskPerShare: 0,
      maxRiskKrw: 0,
      remainingConcurrentRiskKrw: 0,
      reason: `리스크/주 = 0 (entry=${entryPrice}, stop=${stopLoss}) — 사이즈 0`,
    };
  }

  const maxRiskKrwPerTrade = totalAssets * (budget.maxPerTradeRiskPct / 100);
  const remainingConcurrentRiskKrw = totalAssets * (budget.concurrentRiskRemainingPct / 100);
  // 단일 트레이드 R 캡 + 동시 R 잔여 캡 중 작은 쪽
  const riskBudgetKrw = Math.min(maxRiskKrwPerTrade, remainingConcurrentRiskKrw);
  const sharesByRisk = Math.floor(riskBudgetKrw / riskPerShare);
  const capitalByRisk = sharesByRisk * entryPrice;

  // 게이트 4: Kelly 기준 자본 — decayedKelly 기준 (timeDecayInput 없으면 staticKelly 와 동일).
  const capitalByKelly = totalAssets * decayedKelly * confidence;

  const recommendedBudgetKrw = Math.max(0, Math.min(capitalByRisk, capitalByKelly));

  const decayNote = input.timeDecayInput && decayedKelly < kelly.capped - 1e-9
    ? ` decay ${(decayedKelly / kelly.capped * 100).toFixed(0)}%`
    : '';
  const reason =
    `grade=${signalGrade} kelly ${kellyMultiplier.toFixed(2)}→${kelly.capped.toFixed(2)}` +
    `${kelly.wasCapped ? '(capped)' : ''}${decayNote} × confidence ${confidence.toFixed(2)}; ` +
    `riskBudget=${(riskBudgetKrw / 10000).toFixed(0)}만, kellyBudget=${(capitalByKelly / 10000).toFixed(0)}만, ` +
    `최소 채택=${(recommendedBudgetKrw / 10000).toFixed(0)}만`;

  return {
    recommendedBudgetKrw,
    effectiveKelly: decayedKelly,
    staticKelly: kelly.capped,
    kellyWasCapped: kelly.wasCapped,
    riskPerShare,
    maxRiskKrw: maxRiskKrwPerTrade,
    remainingConcurrentRiskKrw,
    reason,
  };
}

// ── 텔레그램 표시용 포맷터 (운영 가시성) ─────────────────────────────────────

export function formatAccountRiskBudget(snapshot: AccountRiskBudgetSnapshot): string {
  const dailyEmoji = snapshot.dailyLossRemainingPct <= 1 ? '🔴' : snapshot.dailyLossRemainingPct <= 2 ? '🟡' : '🟢';
  const concEmoji  = snapshot.concurrentRiskRemainingPct <= 1 ? '🔴' : snapshot.concurrentRiskRemainingPct <= 2 ? '🟡' : '🟢';
  const lines = [
    '💰 <b>[계좌 리스크 예산]</b>',
    '━━━━━━━━━━━━━━━━',
    `${dailyEmoji} 일일 손실: ${snapshot.dailyLossPct.toFixed(2)}% / ${snapshot.dailyLossLimitPct.toFixed(1)}% (잔여 ${snapshot.dailyLossRemainingPct.toFixed(2)}%)`,
    `${concEmoji} 동시 R 합: ${snapshot.openRiskPct.toFixed(2)}% / ${snapshot.maxConcurrentRiskPct.toFixed(1)}% (잔여 ${snapshot.concurrentRiskRemainingPct.toFixed(2)}%)`,
    `📐 단일 포지션 R 캡: ${snapshot.maxPerTradeRiskPct.toFixed(2)}%`,
    `🏭 섹터 캡: ${snapshot.maxSectorWeightPct.toFixed(0)}%`,
    `${snapshot.canEnterNew ? '✅ 신규 진입 허용' : '🚫 진입 차단 — ' + snapshot.blockedReasons.join(' / ')}`,
  ];
  return lines.join('\n');
}
