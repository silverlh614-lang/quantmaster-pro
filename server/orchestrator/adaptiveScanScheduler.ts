/**
 * adaptiveScanScheduler.ts — 적응형 스캔 빈도 결정기
 *
 * cron은 1분 간격으로 tick하지만, 실제 스캔 실행은 여기서 결정한다.
 * 4가지 변수로 유효 간격(effectiveInterval)을 산출한 뒤
 * 마지막 스캔 후 충분한 시간이 경과했을 때만 스캔을 허용한다.
 *
 * ┌─ 1. 시간대별 기본 간격 ──────────────────────────────────────────┐
 * │  09:00~09:30 :  2분 (시초가 급변)                                │
 * │  09:30~11:30 :  3분 (오전 주도주 형성)                           │
 * │  11:30~13:00 : SELL_ONLY 10분 (점심 — Volume Clock 차단 연동)    │
 * │  13:00~14:30 :  5분 (오후 재개장)                                │
 * │  14:30~14:55 :  2분 (마감 전 급변)                               │
 * │  14:55~15:20 : SELL_ONLY  2분 (마감 동시호가 — exitEngine 전용)  │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 2. 레짐 배율 ───────────────────────────────────────────────────┐
 * │  R1_TURBO / R3_EARLY : ×0.5  (더 자주)                          │
 * │  R2_BULL             : ×1.0  (기준)                              │
 * │  R4_NEUTRAL          : ×1.5                                      │
 * │  R5_CAUTION          : ×2.0                                      │
 * │  R6_DEFENSE          : 매도 전용 2분 고정                         │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 3. VKOSPI 급변 ─────────────────────────────────────────────────┐
 * │  당일 +5% 이상 급등 → 즉시 SELL_ONLY 강제 실행 (30분 쿨다운)     │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 4. 보유 포지션 수 ──────────────────────────────────────────────┐
 * │  포지션 ≥ maxPositions × 0.7 → 기본 간격에 +1분                  │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import { REGIME_CONFIGS } from '../../src/services/quant/regimeEngine.js';
import { sendEmptyScanDecisionBroker, sendTelegramAlert } from '../alerts/telegramClient.js';
import { getEffectiveGateThreshold } from '../trading/gateConfig.js';
import { canApplyToday } from '../persistence/overrideLedger.js';
import { notifyEmptyScan, resetEmptyScanCounter } from './emptyScanPostmortem.js';
import {
  buildThresholdProposal, formatGateHistogram,
  alreadyExecutedThisSession, markSessionExecuted,
} from './thresholdSearchLoop.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface ScanDecision {
  shouldScan:      boolean;
  intervalMinutes: number;
  reason:          string;
  priority:        'SELL_ONLY' | 'FULL' | 'SKIP';
}

// ── 모듈 상태 (서버 재시작 시 초기화 — 의도적) ───────────────────────────────

let lastScanAt         = 0;  // ms timestamp
let lastVkospikSpikeAt = 0;  // ms timestamp

// ── 아이디어 5: 피드백 루프 — 빈 스캔 연속 시 간격 확대 ──────────────────────
let consecutiveEmptyScans = 0;
const EMPTY_SCAN_BACKOFF_THRESHOLD = 5;  // 5회 연속 빈 스캔 → 다음 사이클 스킵 (3→5 완화: Gate 미달 구간 복귀 대응)
const EMPTY_SCAN_MAX_MULTIPLIER    = 3;  // 최대 3배까지 간격 확대

// ── 레짐 배율 맵 ─────────────────────────────────────────────────────────────

const REGIME_MULTIPLIER: Record<string, number> = {
  R1_TURBO:   0.5,
  R3_EARLY:   0.5,
  R2_BULL:    1.0,
  R4_NEUTRAL: 1.5,
  R5_CAUTION: 2.0,
  R6_DEFENSE: 99,  // 내부 분기로 처리
};

const VKOSPI_SPIKE_THRESHOLD  = 5;           // %
const VKOSPI_SPIKE_COOLDOWN   = 30 * 60_000; // 30분

// ── 메인 결정 함수 ────────────────────────────────────────────────────────────

/**
 * 현재 상황을 읽어 스캔 실행 여부와 모드를 결정한다.
 * tradingOrchestrator.dispatch()의 INTRADAY case에서 매 1분 tick마다 호출.
 */
