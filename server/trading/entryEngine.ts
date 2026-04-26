/**
 * entryEngine.ts — 진입 검증 유틸리티
 *
 * signalScanner.ts 에서 분리된 진입 조건 평가 및 포지션 사이징 로직.
 *   EXIT_RULE_PRIORITY_TABLE  — 청산/감축 규칙 우선순위 정책표
 *   buildStopLossPlan()       — 고정/레짐 손절 분리 계획 생성
 *   formatStopLossBreakdown() — 손절 계획 텔레그램 포맷
 *   calculateOrderQuantity()  — 주문 수량 및 실투자금 계산
 *   evaluateEntryRevalidation() — 진입 직전 재검증
 *   isOpenShadowStatus()      — 진행 중 Shadow 상태 판별
 */

import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import type { ExitRuleTag } from '../persistence/shadowTradeRepo.js';
import type { DynamicStopRegime } from '../../src/types/sell.js';
import { evaluateDynamicStop } from '../../src/services/quant/dynamicStopEngine.js';
import { callGemini } from '../clients/geminiClient.js';
import { buildConditionBoostHint } from '../learning/conditionBoostHints.js';
import { GATE_SCORE_THRESHOLD_BY_REGIME, getEffectiveGateThreshold } from './gateConfig.js';
import { safePctChange } from '../utils/safePctChange.js';

const ENTRY_MIN_GATE_SCORE = 5;

/**
 * 아이디어 #7: 레짐별 Gate 임계값 — 약세장일수록 기준 강화.
 * 단일 소스는 gateConfig.GATE_SCORE_THRESHOLD_BY_REGIME — 운용자 오버라이드 연동을 위해
 * 이 상수는 그 모듈을 재수출(re-export)한다. 하드 참조는 금지.
 */
export const REGIME_GATE_MIN = GATE_SCORE_THRESHOLD_BY_REGIME;

/**
 * 레짐 문자열로부터 실효 Gate 최솟값을 반환.
 * 운용자 오버라이드(gateConfig.setRuntimeThresholdDelta)가 활성이면 완화값을 반영한다.
 * 미전달·미지원 레짐 → 기본값 5.
 */
export function getMinGateScore(regime?: string): number {
  return getEffectiveGateThreshold(regime);
}
const ENTRY_MAX_BREAKOUT_EXTENSION_PCT = 3;
const ENTRY_MAX_BEARISH_DROP_FROM_OPEN_PCT = -2;
const ENTRY_MAX_OPEN_GAP_OVERHEAT_PCT = 4;
const ENTRY_MIN_VOLUME_RATIO = 0.6;
const DAY_OPEN_SOURCE_DIVERGENCE_PCT = 5;

/**
 * 오전 시간대(09:00~12:00 KST) 거래량 기준 할인 계수.
 * 오전 중에는 거래량이 풀장 대비 낮으므로 volumeRatio 기준을 추가 하향한다.
 * adjustedMinRatio × 0.7 적용 → 실질 기준이 ~30% 완화.
 */
export const MORNING_VOLUME_DISCOUNT = 0.7;
/** 오전 구간 종료 시각: 장 시작(09:00) 이후 180분 = 12:00 KST */
export const MORNING_END_MINUTES = 180;

/** 현재 KST 시각의 장 시작(09:00) 이후 경과 분. 장 시작 전이면 0. */
export function getKstMarketElapsedMinutes(): number {
  const now = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;
  const kstMinute = now.getUTCMinutes();
  return Math.max(0, (kstHour - 9) * 60 + kstMinute);
}

/**
 * 청산/감축 규칙 우선순위 정책표.
 * ExitRuleTag 타입으로 규칙명이 고정되므로, 새 규칙을 추가할 때는
 * ExitRuleTag(shadowTradeRepo.ts)와 이 테이블을 함께 갱신하면 된다.
 * updateShadowResults(exitEngine.ts)는 이 테이블의 priority 순서로 규칙을 평가한다.
 */
