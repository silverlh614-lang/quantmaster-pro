// @responsibility STOP_APPROACH_ALERT 손절 접근 3단계 경보 — sendPrivateAlert 개인 DM 한정
/**
 * exitEngine/rules/stopApproachAlert.ts — 청산선 접근 3단계 경보 (ADR-0028, 아이디어 5 + ADR-0042).
 *   Stage 1: 청산선까지 -5% 이내 → 접근 경고
 *   Stage 2: 청산선까지 -3% 이내 → 임박 경고
 *   Stage 3: 청산선까지 -1% 이내 → 집행 임박 (exitEngine 하드스톱이 곧 발동)
 *
 * ADR-0572: 위 고정 5/3/1% 는 이제 종목 ATR14 동적 밴드의 *상한(cap)* 이다.
 *   기본 밴드 = min(배수 × atrPct, 고정 5/3/1%) — 저변동주(저 ATR%)일수록 밴드가
 *   좁아져 1~3% 소폭 하락 과민 발동을 해소. cap 덕에 어떤 입력도 레거시보다 더
 *   민감해지지 않는다. ENV STOP_APPROACH_ATR_BANDS_DISABLED=true 로 고정 밴드 복원.
 *
 * ADR-0028 보강 — 청산선 source 분기 라벨:
 *   hardStopLoss > shadowEntryPrice  → 🟢 [원금 보호선 임박]  (수익 Lock-in 청산)
 *   hardStopLoss ≈ shadowEntryPrice  → 🟡 [BEP 청산선 임박]   (무손실 청산, ±0.5% 허용)
 *   hardStopLoss < shadowEntryPrice  → 🚨 [손절 임박]         (실손실 청산)
 *
 * 모든 알림에 "진입가 대비 pnlPct" + "청산선 도달 거리" 두 메트릭 동시 노출 —
 * 운영자가 "-2.7%" 를 실손실로 오인하던 회귀 차단.
 *
 * ADR-0042 (PR-X6): sendPrivateAlert 사용으로 시멘틱 정합화. 사용자 패닉 매도 차단을 위해
 * CH1 EXECUTION 채널이 아닌 개인 DM 으로만 발송. 실제 청산 발동 시 channelSellSignal
 * (CH1) 이 사후 보고하므로 채널 구독자에게는 *결과* 만 노출.
 *
 * 단계별 dedupeKey 로 중복 알림 차단.
 *
 * ADR-0573: 손절 접근 단계 ack 를 종목별 familyKey(`stop_approach:CODE`)로 묶어
 *   다단계 경보의 T1 ack 재발송/에스컬레이션 폭증을 종목당 1건으로 축소.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { sendPrivateAlert } from '../../../alerts/telegramClient.js';
import { safePctChange } from '../../../utils/safePctChange.js';
import { recordShadowExitNotification, recordShadowExitSuppressed, shouldSendShadowExitNotification } from '../../../shadow/shadowExitDedup.js';

/** 청산선 source 분류 — 알림 라벨 + 가독성을 위한 SSOT. */
export type StopSourceCategory = 'PROFIT_LOCK_IN' | 'BEP_PROTECTION' | 'LOSS_STOP';

/** BEP 정확도 허용 폭. 매수가 대비 ±0.5% 이내면 BEP 청산선으로 간주. */
export const BEP_TOLERANCE_PCT = 0.5;

/** 기존 고정 밴드(레거시·fallback·상한 cap) — distToStop% 단위. */
export const FIXED_STOP_APPROACH_BANDS = { stage1: 5, stage2: 3, stage3: 1 } as const;
/** ATR% 배수 — Stage 별 동적 밴드. 저변동주일수록 밴드 축소. */
export const ATR_STOP_APPROACH_MULTIPLES = { stage1: 2.0, stage2: 1.0, stage3: 0.4 } as const;