export function decideScan(): ScanDecision {
  const now        = Date.now();
  const kst        = new Date(now + 9 * 60 * 60 * 1000);
  const h          = kst.getUTCHours();
  const m          = kst.getUTCMinutes();
  const t          = h * 100 + m;

  const macroState = loadMacroState();
  const regime     = getLiveRegime(macroState);
  const shadows    = loadShadowTrades();

  const activePositions = shadows.filter(
    (s) => s.status === 'PENDING' || s.status === 'ORDER_SUBMITTED' || s.status === 'PARTIALLY_FILLED' || s.status === 'ACTIVE' || s.status === 'EUPHORIA_PARTIAL',
  ).length;
  const maxPositions = REGIME_CONFIGS[regime]?.maxPositions ?? 4;

  // ── 1. VKOSPI 급등 감지 → 즉시 SELL_ONLY 강제 실행 ──────────────────────
  const vkospiDayChange = macroState?.vkospiDayChange ?? 0;
  if (
    vkospiDayChange > VKOSPI_SPIKE_THRESHOLD &&
    now - lastVkospikSpikeAt > VKOSPI_SPIKE_COOLDOWN
  ) {
    lastVkospikSpikeAt = now;
    lastScanAt         = now;
    return {
      shouldScan:      true,
      intervalMinutes: 0,
      reason:          `VKOSPI 급등 +${vkospiDayChange.toFixed(1)}% — 즉시 매도 모니터링`,
      priority:        'SELL_ONLY',
    };
  }

  // ── 2. R6_DEFENSE: 매도 전용, 2분 고정 ───────────────────────────────────
  if (regime === 'R6_DEFENSE') {
    const effectiveInterval = 2;
    if (now - lastScanAt < effectiveInterval * 60_000) {
      return {
        shouldScan:      false,
        intervalMinutes: effectiveInterval,
        reason:          `R6 DEFENSE — ${((now - lastScanAt) / 60_000).toFixed(1)}분 경과 (목표: ${effectiveInterval}분)`,
        priority:        'SKIP',
      };
    }
    lastScanAt = now;
    return {
      shouldScan:      true,
      intervalMinutes: effectiveInterval,
      reason:          'R6 DEFENSE — 포지션 모니터링',
      priority:        'SELL_ONLY',
    };
  }

  // ── 3. 시간대별 기본 간격 ────────────────────────────────────────────────
  //   Volume Clock과 연동: 11:30~13:00 및 14:55~15:20은 매수 차단 구간이므로
  //   SELL_ONLY 모드로 exitEngine 포지션 감시만 수행 (Yahoo API 호출 절약)
  let baseInterval: number;
  let phase: string;
  let forceSellOnly = false;

  if      (t < 930)  { baseInterval = 2;  phase = '시초가(급변)'; }
  else if (t < 1130) { baseInterval = 3;  phase = '오전 주도주'; }
  else if (t < 1300) { baseInterval = 10; phase = '점심(SELL_ONLY)'; forceSellOnly = true; }
  else if (t < 1430) { baseInterval = 5;  phase = '오후 재개장'; }
  else if (t < 1455) { baseInterval = 2;  phase = '마감전(급변)'; }
  else               { baseInterval = 2;  phase = '마감동시호가(SELL_ONLY)'; forceSellOnly = true; }

  // ── 4. 레짐 배율 적용 ────────────────────────────────────────────────────
  const multiplier = REGIME_MULTIPLIER[regime] ?? 1.0;

  // ── 5. 포지션 조정: 포지션 많음 → +1분 (매도 모니터링 우선) ─────────────
  const positionAdj = activePositions >= maxPositions * 0.7 ? 1 : 0;

  const effectiveInterval = Math.max(1, Math.round(baseInterval * multiplier) + positionAdj);

  // ── 6. 피드백 루프: 빈 스캔 연속 시 간격 확대 ───────────────────────────
  //   5회 연속 빈 스캔 → 다음 사이클 1회 스킵 (Yahoo Finance 레이트 리밋 절약)
  //   연속 빈 스캔 누적에 따라 점진적 간격 확대 (최대 ×3)
  const emptyBackoff = consecutiveEmptyScans >= EMPTY_SCAN_BACKOFF_THRESHOLD
    ? Math.min(EMPTY_SCAN_MAX_MULTIPLIER, 1 + Math.floor(consecutiveEmptyScans / EMPTY_SCAN_BACKOFF_THRESHOLD))
    : 1;

  const finalInterval = effectiveInterval * emptyBackoff;

  // ── 7. 인터벌 미충족 → skip ──────────────────────────────────────────────
  const elapsedMin = (now - lastScanAt) / 60_000;
  if (elapsedMin < finalInterval) {
    return {
      shouldScan:      false,
      intervalMinutes: finalInterval,
      reason: (
        `${phase} / ${regime}(×${multiplier})` +
        (emptyBackoff > 1 ? ` / 빈스캔×${emptyBackoff}` : '') +
        ` — ${elapsedMin.toFixed(1)}분 경과 (목표: ${finalInterval}분)`
      ),
      priority: 'SKIP',
    };
  }

  // ── 8. 스캔 실행 ─────────────────────────────────────────────────────────
  lastScanAt = now;
  return {
    shouldScan:      true,
    intervalMinutes: finalInterval,
    reason: (
      `${phase} | ${regime}(×${multiplier})` +
      (emptyBackoff > 1 ? ` | 빈스캔×${emptyBackoff}→SELL_ONLY` : '') +
      ` | 포지션 ${activePositions}/${maxPositions}` +
      ` → ${finalInterval}분 간격`
    ),
    priority: (forceSellOnly || emptyBackoff > 1) ? 'SELL_ONLY' : 'FULL',
  };
}