export const EXIT_RULE_PRIORITY_TABLE: ReadonlyArray<{
  priority: number;
  rule: ExitRuleTag;
  description: string;
}> = [
  { priority: 1, rule: 'R6_EMERGENCY_EXIT', description: 'R6_DEFENSE 긴급 부분 청산(30%)' },
  { priority: 2, rule: 'HARD_STOP', description: '하드 스톱(고정 손절/레짐 손절) 전량 청산' },
  { priority: 3, rule: 'MA60_DEATH_FORCE_EXIT', description: 'MA60 역배열 5영업일 유예 만료 — 좀비 포지션 강제 청산' },
  { priority: 4, rule: 'CASCADE_FINAL', description: 'Cascade -25%/-30% 최종 청산' },
  { priority: 5, rule: 'LIMIT_TRANCHE_TAKE_PROFIT', description: 'LIMIT 분할 익절' },
  { priority: 6, rule: 'TRAILING_PROTECTIVE_STOP', description: '트레일링 기반 이익보호 손절' },
  { priority: 7, rule: 'TARGET_EXIT', description: '목표가 전량 청산(레거시 fallback)' },
  { priority: 8, rule: 'CASCADE_HALF_SELL', description: 'Cascade -15% 반매도' },
  { priority: 9, rule: 'CASCADE_WARN_BLOCK', description: 'Cascade -7% 경고/추가매수 차단' },
  { priority: 10, rule: 'RRR_COLLAPSE_PARTIAL', description: 'RRR 붕괴(<1.0) 50% 익절' },
  { priority: 11, rule: 'DIVERGENCE_PARTIAL', description: '하락 다이버전스 30% 부분 익절' },
  { priority: 12, rule: 'MA60_DEATH_WATCH', description: 'MA60 역배열 최초 감지 — 5영업일 강제 청산 스케줄' },
  { priority: 13, rule: 'STOP_APPROACH_ALERT', description: '손절 접근 경고(알림)' },
  { priority: 14, rule: 'EUPHORIA_PARTIAL', description: '과열 탐지 부분 매도' },
  // priority 99: 자동 평가 루프에서 절대 선택되지 않는 "규칙 외" 슬롯.
  // Telegram /sell 명령어·UI 수동 매도 경로에서 외부 주입으로만 exitRuleTag 에 부착된다.
  { priority: 99, rule: 'MANUAL_EXIT', description: '수동 청산(사용자 개입) — 자동 규칙 평가 대상 아님' },
] as const;

export const OPEN_SHADOW_STATUSES = new Set<ServerShadowTrade['status']>([
  'PENDING',
  'ORDER_SUBMITTED',
  'PARTIALLY_FILLED',
  'ACTIVE',
  'EUPHORIA_PARTIAL',
]);

export function isOpenShadowStatus(status: ServerShadowTrade['status']): boolean {
  return OPEN_SHADOW_STATUSES.has(status);
}

// ── RegimeLevel → DynamicStopRegime 매핑 ──────────────────────────────────────

/**
 * 6단계 시장 레짐을 동적 손절 3단계로 매핑.
 *   R1_TURBO / R2_BULL     → RISK_ON  (여유 있는 손절, ATR × 2.0)
 *   R3_EARLY / R4_NEUTRAL  → RISK_OFF (타이트한 손절, ATR × 1.5)
 *   R5_CAUTION / R6_DEFENSE → CRISIS  (초타이트 손절, ATR × 1.0)
 */
export function regimeToStopRegime(regime?: string): DynamicStopRegime {
  switch (regime) {
    case 'R1_TURBO':
    case 'R2_BULL':
      return 'RISK_ON';
    case 'R3_EARLY':
    case 'R4_NEUTRAL':
      return 'RISK_OFF';
    case 'R5_CAUTION':
    case 'R6_DEFENSE':
      return 'CRISIS';
    default:
      return 'RISK_OFF';
  }
}

// ── Stop Loss Plan ─────────────────────────────────────────────────────────────

interface StopLossPlanInput {
  entryPrice: number;
  fixedStopLoss: number;
  regimeStopRate: number;
  /** 14일 ATR — 동적 손절 계산용 (없으면 고정 손절만 사용) */
  atr14?: number;
  /** 시장 레짐 (ATR 배수 결정용) */
  regime?: string;
}

export interface StopLossPlan {
  /** 진입 구조 훼손 기준의 고정 손절 */
  initialStopLoss: number;
  /** 시장 레짐 악화 기준의 레짐 손절 */
  regimeStopLoss: number;
  /** ATR 기반 동적 손절 (없으면 undefined) */
  dynamicStopLoss?: number;
  /** 실제 강제 청산 기준(가장 촘촘한 손절 = max(initialStopLoss, regimeStopLoss, dynamicStopLoss)) */
  hardStopLoss: number;
}