/**
 * ADR-0572: distToStop% 발동 밴드를 종목 ATR14 기반으로 동적 산출.
 * - atrPct = entryATR14 / currentPrice * 100
 * - 각 stage 밴드 = min(배수 × atrPct, 고정밴드)  ← cap: ATR 스케일링은 *좁히기만* 함(절대 더 민감해지지 않음)
 * - ATR 부재/비유한/<=0, currentPrice 비유한/<=0, 또는 ENV STOP_APPROACH_ATR_BANDS_DISABLED=true → 고정 5/3/1% fallback
 * 반환: distToStop% 비교용 stage1>stage2>stage3 임계.
 */
export function computeStopApproachBands(
  currentPrice: number,
  entryATR14: number | undefined,
): { stage1: number; stage2: number; stage3: number } {
  if (process.env.STOP_APPROACH_ATR_BANDS_DISABLED === 'true') {
    return { ...FIXED_STOP_APPROACH_BANDS };
  }
  if (
    !Number.isFinite(entryATR14) ||
    (entryATR14 as number) <= 0 ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0
  ) {
    return { ...FIXED_STOP_APPROACH_BANDS };
  }
  const atrPct = ((entryATR14 as number) / currentPrice) * 100;
  if (!Number.isFinite(atrPct) || atrPct <= 0) {
    return { ...FIXED_STOP_APPROACH_BANDS };
  }
  return {
    stage1: Math.min(ATR_STOP_APPROACH_MULTIPLES.stage1 * atrPct, FIXED_STOP_APPROACH_BANDS.stage1),
    stage2: Math.min(ATR_STOP_APPROACH_MULTIPLES.stage2 * atrPct, FIXED_STOP_APPROACH_BANDS.stage2),
    stage3: Math.min(ATR_STOP_APPROACH_MULTIPLES.stage3 * atrPct, FIXED_STOP_APPROACH_BANDS.stage3),
  };
}

/**
 * ADR-0079 BEP Glide 영역의 BEP_PROTECTION 흡수 비율.
 * trailingStopPrice = entryPrice − BEP_GLIDE_ATR_RATIO × atr14 (dynamicStopEngine).
 * 본 분류기는 hardStopLoss 가 [entryPrice − BEP_GLIDE_ATR_RATIO × atr14, entryPrice]
 * 범위면 BEP_PROTECTION 으로 흡수 — "🚨 [손절 임박]" 오분류 차단.
 */
const BEP_GLIDE_ATR_RATIO = 0.5;

/**
 * 청산선의 의미 분류 — hardStopLoss 와 진입가 비교로 런타임 결정.
 * shadowEntryPrice 가 0/음수/NaN 이면 안전하게 LOSS_STOP fallback (정보 부족 시 보수적).
 *
 * ADR-0079 정합 (PR-Z7 H1 fix): entryATR14 가 양수이고 BEP_GLIDE_DISABLED env 가
 * set 되지 않았으면 [entryPrice − 0.5×ATR, entryPrice] 범위를 BEP_PROTECTION 으로
 * 흡수. PR-Z6 BEP Glide 적용 후 ATR=1500 / entryPrice=10000 → trailingStopPrice=9250
 * 시 -7.5% 차이로 LOSS_STOP 오분류되던 결함 차단.
 *
 * @param hardStopLoss 현재 청산선 가격
 * @param shadowEntryPrice 진입가
 * @param tolerancePct 정확 BEP 허용 폭 (%, default 0.5)
 * @param entryATR14 진입 시점 ATR14 (옵셔널 — 부재/0 시 글라이드 분기 무시, 기존 동작)
 */
