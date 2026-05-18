/**
 * @responsibility Shadow Trade 자동 청산을 주기적으로 실행하고 연속손절 감지 시 서킷브레이커를 작동시킨다.
 *
 * 클라이언트 resolveShadowTrade 루프의 서버 측 대응 — 브라우저 종료 시에도
 * Shadow 포지션 목표가/손절가 도달 시 자동 청산 처리.
 */
import { scheduledJob } from './scheduleGuard.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { loadShadowTrades, saveShadowTrades } from '../persistence/shadowTradeRepo.js';
import { updateShadowResults } from '../trading/exitEngine.js';
import { isOpenShadowStatus } from '../trading/entryEngine.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import { setEmergencyStop } from '../state.js';
import { isKrxTradingDay, toKstDateKey } from '../calendar/krxTradingCalendar.js';
import type { OperationalWarnPayload } from '../observability/operationalWarnTypes.js';
import {
  getCircuitBreakerTrippedAt,
  getCircuitBreakerClearedAt,
  isForcedRegimeDowngradeActive,
  isTradingHeld,
  setForcedRegimeDowngrade,
  setTradingHold,
  tripCircuitBreaker,
} from '../learning/learningState.js';

const FOUR_H_MS = 4 * 60 * 60 * 1000;
const HOLD_MS = 30 * 60 * 1000;
const FORCED_DOWNGRADE_MS = 4 * 60 * 60 * 1000;

type ShadowTrade = ReturnType<typeof loadShadowTrades>[number];

async function emitResolverOperationalWarn(payload: OperationalWarnPayload): Promise<void> {
  const { emitOperationalWarn } = await import('../observability/operationalWarn.js');
  emitOperationalWarn(payload);
}

async function emitShadowResolverJobFailed(error: unknown): Promise<void> {
  const { emitShadowPersistenceWarn } = await import('../persistence/shadow/shadowPersistenceGateway.js');
  emitShadowPersistenceWarn({
    code: 'P1_SHADOW_RESOLVER_JOB_FAILED',
    source: 'ShadowResolverJob',
    message: 'Shadow resolver job failed; shadow learning/resolution will retry on next tick.',
    reason: error instanceof Error ? error.message : String(error),
    learningImpact: 'DELAYED',
    ttlSec: 60,
  });
}

function isKrxClosedShadowResolverSkip(now = new Date()): boolean {
  if (process.env.SHADOW_RESOLVER_ON_KRX_CLOSED === 'true') return false;
  return !isKrxTradingDay(toKstDateKey(now));
}

export function countRecentConsecutiveLosses(shadows: ShadowTrade[]): number {
  // ADR-0111 hotfix (사용자 4/30 보고 "리셋해도 똑같음"):
  //   /reset 으로 circuitBreaker 해제했지만 동일한 4시간 안 손절을 다시 카운트해
  //   다음 5분 cron 에서 즉시 재발동하던 결함 차단.
  //   clearCircuitBreaker 시 영속한 baseline 시각 *이후* 손절만 카운트.
  const clearedAt = getCircuitBreakerClearedAt();
  const clearedMs = clearedAt ? new Date(clearedAt).getTime() : 0;
  // 두 lower bound 중 더 *최근* 시각 사용 — clearedMs 가 4시간 전보다 최근이면 그 시각이 baseline.
  const cutoffMs = Math.max(Date.now() - FOUR_H_MS, clearedMs);

  // ADR-0112: BREAKEVEN(BE) 청산은 LOSS 카운트에서 제외. 1차 로그(2026-04-30) 의
  // PROFIT_PROTECTION -0.18~-0.45% 청산 3건이 status='HIT_STOP' 이지만
  // exitOutcome='BE' 로 분류되어 서킷 무한 루프 영구 차단.
  // BE_CLASSIFICATION_DISABLED=true 시 ENV 우회 → 모든 HIT_STOP 카운트(기존 동작).
  const beDisabled = process.env.BE_CLASSIFICATION_DISABLED === 'true';
  const recentClosed = shadows
    .filter((s) => s.exitTime && new Date(s.exitTime).getTime() > cutoffMs)
    .sort((a, b) => new Date(b.exitTime!).getTime() - new Date(a.exitTime!).getTime());
  let consec = 0;
  for (const s of recentClosed) {
    const isRealLoss = s.status === 'HIT_STOP' && (beDisabled || s.exitOutcome !== 'BE');
    if (isRealLoss) consec++;
    else break;
  }
  return consec;
}

