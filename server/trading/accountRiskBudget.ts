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

import { loadShadowTrades, type ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { isOpenShadowStatus } from './entryEngine.js';
import { getDailyLossPct } from '../state.js';

// ── 환경 변수 (env override 가능) ──────────────────────────────────────────────

/** 일일 최대 손실 허용 — `DAILY_LOSS_LIMIT` 와 동일 의미. 신규 진입 차단 임계값 (계좌 %). */
const DAILY_LOSS_LIMIT_PCT     = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '5');
/** 동시 보유 총 리스크 한도 — 모든 활성 포지션의 (entry-stop) 합 / 총자본 상한. */
const MAX_CONCURRENT_RISK_PCT  = parseFloat(process.env.MAX_CONCURRENT_RISK_PCT ?? '6');
/** 단일 포지션 최대 리스크 — (entry-stop)/총자본 상한. R-multiple 1단위 캡. */
const MAX_PER_TRADE_RISK_PCT   = parseFloat(process.env.MAX_PER_TRADE_RISK_PCT ?? '1.5');
/** 섹터 편중 한도 — 단일 섹터 합산 시장가 / 총자본 상한 (portfolioRiskEngine 과 정합 30%). */
const MAX_SECTOR_WEIGHT_PCT    = parseFloat(process.env.MAX_SECTOR_WEIGHT ?? '0.30') * 100;

// ── Fractional Kelly 강제 ────────────────────────────────────────────────────
//
// 풀 Kelly 는 추정 오차 + 비대칭 페이오프 가정으로 인해 장기적으로 파산 확률이 높다.
// 이 테이블은 "어떠한 신호 등급도 풀 Kelly 를 넘지 않는다" 는 안전 캡을 강제한다.
// kellyDampener (IPS 기반) · sizingTier (CONVICTION/STANDARD/PROBING) 와 곱연산.

export type SignalGrade = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'PROBING';

export const FRACTIONAL_KELLY_CAP: Record<SignalGrade, number> = {
  STRONG_BUY: 0.50,  // 최고 신뢰도라도 풀 Kelly 의 절반까지만
  BUY:        0.25,
  HOLD:       0.10,  // HOLD 성 신규 진입(레짐 보수화 등)
  PROBING:    0.10,  // 탐색적 소량 진입
};

/**
 * 신호 등급에 Fractional Kelly 캡을 적용. 입력 multiplier 가 캡을 넘으면 캡으로 잘라낸다.
 *
 * @example
 *   applyFractionalKelly('STRONG_BUY', 0.6) → 0.5  (캡 적용)
 *   applyFractionalKelly('BUY',        0.2) → 0.2  (캡 미달, 그대로)
 */
export function applyFractionalKelly(grade: SignalGrade, kellyMultiplier: number): {
  capped: number;
  wasCapped: boolean;
  cap: number;
} {
  const cap = FRACTIONAL_KELLY_CAP[grade];
  const safe = Math.max(0, kellyMultiplier);
  if (safe > cap) return { capped: cap, wasCapped: true, cap };
  return { capped: safe, wasCapped: false, cap };
}

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
 */