export function classifyStopSource(
  hardStopLoss: number,
  shadowEntryPrice: number,
  tolerancePct: number = BEP_TOLERANCE_PCT,
  entryATR14?: number,
): StopSourceCategory {
  if (!Number.isFinite(hardStopLoss) || !Number.isFinite(shadowEntryPrice) || shadowEntryPrice <= 0) {
    return 'LOSS_STOP';
  }
  const diffPct = ((hardStopLoss - shadowEntryPrice) / shadowEntryPrice) * 100;
  if (Math.abs(diffPct) <= tolerancePct) return 'BEP_PROTECTION';
  if (diffPct > 0) return 'PROFIT_LOCK_IN';

  // ADR-0079 BEP Glide 영역 흡수 — entryATR14 양수 + ENV 비활성 + 글라이드 범위 충족 시.
  // 글라이드 하한 = entryPrice − BEP_GLIDE_ATR_RATIO × ATR14.
  // hardStopLoss 가 글라이드 하한 이상 + entryPrice 미만 → BEP_PROTECTION 으로 흡수.
  if (
    entryATR14 !== undefined &&
    Number.isFinite(entryATR14) &&
    entryATR14 > 0 &&
    process.env.BEP_GLIDE_DISABLED !== 'true'
  ) {
    const glideFloor = shadowEntryPrice - BEP_GLIDE_ATR_RATIO * entryATR14;
    if (hardStopLoss >= glideFloor) {
      return 'BEP_PROTECTION';
    }
  }

  return 'LOSS_STOP';
}

/** Stage(1/2/3) × StopSourceCategory(3) → 알림 헤더 + 톤. */
interface AlertSpec {
  emoji: string;
  label: string;
  /** 청산선 도달 거리 라인 suffix. */
  distSuffix: string;
}

export function buildAlertSpec(source: StopSourceCategory, stage: 1 | 2 | 3): AlertSpec {
  if (source === 'PROFIT_LOCK_IN') {
    return {
      emoji: '🟢',
      label: '[원금 보호선 임박]',
      distSuffix:
        stage === 3 ? ' — 곧 수익 락인 청산'
        : stage === 2 ? ' — 수익 락인 청산 직전'
        : ' — 수익 보호선 접근',
    };
  }
  if (source === 'BEP_PROTECTION') {
    return {
      emoji: '🟡',
      label: '[BEP 청산선 임박]',
      distSuffix:
        stage === 3 ? ' — 곧 무손실 청산'
        : stage === 2 ? ' — 무손실 청산 직전'
        : ' — BEP 청산선 접근',
    };
  }
  return {
    emoji: stage === 1 ? '🟡' : stage === 2 ? '🟠' : '🔴',
    label: stage === 3 ? '[손절 집행 임박]' : '[손절 임박]',
    distSuffix:
      stage === 3 ? ' — 곧 청산 실행'
      : stage === 2 ? ' — 확인 필요'
      : ' — 손절 접근',
  };
}

/**
 * 알림 본문 빌더 — 3 메트릭 동시 노출:
 *   1. 현재가 + 진입가 대비 pnlPct (수익/손실 즉시 인지)
 *   2. 청산선 가격 + 진입가 대비 차이 (BEP / 수익 / 손실 분류 명시)
 *   3. 청산선 도달 거리 (기존, distSuffix 로 의미 분기)
 *
 * pnlPct 가 양수일 때 "손절" 단어는 distSuffix 분기로 자동 회피된다.
 */