// 3단계 서킷브레이커:
//   2건: 신규 진입 30분 홀드 + 레짐 1단계 강제 다운그레이드(4시간)
//   3건: 자동거래 완전 정지(setEmergencyStop) + 수동 재개 승인 요청
export async function reactToLossStreak(consecLoss: number): Promise<void> {
  if (consecLoss >= 3 && !getCircuitBreakerTrippedAt()) {
    tripCircuitBreaker();
    setEmergencyStop(true);
    await sendTelegramAlert(
      `🛑 <b>[서킷브레이커 발동]</b> 연속손절 ${consecLoss}건\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `• 자동거래 <b>일시정지</b> (setEmergencyStop=true)\n` +
      `• 레짐 강제 다운그레이드 유지\n` +
      `• 신규 진입 홀드 30분 유지\n\n` +
      `📌 <b>수동 재개 필요</b> — /emergency off 또는 웹훅 명령으로 해제`,
      { priority: 'CRITICAL', dedupeKey: `circuit_breaker:${consecLoss}` },
    ).catch(console.error);
    await emitResolverOperationalWarn({
      priority: 'P1',
      domain: 'EXECUTION',
      code: 'P1_SHADOW_RESOLVER_CIRCUIT_BREAKER_TRIPPED',
      message: `Shadow resolver tripped circuit breaker after ${consecLoss} consecutive losses.`,
      executionImpact: 'LIVE_ORDER_BLOCKED',
      dedupKey: `shadow-resolver:circuit-breaker:${consecLoss}`,
      ttlSec: 60,
      details: { reason: 'consecutive-loss-streak', consecLoss },
    });
    return;
  }

  if (consecLoss >= 2 && !isForcedRegimeDowngradeActive()) {
    setForcedRegimeDowngrade(FORCED_DOWNGRADE_MS);
    setTradingHold(HOLD_MS);
    await sendTelegramAlert(
      `🚨 <b>[실시간 연속손절]</b> ${consecLoss}건 연속\n` +
      `• 신규 진입 30분 홀드\n` +
      `• 레짐 1단계 강제 다운그레이드 (4시간) — 포지션 한도/Kelly 축소`,
      { priority: 'CRITICAL', dedupeKey: `streak_hold:${consecLoss}` },
    ).catch(console.error);
    await emitResolverOperationalWarn({
      priority: 'P1',
      domain: 'EXECUTION',
      code: 'P1_SHADOW_RESOLVER_LOSS_STREAK_HOLD',
      message: `Shadow resolver applied trading hold after ${consecLoss} consecutive losses.`,
      executionImpact: 'NEW_BUY_BLOCKED_ONLY',
      dedupKey: `shadow-resolver:loss-streak-hold:${consecLoss}`,
      ttlSec: 60,
      details: { reason: 'consecutive-loss-streak', consecLoss },
    });
    return;
  }

  if (consecLoss >= 2 && !isTradingHeld()) {
    setTradingHold(HOLD_MS);
  }
}

async function runShadowResolverTick(): Promise<void> {
  if (isKrxClosedShadowResolverSkip()) {
    console.log('[Scheduler] KRX 휴장일/비거래일 — shadow_resolver_tick 스킵');
    return;
  }
  const shadows = loadShadowTrades();
  if (!shadows.some((s) => isOpenShadowStatus(s.status))) return;
  try {
    await updateShadowResults(shadows, getLiveRegime(loadMacroState()));
    saveShadowTrades(shadows);
    await reactToLossStreak(countRecentConsecutiveLosses(shadows));
  } catch (e) {
    await emitShadowResolverJobFailed(e);
    console.error('[Scheduler] Shadow trade resolution 실패:', e);
  }
}

export function registerShadowResolverJob(): void {
  // 장중 5분 간격 (브라우저 독립). KST 09:00~15:30 = UTC 00:00~06:30 (Mon-Fri).
  // PR-B-2 ADR-0043: TRADING_DAY_ONLY — KRX 공휴일에 Shadow 청산 도는 무의미.
  scheduledJob('*/5 0-6 * * 1-5', 'TRADING_DAY_ONLY', 'shadow_resolver_tick',
    runShadowResolverTick, { timezone: 'UTC' });
}
