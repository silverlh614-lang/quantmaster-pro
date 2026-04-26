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
import {
  getCircuitBreakerTrippedAt,
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

function countRecentConsecutiveLosses(shadows: ShadowTrade[]): number {
  const recentClosed = shadows
    .filter((s) => s.exitTime && Date.now() - new Date(s.exitTime).getTime() < FOUR_H_MS)
    .sort((a, b) => new Date(b.exitTime!).getTime() - new Date(a.exitTime!).getTime());
  let consec = 0;
  for (const s of recentClosed) {
    if (s.status === 'HIT_STOP') consec++;
    else break;
  }
  return consec;
}

// 3단계 서킷브레이커:
//   2건: 신규 진입 30분 홀드 + 레짐 1단계 강제 다운그레이드(4시간)
//   3건: 자동거래 완전 정지(setEmergencyStop) + 수동 재개 승인 요청
async function reactToLossStreak(consecLoss: number): Promise<void> {
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
    console.warn(`[Scheduler] 🛑 서킷브레이커 발동 — 연속손절 ${consecLoss}건, 자동거래 정지`);
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
    console.warn(`[Scheduler] 실시간 연속손절 ${consecLoss}건 — 홀드 + 레짐 다운그레이드`);
    return;
  }

  if (consecLoss >= 2 && !isTradingHeld()) {
    setTradingHold(HOLD_MS);
  }
}

async function runShadowResolverTick(): Promise<void> {
  const shadows = loadShadowTrades();
  if (!shadows.some((s) => isOpenShadowStatus(s.status))) return;
  try {
    await updateShadowResults(shadows, getLiveRegime(loadMacroState()));
    saveShadowTrades(shadows);
    await reactToLossStreak(countRecentConsecutiveLosses(shadows));
  } catch (e) {
    console.error('[Scheduler] Shadow trade resolution 실패:', e);
  }
}

export function registerShadowResolverJob(): void {
  // 장중 5분 간격 (브라우저 독립). KST 09:00~15:30 = UTC 00:00~06:30 (Mon-Fri).
  // PR-B-2 ADR-0037: TRADING_DAY_ONLY — KRX 공휴일에 Shadow 청산 도는 무의미.
  scheduledJob('*/5 0-6 * * 1-5', 'TRADING_DAY_ONLY', 'shadow_resolver_tick',
    runShadowResolverTick, { timezone: 'UTC' });
}