export function buildAlertMessage(input: {
  stockName: string;
  stockCode: string;
  currentPrice: number;
  shadowEntryPrice: number;
  hardStopLoss: number;
  distToStopPct: number;
  stage: 1 | 2 | 3;
  source: StopSourceCategory;
}): string {
  const { stockName, stockCode, currentPrice, shadowEntryPrice, hardStopLoss, distToStopPct, stage, source } = input;
  const spec = buildAlertSpec(source, stage);

  const entryPnlPct =
    Number.isFinite(shadowEntryPrice) && shadowEntryPrice > 0
      ? ((currentPrice - shadowEntryPrice) / shadowEntryPrice) * 100
      : 0;
  const stopVsEntryPct =
    Number.isFinite(shadowEntryPrice) && shadowEntryPrice > 0
      ? ((hardStopLoss - shadowEntryPrice) / shadowEntryPrice) * 100
      : 0;

  const pnlSign = entryPnlPct >= 0 ? '+' : '';
  const stopVsSign = stopVsEntryPct >= 0 ? '+' : '';

  const stopLabel =
    source === 'PROFIT_LOCK_IN' ? '원금 보호선'
    : source === 'BEP_PROTECTION' ? 'BEP 청산선'
    : '손절가';

  const stopVsEntryNote =
    source === 'BEP_PROTECTION'
      ? '= 매수가'
      : `매수가 ${stopVsSign}${stopVsEntryPct.toFixed(2)}%`;

  return (
    `${spec.emoji} <b>${spec.label} ${stockName} (${stockCode})</b>\n` +
    `현재가: ${currentPrice.toLocaleString()}원 (매수가 대비 ${pnlSign}${entryPnlPct.toFixed(2)}%)\n` +
    `${stopLabel}: ${hardStopLoss.toLocaleString()}원 (${stopVsEntryNote})\n` +
    `도달까지: -${distToStopPct.toFixed(1)}%${spec.distSuffix}`
  );
}