export function getAccountRiskBudget(input: {
  totalAssets: number;
  /** 옵션 — 미주입 시 loadShadowTrades() 로 자동 로드 */
  trades?: ServerShadowTrade[];
}): AccountRiskBudgetSnapshot {
  const totalAssets = input.totalAssets;
  const trades = input.trades ?? loadShadowTrades();
  const open = trades.filter(t => isOpenShadowStatus(t.status) && t.quantity > 0);

  // 현재 누적 일일 손실 — state.ts 가 관리. 양수 = 손실.
  const dailyLossPct = getDailyLossPct();
  const dailyLossRemainingPct = Math.max(0, DAILY_LOSS_LIMIT_PCT - dailyLossPct);

  // 활성 포지션 R 합 — Σ (entry - hardStop) × qty / totalAssets × 100
  let openRiskKrw = 0;
  for (const t of open) {
    const stop = t.hardStopLoss ?? t.stopLoss ?? 0;
    const r = Math.max(0, t.shadowEntryPrice - stop) * (t.quantity ?? 0);
    openRiskKrw += r;
  }
  const openRiskPct = totalAssets > 0 ? (openRiskKrw / totalAssets) * 100 : 0;
  const concurrentRiskRemainingPct = Math.max(0, MAX_CONCURRENT_RISK_PCT - openRiskPct);

  const blockedReasons: string[] = [];
  if (dailyLossRemainingPct <= 0) {
    blockedReasons.push(`일일 손실 한도 도달 (${dailyLossPct.toFixed(2)}% ≥ ${DAILY_LOSS_LIMIT_PCT}%)`);
  }
  if (concurrentRiskRemainingPct <= 0) {
    blockedReasons.push(`동시 보유 리스크 한도 도달 (${openRiskPct.toFixed(2)}% ≥ ${MAX_CONCURRENT_RISK_PCT}%)`);
  }

  return {
    dailyLossLimitPct: DAILY_LOSS_LIMIT_PCT,
    dailyLossPct,
    dailyLossRemainingPct,
    maxConcurrentRiskPct: MAX_CONCURRENT_RISK_PCT,
    openRiskPct,
    concurrentRiskRemainingPct,
    maxPerTradeRiskPct: MAX_PER_TRADE_RISK_PCT,
    maxSectorWeightPct: MAX_SECTOR_WEIGHT_PCT,
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
}

export interface ComputeRiskAdjustedSizeResult {
  /** 권장 투입 자본(원) — 0 이면 진입 금지 */
  recommendedBudgetKrw: number;
  /** 적용된 Kelly 배율 (캡 후) */
  effectiveKelly: number;
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

  // 게이트 1: 계좌 한도 도달
  if (!budget.canEnterNew) {
    return {
      recommendedBudgetKrw: 0,
      effectiveKelly: 0,
      kellyWasCapped: false,
      riskPerShare: Math.max(0, entryPrice - stopLoss),
      maxRiskKrw: 0,
      remainingConcurrentRiskKrw: 0,
      reason: `계좌 게이트 차단 — ${budget.blockedReasons.join(' / ')}`,
    };
  }

  // 게이트 2: Fractional Kelly 캡
  const kelly = applyFractionalKelly(signalGrade, kellyMultiplier);

  // 게이트 3: 리스크 기준 최대 자본 (entry-stop 캡)
  const riskPerShare = Math.max(0, entryPrice - stopLoss);
  if (riskPerShare <= 0 || entryPrice <= 0) {
    return {
      recommendedBudgetKrw: 0,
      effectiveKelly: kelly.capped,
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

  // 게이트 4: Kelly 기준 자본
  const capitalByKelly = totalAssets * kelly.capped * confidence;

  const recommendedBudgetKrw = Math.max(0, Math.min(capitalByRisk, capitalByKelly));

  const reason =
    `grade=${signalGrade} kelly ${kellyMultiplier.toFixed(2)}→${kelly.capped.toFixed(2)}` +
    `${kelly.wasCapped ? '(capped)' : ''} × confidence ${confidence.toFixed(2)}; ` +
    `riskBudget=${(riskBudgetKrw / 10000).toFixed(0)}만, kellyBudget=${(capitalByKelly / 10000).toFixed(0)}만, ` +
    `최소 채택=${(recommendedBudgetKrw / 10000).toFixed(0)}만`;

  return {
    recommendedBudgetKrw,
    effectiveKelly: kelly.capped,
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
    '━━━━━━━━━━━━━━━━━━━━',
    `${dailyEmoji} 일일 손실: ${snapshot.dailyLossPct.toFixed(2)}% / ${snapshot.dailyLossLimitPct.toFixed(1)}% (잔여 ${snapshot.dailyLossRemainingPct.toFixed(2)}%)`,
    `${concEmoji} 동시 R 합: ${snapshot.openRiskPct.toFixed(2)}% / ${snapshot.maxConcurrentRiskPct.toFixed(1)}% (잔여 ${snapshot.concurrentRiskRemainingPct.toFixed(2)}%)`,
    `📐 단일 포지션 R 캡: ${snapshot.maxPerTradeRiskPct.toFixed(2)}%`,
    `🏭 섹터 캡: ${snapshot.maxSectorWeightPct.toFixed(0)}%`,
    `${snapshot.canEnterNew ? '✅ 신규 진입 허용' : '🚫 진입 차단 — ' + snapshot.blockedReasons.join(' / ')}`,
  ];
  return lines.join('\n');
}