export function buildStopLossPlan(input: StopLossPlanInput): StopLossPlan {
  const regimeStopLoss = input.entryPrice * (1 + input.regimeStopRate);
  const initialStopLoss = input.fixedStopLoss;

  // ATR 기반 동적 손절 — 종목 변동성 반영
  let dynamicStopLoss: number | undefined;
  if (input.atr14 && input.atr14 > 0) {
    const stopRegime = regimeToStopRegime(input.regime);
    const dynResult = evaluateDynamicStop({
      entryPrice: input.entryPrice,
      atr14: input.atr14,
      regime: stopRegime,
      currentPrice: input.entryPrice, // 진입 시점이므로 현재가 = 진입가
    });
    dynamicStopLoss = dynResult.stopPrice;
  }

  // 3중 손절 비교 — 가장 높은 가격(가장 촘촘한 손절)을 hardStopLoss로 채택
  const candidates = [initialStopLoss, regimeStopLoss];
  if (dynamicStopLoss !== undefined) candidates.push(dynamicStopLoss);
  const hardStopLoss = Math.max(...candidates);

  return {
    initialStopLoss,
    regimeStopLoss,
    dynamicStopLoss,
    hardStopLoss,
  };
}

export function formatStopLossBreakdown(plan: StopLossPlan): string {
  const dynPart = plan.dynamicStopLoss != null
    ? ` / ATR ${plan.dynamicStopLoss.toLocaleString()}`
    : '';
  return `${plan.hardStopLoss.toLocaleString()}원 (고정 ${plan.initialStopLoss.toLocaleString()} / 레짐 ${plan.regimeStopLoss.toLocaleString()}${dynPart})`;
}

// ── Position Sizing ────────────────────────────────────────────────────────────

export interface PositionSizingInput {
  totalAssets: number;
  orderableCash: number;
  positionPct: number;
  price: number;
  remainingSlots: number;
  accountKellyMultiplier?: number;
}

export function calculateOrderQuantity(input: PositionSizingInput): { quantity: number; effectiveBudget: number } {
  if (input.price <= 0 || input.remainingSlots <= 0 || input.orderableCash <= 0) {
    return { quantity: 0, effectiveBudget: 0 };
  }
  const targetBudget = Math.max(0, input.totalAssets * input.positionPct * (input.accountKellyMultiplier ?? 1));
  const slotBudget = input.orderableCash / input.remainingSlots;
  const effectiveBudget = Math.max(0, Math.min(input.orderableCash, targetBudget, slotBudget));
  return {
    quantity: Math.floor(effectiveBudget / input.price),
    effectiveBudget,
  };
}

// ── Entry Revalidation ─────────────────────────────────────────────────────────

export interface DayOpenReconciliationInput {
  yahooDayOpen?: number;
  kisDayOpen?: number;
  maxDivergencePct?: number;
}

export interface DayOpenReconciliationResult {
  dayOpen?: number;
  source: 'YAHOO' | 'KIS' | 'UNAVAILABLE';
  divergencePct: number | null;
  acceptedKis: boolean;
}

export function reconcileDayOpen(input: DayOpenReconciliationInput): DayOpenReconciliationResult {
  const yahooDayOpen = input.yahooDayOpen && input.yahooDayOpen > 0 ? input.yahooDayOpen : undefined;
  const kisDayOpen = input.kisDayOpen && input.kisDayOpen > 0 ? input.kisDayOpen : undefined;
  const maxDivergencePct = input.maxDivergencePct ?? DAY_OPEN_SOURCE_DIVERGENCE_PCT;

  if (yahooDayOpen == null && kisDayOpen == null) {
    return { dayOpen: undefined, source: 'UNAVAILABLE', divergencePct: null, acceptedKis: false };
  }
  if (yahooDayOpen == null) {
    return { dayOpen: kisDayOpen, source: 'KIS', divergencePct: null, acceptedKis: true };
  }
  if (kisDayOpen == null) {
    return { dayOpen: yahooDayOpen, source: 'YAHOO', divergencePct: null, acceptedKis: false };
  }

  const divergencePct = Math.abs((kisDayOpen - yahooDayOpen) / yahooDayOpen) * 100;
  if (divergencePct > maxDivergencePct) {
    return { dayOpen: yahooDayOpen, source: 'YAHOO', divergencePct, acceptedKis: false };
  }
  return { dayOpen: kisDayOpen, source: 'KIS', divergencePct, acceptedKis: true };
}