export async function stopApproachAlert(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, hardStopLoss } = ctx;

  // ADR-0059: stale hardStopLoss 시 0 fallback — 청산선 접근 알림 보호.
  const distToStop = safePctChange(currentPrice, hardStopLoss, {
    label: `exitEngine.distToStop:${shadow.stockCode}`,
  }) ?? 0;
  const stage = shadow.stopApproachStage ?? 0;
  // ADR-0079 정합 (PR-Z7 H1): entryATR14 전달로 BEP Glide 영역 BEP_PROTECTION 흡수.
  const source = classifyStopSource(
    hardStopLoss,
    shadow.shadowEntryPrice,
    BEP_TOLERANCE_PCT,
    shadow.entryATR14,
  );
  // ADR-0572: distToStop% 발동 밴드를 종목 ATR14 기반 동적 밴드로 산출 (cap = 고정 5/3/1%).
  const bands = computeStopApproachBands(currentPrice, shadow.entryATR14);

  if (distToStop > 0 && distToStop < bands.stage1 && stage < 1) {
    shadow.stopApproachStage = 1;
    shadow.exitRuleTag = 'STOP_APPROACH_ALERT';
    const guard = shouldSendShadowExitNotification({ mode: shadow.mode ?? 'SHADOW', tradeDate: new Date().toISOString().slice(0, 10), symbol: shadow.stockCode, positionId: shadow.id, exitReason: source === 'LOSS_STOP' ? 'STOP_LOSS' : source, exitStage: 'STOP_APPROACH', positionStatus: shadow.status, channelType: 'BOT', messageKind: 'STOP_APPROACH_STAGE_1' });
    if (!guard.allow) { console.log(`[EXIT_ALERT_DEDUP_SUPPRESSED] eventId=${guard.eventId} symbol=${shadow.stockCode} reason=${guard.reason} learningTag=CASE_STOP_ALERT_DUPLICATE_SUPPRESSED`); recordShadowExitSuppressed(guard.eventId); return NO_OP; }
    await sendPrivateAlert(
      buildAlertMessage({
        stockName: shadow.stockName,
        stockCode: shadow.stockCode,
        currentPrice,
        shadowEntryPrice: shadow.shadowEntryPrice,
        hardStopLoss,
        distToStopPct: distToStop,
        stage: 1,
        source,
      }),
      {
        priority: 'HIGH',
        dedupeKey: `stop_approach_1:${shadow.stockCode}`,
        ackFamilyKey: `stop_approach:${shadow.stockCode}`,
      },
    ).catch(console.error);
    recordShadowExitNotification({ mode: shadow.mode ?? 'SHADOW', tradeDate: new Date().toISOString().slice(0, 10), symbol: shadow.stockCode, positionId: shadow.id, exitReason: source === 'LOSS_STOP' ? 'STOP_LOSS' : source, exitStage: 'STOP_APPROACH', channelType: 'BOT' });
  }

  if (distToStop > 0 && distToStop < bands.stage2 && stage < 2) {
    shadow.stopApproachStage = 2;
    shadow.exitRuleTag = 'STOP_APPROACH_ALERT';
    const guard = shouldSendShadowExitNotification({ mode: shadow.mode ?? 'SHADOW', tradeDate: new Date().toISOString().slice(0, 10), symbol: shadow.stockCode, positionId: shadow.id, exitReason: source === 'LOSS_STOP' ? 'STOP_LOSS' : source, exitStage: 'STOP_CONFIRM_REQUIRED', positionStatus: shadow.status, channelType: 'BOT', messageKind: 'STOP_APPROACH_STAGE_2' });
    if (!guard.allow) { console.log(`[EXIT_ALERT_DEDUP_SUPPRESSED] eventId=${guard.eventId} symbol=${shadow.stockCode} reason=${guard.reason} learningTag=CASE_STOP_ALERT_DUPLICATE_SUPPRESSED`); recordShadowExitSuppressed(guard.eventId); return NO_OP; }
    await sendPrivateAlert(
      buildAlertMessage({
        stockName: shadow.stockName,
        stockCode: shadow.stockCode,
        currentPrice,
        shadowEntryPrice: shadow.shadowEntryPrice,
        hardStopLoss,
        distToStopPct: distToStop,
        stage: 2,
        source,
      }),
      {
        priority: 'CRITICAL',
        dedupeKey: `stop_approach_2:${shadow.stockCode}`,
        ackFamilyKey: `stop_approach:${shadow.stockCode}`,
      },
    ).catch(console.error);
    recordShadowExitNotification({ mode: shadow.mode ?? 'SHADOW', tradeDate: new Date().toISOString().slice(0, 10), symbol: shadow.stockCode, positionId: shadow.id, exitReason: source === 'LOSS_STOP' ? 'STOP_LOSS' : source, exitStage: 'STOP_CONFIRM_REQUIRED', channelType: 'BOT' });
  }

  if (distToStop > 0 && distToStop < bands.stage3 && stage < 3) {
    shadow.stopApproachStage = 3;
    shadow.exitRuleTag = 'STOP_APPROACH_ALERT';
    const guard = shouldSendShadowExitNotification({ mode: shadow.mode ?? 'SHADOW', tradeDate: new Date().toISOString().slice(0, 10), symbol: shadow.stockCode, positionId: shadow.id, exitReason: source === 'LOSS_STOP' ? 'STOP_LOSS' : source, exitStage: 'STOP_EXECUTION_IMMINENT', positionStatus: shadow.status, channelType: 'BOT', messageKind: 'STOP_APPROACH_STAGE_3' });
    if (!guard.allow) { console.log(`[EXIT_ALERT_DEDUP_SUPPRESSED] eventId=${guard.eventId} symbol=${shadow.stockCode} reason=${guard.reason} learningTag=CASE_STOP_ALERT_DUPLICATE_SUPPRESSED`); recordShadowExitSuppressed(guard.eventId); return NO_OP; }
    await sendPrivateAlert(
      buildAlertMessage({
        stockName: shadow.stockName,
        stockCode: shadow.stockCode,
        currentPrice,
        shadowEntryPrice: shadow.shadowEntryPrice,
        hardStopLoss,
        distToStopPct: distToStop,
        stage: 3,
        source,
      }),
      {
        priority: 'CRITICAL',
        dedupeKey: `stop_approach_3:${shadow.stockCode}`,
        ackFamilyKey: `stop_approach:${shadow.stockCode}`,
      },
    ).catch(console.error);
    recordShadowExitNotification({ mode: shadow.mode ?? 'SHADOW', tradeDate: new Date().toISOString().slice(0, 10), symbol: shadow.stockCode, positionId: shadow.id, exitReason: source === 'LOSS_STOP' ? 'STOP_LOSS' : source, exitStage: 'STOP_EXECUTION_IMMINENT', channelType: 'BOT' });
  }
  return NO_OP;
}