/** 매수 가능 시간대(KST) 판정 — 점심/마감동시호가/장외 제외. */
function isBuyableKstWindow(now = Date.now()): boolean {
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  const dow = kst.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const t = kst.getUTCHours() * 100 + kst.getUTCMinutes();
  // 09:00~11:30 (오전) + 13:00~14:30 (오후 정상 매매) = 매수 가능 구간
  return (t >= 900 && t < 1130) || (t >= 1300 && t < 1430);
}

/**
 * 스캔 결과를 피드백한다 — tradingOrchestrator에서 runAutoSignalScan 완료 후 호출.
 *
 * signalCount가 0이면 consecutiveEmptyScans를 1 증가시키고,
 * 1 이상이면 즉시 0으로 리셋한다.
 * 5회 연속 빈 스캔이 누적되면 decideScan()이 인터벌을 자동 확대한다.
 *
 * 로그 레벨:
 *   - SELL_ONLY / 장외 구간의 빈 스캔은 debug 로그만 (정상 동작)
 *   - 매수 가능 구간의 5회 연속 빈 스캔은 warn + Telegram 알림
 *     → 게이트 임계치가 현재 시장에 비해 너무 높다는 신호
 */
export function recordScanResult(signalCount: number, opts?: { positionFull?: boolean }): void {
  // 포지션 만석으로 인한 진입 스킵은 "빈 스캔"이 아님 — 카운터에서 제외
  // 이를 빈 스캔으로 카운트하면 SELL_ONLY 무한 루프에 빠짐
  if (opts?.positionFull) {
    // 포지션 만석은 정상 동작이므로 카운터를 증가시키지 않고 유지
    return;
  }

  if (signalCount === 0) {
    consecutiveEmptyScans++;
    // ── 포스트모템 자가판별: 3회 누적마다 "기능 vs 버그" 판정 ─────────────
    // 단순 백오프 확대보다 먼저 돌아서, 레짐이 정당히 거부한 것인지
    // 게이트가 병리적으로 닫힌 것인지를 엔진이 스스로 결론낸다.
    const postmortem = notifyEmptyScan();
    if (postmortem && postmortem.verdict === 'PATHOLOGICAL_BLOCK' && isBuyableKstWindow()) {
      sendTelegramAlert(
        `🔬 <b>[빈스캔 포스트모템] PATHOLOGICAL_BLOCK</b>\n` +
        `레짐: ${postmortem.regime} | 원인: ${postmortem.dominantCause}\n` +
        `Gate 실패율: ${(postmortem.metrics.gateFailRatio * 100).toFixed(1)}% ` +
        `(${postmortem.metrics.gateFail}/${postmortem.metrics.gateReached})\n` +
        (postmortem.topBlockerCondition
          ? `최대 병목: ${postmortem.topBlockerCondition} ` +
            `(${(postmortem.topBlockerFailRate * 100).toFixed(1)}%)\n`
          : '') +
        `권고: ${postmortem.recommendedAction}\n` +
        `${postmortem.reason}`,
      ).catch(console.error);
    }

    if (consecutiveEmptyScans >= EMPTY_SCAN_BACKOFF_THRESHOLD) {
      const multiplier = Math.min(
        EMPTY_SCAN_MAX_MULTIPLIER,
        1 + Math.floor(consecutiveEmptyScans / EMPTY_SCAN_BACKOFF_THRESHOLD),
      );
      const msg = `[AdaptiveScheduler] 빈 스캔 ${consecutiveEmptyScans}회 연속 — 다음 간격 ×${multiplier} 확대`;
      if (!isBuyableKstWindow()) {
        console.debug(`${msg} (SELL_ONLY·장외 정상 동작)`);
      } else {
        console.warn(`${msg} — 매수 구간 연속 빈 스캔, Gate 임계치 점검 필요`);
        if (consecutiveEmptyScans === EMPTY_SCAN_BACKOFF_THRESHOLD) {
          // 단일 임계 도달 시점에만 1회 알림 (spam 방지).
          // 단순 경보가 아닌 3택 Decision Broker로 전환 — 운용자가 "도구를 든 판단자"로 서도록.
          const regime = getLiveRegime(loadMacroState());
          const usage = canApplyToday();
          const currentThreshold = getEffectiveGateThreshold(regime);
          sendEmptyScanDecisionBroker({
            consecutiveEmptyScans,
            regime,
            currentThreshold,
            usedToday: usage.used,
            dailyLimit: usage.limit,
          }).catch(console.error);

          // Phase 5-⑪: Threshold Search Loop — 세션당 1회 gate 분포 + 섀도우 드라이런 제안
          if (!alreadyExecutedThisSession()) {
            markSessionExecuted();
            try {
              const watchlist = loadWatchlist();
              const scores = watchlist
                .map((w) => w.gateScore ?? 0)
                .filter((s) => Number.isFinite(s));
              // 누적 delta — getEffectiveGateThreshold 에 이미 반영돼 있으므로 0 으로 가정해도 무관하나,
              // 정확한 한도 제어를 위해 baseline 과의 차이를 계산한다.
              const proposal = buildThresholdProposal({
                scores, baselineThreshold: currentThreshold, currentDelta: 0,
              });
              const hist = formatGateHistogram(proposal.histogram, proposal.total);
              const body = proposal.shouldPropose
                ? `📉 <b>[Threshold Search Loop] 임계치 하향 제안</b>\n` +
                  `${proposal.reason}\n\n<pre>${hist}</pre>\n` +
                  `<i>최종 적용은 Decision Broker 버튼으로 수동 승인 필요 — 세션당 1회, 최대 -1.0pt 까지.</i>`
                : `🔬 <b>[Threshold Search Loop] 제안 보류</b>\n` +
                  `${proposal.reason}\n\n<pre>${hist}</pre>`;
              sendTelegramAlert(body, {
                priority: 'HIGH', category: 'threshold_search',
                dedupeKey: `threshold_search:${new Date().toISOString().slice(0, 10)}`,
              }).catch(console.error);
            } catch (e) {
              console.error('[ThresholdSearchLoop] 실행 실패:', e instanceof Error ? e.message : e);
            }
          }
        }
      }
    }
  } else {
    if (consecutiveEmptyScans > 0) {
      console.log(`[AdaptiveScheduler] 신호 ${signalCount}건 발견 — 빈 스캔 카운터 리셋`);
    }
    consecutiveEmptyScans = 0;
    resetEmptyScanCounter();
  }
}

/** 현재 피드백 루프 상태 조회 (진단·디버그용) */
export function getScanFeedbackState(): { consecutiveEmptyScans: number; backoffMultiplier: number } {
  const backoffMultiplier = consecutiveEmptyScans >= EMPTY_SCAN_BACKOFF_THRESHOLD
    ? Math.min(EMPTY_SCAN_MAX_MULTIPLIER, 1 + Math.floor(consecutiveEmptyScans / EMPTY_SCAN_BACKOFF_THRESHOLD))
    : 1;
  return { consecutiveEmptyScans, backoffMultiplier };
}

/** 마지막 스캔 시각 조회 (buy-audit 진단용) — 0이면 아직 미실행 */
export function getLastScanAt(): number {
  return lastScanAt;
}

/** 테스트·진단용: 모듈 상태 초기화 */
export function resetScanState(): void {
  lastScanAt             = 0;
  lastVkospikSpikeAt     = 0;
  consecutiveEmptyScans  = 0;
}