interface EntryRevalidationInput {
  currentPrice: number;
  entryPrice: number;
  quoteGateScore?: number;
  quoteSignalType?: 'STRONG' | 'NORMAL' | 'SKIP';
  dayOpen?: number;
  prevClose?: number;
  volume?: number;
  avgVolume?: number;
  /** 아이디어 #7: 레짐 연동 Gate 최솟값 — getMinGateScore(regime)으로 계산 후 전달 */
  minGateScore?: number;
  /** 장 시작(09:00 KST) 이후 경과 분 — 거래량 비율을 시간대 비례로 보정 */
  marketElapsedMinutes?: number;
}

export function evaluateEntryRevalidation(input: EntryRevalidationInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];

  const minGate = input.minGateScore ?? ENTRY_MIN_GATE_SCORE;
  if (input.quoteSignalType === 'SKIP' || (input.quoteGateScore ?? minGate) < minGate) {
    reasons.push(`Gate 재검증 미달 (${(input.quoteGateScore ?? 0).toFixed(1)}/${minGate})`);
  }

  // ADR-0028: stale 가드는 헬퍼가 통합. null 시 해당 조건 평가 스킵 (보수적).
  const extensionPct = safePctChange(input.currentPrice, input.entryPrice, {
    label: 'entryEngine.extensionPct',
  });
  if (extensionPct !== null && input.currentPrice >= input.entryPrice && extensionPct > ENTRY_MAX_BREAKOUT_EXTENSION_PCT) {
    reasons.push(`돌파 이탈 과열 (+${extensionPct.toFixed(1)}%)`);
  }

  if (input.dayOpen && input.dayOpen > 0) {
    const dropFromOpenPct = safePctChange(input.currentPrice, input.dayOpen, {
      label: 'entryEngine.dropFromOpen',
      silent: true, // 30% 가드와 중복 로그 차단
    });
    // 시가와 현재가 차이가 ±30% 초과이면 데이터 오류로 간주하여 스킵
    if (dropFromOpenPct !== null && Math.abs(dropFromOpenPct) <= 30 &&
        input.currentPrice < input.dayOpen && dropFromOpenPct <= ENTRY_MAX_BEARISH_DROP_FROM_OPEN_PCT) {
      reasons.push(`시가 대비 급락 (${dropFromOpenPct.toFixed(1)}%)`);
    }
  }

  if (input.prevClose && input.prevClose > 0 && input.dayOpen && input.dayOpen > 0) {
    const openGapPct = safePctChange(input.dayOpen, input.prevClose, {
      label: 'entryEngine.openGap',
      silent: true,
    });
    // 30% 초과 갭은 Yahoo Finance 데이터 오류로 간주하여 체크 스킵
    if (openGapPct !== null && openGapPct < 30 && openGapPct >= ENTRY_MAX_OPEN_GAP_OVERHEAT_PCT) {
      reasons.push(`장초반 갭 과열 (+${openGapPct.toFixed(1)}%)`);
    }
  }

  if (input.avgVolume && input.avgVolume > 0 && input.volume !== undefined) {
    const volumeRatio = input.volume / input.avgVolume;
    // 시간대 비례 보정: avgVolume은 하루 전체 평균이므로 장중 경과 비율로 기준 하향
    const TOTAL_MARKET_MINUTES = 390; // 09:00 ~ 15:30
    const elapsed = input.marketElapsedMinutes;
    const elapsedRatio = elapsed != null
      ? Math.min(1, Math.max(0.1, elapsed / TOTAL_MARKET_MINUTES))
      : 1; // 미전달 시 보정 없이 원본 기준 사용
    let adjustedMinRatio = ENTRY_MIN_VOLUME_RATIO * elapsedRatio;
    // 오전 시간대 추가 보정: 12:00 KST 이전이면 기준을 MORNING_VOLUME_DISCOUNT(0.7)만큼 추가 하향
    if (elapsed != null && elapsed < MORNING_END_MINUTES) {
      adjustedMinRatio *= MORNING_VOLUME_DISCOUNT;
    }
    if (volumeRatio < adjustedMinRatio) {
      reasons.push(`거래량 급감 (${volumeRatio.toFixed(2)}x, 기준 ${adjustedMinRatio.toFixed(2)}x)`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

// ── Pre-Mortem 체크리스트 생성 ─────────────────────────────────────────────────
//
// "이 매수가 -10% 손실로 끝난다면 가장 가능성 높은 원인 3가지는?"
// Gemini에게 강제로 실패 시나리오를 나열하게 하여 인지 편향(확증 편향)을 역공격한다.
// 결과는 shadowTrade.preMortem에 저장되어 진입 승인 메시지와 사후 복기에 활용된다.

export interface PreMortemInput {
  stockCode: string;
  stockName: string;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  regime?: string;
  sector?: string;
  /** 진입 근거/메모 (Gate 통과 조건, 컨플루언스 요약 등) */
  entryContext?: string;
}

/** Pre-Mortem Gemini 프롬프트 빌더 — 테스트 및 단독 검증용 export */
export function buildPreMortemPrompt(input: PreMortemInput): string {
  const stopPct   = ((input.stopLoss  - input.entryPrice) / input.entryPrice) * 100;
  const targetPct = ((input.targetPrice - input.entryPrice) / input.entryPrice) * 100;
  const ctxLine   = input.entryContext ? `\n진입근거: ${input.entryContext}` : '';
  const secLine   = input.sector ? ` / 섹터 ${input.sector}` : '';
  const regLine   = input.regime ? ` / 레짐 ${input.regime}` : '';
  const boostHint = buildConditionBoostHint();
  const boostLine = boostHint ? `\n\n${boostHint}` : '';

  return (
    `종목: ${input.stockName}(${input.stockCode})${secLine}${regLine}\n` +
    `진입가: ${input.entryPrice.toLocaleString()}원\n` +
    `손절: ${input.stopLoss.toLocaleString()}원 (${stopPct.toFixed(1)}%)\n` +
    `목표: ${input.targetPrice.toLocaleString()}원 (${targetPct.toFixed(1)}%)` +
    `${ctxLine}${boostLine}\n\n` +
    `시나리오 가정: 이 매수가 -10% 손실로 끝났다. 가장 가능성 높은 원인 3가지를 ` +
    `각 1줄(최대 90자)씩 "1. " "2. " "3. " 형식으로 번호만 붙여 출력하라. ` +
    `각 줄은 "구체적 촉발 조건 → 결과" 형식으로 작성하라. ` +
    `페르소나 자기소개·서문·결론·메타 설명 금지 (예: "아키텍트로서", "분석한다", "이다." 로 시작 금지). ` +
    `추상적 문구(예: "시장 악화") 금지. JSON·마크다운·코드블록·볼드 금지. 3줄 평문만 출력하라.`
  );
}

/**
 * Gemini 응답에서 페르소나 서문·결론 메타 텍스트를 제거하고 번호 항목 3개만
 * 추출한다. ADR-0005 에 따른 후처리 — Gemini 가 프롬프트를 위반해 서문을 붙이는
 * 경우를 대비한 방어층.
 */
export function sanitizePreMortemResponse(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const lines = trimmed
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const numberedRe = /^\s*(?:[①②③]|\d{1,2}[.)\]]|[-•])\s*(.+)$/;

  const numberedLines: string[] = [];
  for (const l of lines) {
    const m = l.match(numberedRe);
    if (m && m[1]) {
      numberedLines.push(m[1].trim());
      if (numberedLines.length >= 3) break;
    }
  }

  // 번호 항목이 3개 미만이면 폴백: 긴 문장 3개를 마침표 단위로 추출.
  if (numberedLines.length < 3) {
    const sentences = trimmed
      .replace(/\n+/g, ' ')
      .split(/(?<=[.!?。])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 10 && !/아키텍트|분석한다|시스템의 Gate/.test(s))
      .slice(0, 3);
    if (sentences.length > numberedLines.length) {
      numberedLines.splice(0, numberedLines.length, ...sentences);
    }
  }

  const capped = numberedLines
    .slice(0, 3)
    .map((l) => (l.length > 120 ? `${l.slice(0, 117)}...` : l))
    .map((l, i) => `${i + 1}. ${l}`);

  // 최소 한 줄은 돌려줘야 "복기 없음" 공백 메시지가 안 나감. 실패 시 원문 상단 240자.
  if (capped.length === 0) {
    return trimmed.slice(0, 240);
  }
  return capped.join('\n').slice(0, 600);
}

/**
 * Pre-Mortem 체크리스트 생성.
 * Gemini 호출 실패(네트워크/키 미설정/quota) 시 null 반환 — 진입 차단하지 않는다.
 */
export async function generatePreMortem(input: PreMortemInput): Promise<string | null> {
  const prompt = buildPreMortemPrompt(input);
  try {
    const out = await callGemini(prompt, 'pre-mortem');
    if (!out) return null;
    // ADR-0005: 페르소나 서문 제거 + 번호항목 3개 추출 + 600자 상한.
    return sanitizePreMortemResponse(out);
  } catch (e) {
    console.warn(`[PreMortem] 생성 실패 (${input.stockCode}): ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
