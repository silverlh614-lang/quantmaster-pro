// @responsibility adaptiveScanScheduler 오케스트레이터 모듈
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
 * │    └ macro_unblock 활성 시: FULL 스캔으로 전환 (override 우선)    │
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

import { emitDiagnosticWarn } from '../observability/diagnosticWarn.js';
import { logger } from '../utils/logger.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { getLiveRegime, getRegimeDiagnostics, type RegimeDiagnostics } from '../trading/regimeBridge.js';
import type { ShadowCandidateScanTrigger, BiasLabel } from '../trading/marketStateResolver.js';
import { REGIME_CONFIGS } from '../../src/services/quant/regimeEngine.js';
import { sendEmptyScanDecisionBroker, sendTelegramAlert } from '../alerts/telegramClient.js';
import { getEffectiveGateThreshold } from '../trading/gateConfig.js';
import { canApplyToday } from '../persistence/overrideLedger.js';
import { notifyEmptyScan, resetEmptyScanCounter } from './emptyScanPostmortem.js';
import { checkVolumeClockWindow } from '../trading/volumeClock.js';
import {
  classifyEmptyScan,
  shouldCountEmptyScan,
  type EngineModeForEmptyScan,
} from '../trading/signalScanner/emptyScanTaxonomy.js';
import {
  buildThresholdProposal, formatGateHistogram,
  alreadyExecutedThisSession, markSessionExecuted,
} from './thresholdSearchLoop.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { isMacroEntryOverrideActive } from '../state.js';
import {
  evaluateEmptyScanLiveness,
  isEmptyScanLivenessPolicyDisabled,
  type EmptyScanLivenessDecision,
  type EmptyScanMarketSession,
} from '../trading/signalScanner/emptyScanLivenessPolicy.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface ScanDecision {
  shouldScan:      boolean;
  intervalMinutes: number;
  reason:          string;
  priority:        'SELL_ONLY' | 'FULL' | 'SKIP';
  candidateScanTrigger?: ShadowCandidateScanTrigger;
  /**
   * ADR-0451 — Empty Scan Liveness Policy 결정 결과 (옵셔널, 후방호환).
   * REGULAR session + emptyScanStreak 만으로 SELL_ONLY 강제하지 않음을 호출자에 노출.
   * /scan_blockers 메시지가 본 필드를 읽어 liveness section 자동 노출.
   */
  emptyScanLivenessDecision?: EmptyScanLivenessDecision;
}

/* ───────── ADR-0451 — KST 분 단위 → marketSession 매핑 SSOT ───────── */

/**
 * adaptiveScanScheduler 의 phase 결정과 정합한 KST 분 → market session 매핑.
 *   < 930  → OPEN_AUCTION (시초가)
 *   < 1200 → REGULAR (오전 매매)
 *   < 1300 → LUNCH_BREAK (점심)
 *   < 1500 → REGULAR (오후 매매)
 *   < 1530 → AFTER_HOURS (마감 30분 — exitEngine 전용)
 *   ≥ 1530 → CLOSED
 *
 * legacy `TRADE_WINDOW_LEGACY_HOURS` 도 동일 매핑 (점심 11:30~13:00 → LUNCH_BREAK).
 */
function deriveMarketSessionFromKstMinutes(t: number, useLegacy: boolean): EmptyScanMarketSession {
  if (useLegacy) {
    if (t < 930) return 'OPEN_AUCTION';
    if (t < 1130) return 'REGULAR';
    if (t < 1300) return 'LUNCH_BREAK';
    if (t < 1430) return 'REGULAR';
    if (t < 1500) return 'REGULAR';
    return 'AFTER_HOURS';
  }
  if (t < 930) return 'OPEN_AUCTION';
  if (t < 1200) return 'REGULAR';
  if (t < 1300) return 'LUNCH_BREAK';
  if (t < 1500) return 'REGULAR';
  if (t < 1530) return 'AFTER_HOURS';
  return 'CLOSED';
}

// ── 모듈 상태 (서버 재시작 시 초기화 — 의도적) ───────────────────────────────

let lastScanAt         = 0;  // ms timestamp
let lastVkospikSpikeAt = 0;  // ms timestamp
/**
 * 외부 훅에 의해 "즉시 재스캔 필요" 플래그가 설정된다 (예: exitEngine 이 HIT_TARGET/HIT_STOP 으로
 * 슬롯을 비웠을 때, volumeClock 점심 차단 해제 직후). 다음 decideScan() 호출에서 1회만 소비되고
 * 바로 false 로 리셋된다. interval/backoff 우회 수단.
 */
let immediateRescanRequested = false;
let lastLunchBlockSeenAt     = 0;  // 11:30~13:00 구간 진입 최근 시각 (점심 해제 감지용)
let lastR6ConfirmationScanKey: string | null = null;
let lastBiasLabel: BiasLabel | null = null;

/**
 * 외부 모듈(exitEngine 등)이 "지금 즉시 다음 tick 부터 스캔하라" 고 요청할 수 있는 훅.
 *
 * 사용처:
 *   1. exitEngine.updateShadowResults — HIT_TARGET/HIT_STOP 으로 슬롯 회복 시
 *   2. volumeClock 13:00 점심 차단 해제 직후 (decideScan 내부에서 자체 호출)
 *
 * 구현: lastScanAt 리셋 + 빈 스캔 백오프 리셋 + immediateRescanRequested 플래그.
 * interval/multiplier 가 어떻든 다음 INTRADAY tick 에서 shouldScan=true 가 되도록 보장.
 */
export function requestImmediateRescan(reason: string): void {
  immediateRescanRequested = true;
  lastScanAt = 0;
  if (consecutiveEmptyScans > 0) {
    // 슬롯 회복·세션 재개 등 구조적 변경 시, 누적된 빈 스캔 backoff 를 초기화해야
    // 다음 스캔이 제시간에 full 로 돈다.
    consecutiveEmptyScans = 0;
    resetEmptyScanCounter();
  }
  console.log(`[AdaptiveScheduler] 즉시 재스캔 요청 — ${reason}`);
}

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

REGIME_MULTIPLIER.R6_DEFENSE = 1.0;

const VKOSPI_SPIKE_THRESHOLD  = 5;           // %
const VKOSPI_SPIKE_COOLDOWN   = 30 * 60_000; // 30분

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolveSchedulerBiasScore(macroState: Record<string, unknown> | null | undefined): number {
  if (!macroState) return 0;
  for (const key of ['biasScore', 'directionBiasScore', 'preMarketBiasScore', 'marketBiasScore', 'globalBiasScore', 'riskBiasScore', 'bias']) {
    const explicit = finiteNumber(macroState[key]);
    if (explicit !== undefined) return Math.max(-100, Math.min(100, explicit));
  }
  return 0;
}

function resolveSchedulerBiasLabel(score: number): BiasLabel {
  if (score <= -20) return 'BEAR';
  if (score >= 20) return 'BULL';
  return 'NEUTRAL';
}

function isR6ConfirmationWaitDiagnostics(diagnostics: RegimeDiagnostics): boolean {
  return diagnostics.activeR6Triggers.length === 0 &&
    diagnostics.r6TriggerBreakdown.triggerFreshness === 'FRESH' &&
    diagnostics.r6ShockLatch === true &&
    diagnostics.recoveryBlockedReason === 'WAITING_FOR_CLOSE_OR_NEXT_TRADING_DAY_CONFIRMATION';
}

function resolveR6ConfirmationScanKey(diagnostics: RegimeDiagnostics): string {
  return diagnostics.transitionState.latchTriggeredAt ??
    diagnostics.transitionState.r6ShockLatchDetail?.triggeredAt ??
    diagnostics.transitionState.latchReleaseEligibleAt ??
    diagnostics.transitionState.latchExpiresAt ??
    'R6_CONFIRMATION_WAIT';
}

function emitShadowCandidateScanTrigger(trigger: ShadowCandidateScanTrigger): void {
  const line = `[SHADOW_CANDIDATE_SCAN_TRIGGER] trigger=${trigger} executionImpact=NONE livePermission=GATE_DATA_ONLY realOrderPermission=GATE_DATA_ONLY rollback=R6_SELLONLY_DISABLED`;
  console.info(line);
  sendTelegramAlert(
    `🧪 <b>[Shadow candidate scan trigger]</b>
` +
    `trigger: <code>${trigger}</code>
` +
    `executionImpact: <code>NONE</code>
` +
    `legacy R6/SELL_ONLY ignored; buy permission uses Gate/data quality only`,
    { priority: 'NORMAL', dedupeKey: `shadow_candidate_scan:${trigger}`, cooldownMs: 30 * 60_000 },
  ).catch(console.error);
}

function shouldTriggerRecoveryShadowScan(input: {
  diagnostics: RegimeDiagnostics;
  macroState: Record<string, unknown> | null | undefined;
  mhs: number;
  biasLabel: BiasLabel;
  now: number;
}): ShadowCandidateScanTrigger | undefined {
  const shadowLearningAllowed = true;
  const shadowScanAllowed = true;
  if (!shadowLearningAllowed || !shadowScanAllowed) return undefined;
  const macroFresh = input.diagnostics.r6TriggerBreakdown.triggerFreshness === 'FRESH';
  const noActiveR6 = input.diagnostics.activeR6Triggers.length === 0;
  if (isR6ConfirmationWaitDiagnostics(input.diagnostics) && macroFresh && noActiveR6) {
    const key = resolveR6ConfirmationScanKey(input.diagnostics);
    if (lastR6ConfirmationScanKey !== key) {
      lastR6ConfirmationScanKey = key;
      emitShadowCandidateScanTrigger('R6_CONFIRMATION_WAIT');
      return 'R6_CONFIRMATION_WAIT';
    }
  }

  const recoveredFromBear = lastBiasLabel === 'BEAR' && (input.biasLabel === 'BULL' || input.biasLabel === 'NEUTRAL');
  if (recoveredFromBear && input.mhs >= 60 && macroFresh && noActiveR6) {
    emitShadowCandidateScanTrigger('BIAS_RECOVERY');
    return 'BIAS_RECOVERY';
  }
  return undefined;
}

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
  const regimeDiagnostics = getRegimeDiagnostics(macroState);
  const regime     = regimeDiagnostics.effectiveRegime ?? getLiveRegime(macroState);
  const biasScore = resolveSchedulerBiasScore(macroState as Record<string, unknown> | null);
  const biasLabel = resolveSchedulerBiasLabel(biasScore);
  const recoveryShadowTrigger = shouldTriggerRecoveryShadowScan({
    diagnostics: regimeDiagnostics,
    macroState: macroState as Record<string, unknown> | null,
    mhs: macroState?.mhs ?? 0,
    biasLabel,
    now,
  });
  lastBiasLabel = biasLabel;
  const shadows    = loadShadowTrades();
  const activePositions = shadows.filter(
    (s) =>
      (s.status === 'PENDING' || s.status === 'ORDER_SUBMITTED' || s.status === 'PARTIALLY_FILLED' ||
       s.status === 'ACTIVE' || s.status === 'EUPHORIA_PARTIAL') &&
      s.watchlistSource !== 'INTRADAY' &&
      s.watchlistSource !== 'PRE_BREAKOUT',
  ).length;
  // signalScanner.ts 의 effectiveMaxPositions 와 동일 식.
  // env MAX_CONVICTION_POSITIONS 가 낮게 설정된 경우에도 스캐너와 decideScan 이 일관된 한도를 쓴다.
  const rawRegimeMax = REGIME_CONFIGS[regime]?.maxPositions ?? 4;
  const convictionCap = Number(process.env.MAX_CONVICTION_POSITIONS ?? '10');
  const maxPositions = Math.max(0, Math.min(convictionCap, rawRegimeMax));

  if (recoveryShadowTrigger) {
    lastScanAt = now;
    immediateRescanRequested = false;
    return {
      shouldScan: true,
      intervalMinutes: 0,
      reason: `${recoveryShadowTrigger} - shadow candidate scan (executionImpact=NONE, legacy R6/SELL_ONLY ignored)`,
      priority: 'FULL',
      candidateScanTrigger: recoveryShadowTrigger,
    };
  }

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
      priority:        'FULL',
    };
  }

  // ── 2. R6_DEFENSE: 매도 전용, 2분 고정 ───────────────────────────────────
  if (regime === 'R6_DEFENSE') {
    const effectiveInterval = 2;

    // ── ADR-R6-OVERRIDE-SCAN-001 ───────────────────────────────────────────
    // macro_unblock(r6) 활성 시 SELL_ONLY 강제를 해제하고 FULL 스캔으로 전환.
    // preflight.ts 의 r6EntryOverrideActive 로직이 실제 매수 허용 여부를
    // 최종 판단하므로, decideScan 은 문을 열어주기만 하면 된다.
    //
    // 안전 invariant:
    //   - macro_unblock 미설정 시 기존 동작 100% 보존
    //   - VKOSPI 급등(섹션 1) 이후 강제 SELL_ONLY는 이 블록보다 먼저 실행되므로
    //     VKOSPI 급등 상황에서는 override가 적용되지 않음 (의도된 동작)
    //   - exitEngine·포지션 관리는 FULL/SELL_ONLY 무관하게 항상 실행됨
    // ──────────────────────────────────────────────────────────────────────
    const r6OverrideActive = isMacroEntryOverrideActive('R6_DEFENSE');

    if (r6OverrideActive) {
      // override 활성: FULL 스캔 허용 — preflight가 실제 매수 여부 최종 판단
      if (now - lastScanAt < effectiveInterval * 60_000) {
        return {
          shouldScan:      false,
          intervalMinutes: effectiveInterval,
          reason:          `R6 DEFENSE (OVERRIDE ACTIVE) — ${((now - lastScanAt) / 60_000).toFixed(1)}분 경과 (목표: ${effectiveInterval}분)`,
          priority:        'SKIP',
        };
      }
      lastScanAt = now;
      console.info(
        '[R6_DEFENSE_OVERRIDE_SCAN] macro_unblock active — SELL_ONLY 해제, FULL 스캔 실행 ' +
        'executionImpact=OPERATOR_OVERRIDE liveEntryDeterminedByPreflight=true',
      );
      return {
        shouldScan:      true,
        intervalMinutes: effectiveInterval,
        reason:          'R6 DEFENSE — OPERATOR_MACRO_ENTRY_OVERRIDE active, FULL scan',
        priority:        'FULL',
      };
    }

    // override 없음: 기존 동작 (SELL_ONLY 고정)
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
      priority:        'FULL',
    };
  }

  // ── 3. 시간대별 기본 간격 ────────────────────────────────────────────────
  //   Volume Clock과 연동: 11:30~13:00 및 14:55~15:20은 매수 차단 구간이므로
  //   SELL_ONLY 모드로 exitEngine 포지션 감시만 수행 (Yahoo API 호출 절약)
  let baseInterval: number;
  let phase: string;
  let forceSellOnly = false;

  // ADR-0192 (사용자 5/6): 매매 허용 시간 09:30~12:00 + 13:00~15:30.
  //   - 09:00~09:30 시초가 SELL_ONLY (변동성 회피, 기존 09:00 매수 시작에서 30분 후퇴)
  //   - 점심 차단 12:00~13:00 (기존 11:30~13:00 → 점심 30분 단축, 오전 매매 +30분)
  //   - 오후 정상 매매 13:00~15:00 (기존 13:00~14:30 → +30분)
  //   - 마감 SELL_ONLY 15:00~15:30 (ADR-0122 정합 보존)
  // ENV `TRADE_WINDOW_LEGACY_HOURS=true` 우회 시 기존 동작 복원 (isBuyableKstWindow 와 정합).
  const useLegacy = process.env.TRADE_WINDOW_LEGACY_HOURS === 'true';
  if (useLegacy) {
    if      (t < 930)  { baseInterval = 2;  phase = '시초가(급변)'; }
    else if (t < 1130) { baseInterval = 3;  phase = '오전 주도주'; }
    else if (t < 1300) {
      baseInterval = 10; phase = '점심(SELL_ONLY)'; forceSellOnly = true;
      lastLunchBlockSeenAt = now;
    }
    else if (t < 1430) { baseInterval = 5;  phase = '오후 재개장'; }
    else if (t < 1500) { baseInterval = 2;  phase = '마감전(급변)'; }
    else               { baseInterval = 2;  phase = '마감(SELL_ONLY)'; forceSellOnly = true; }
  } else {
    if      (t < 930)  {
      baseInterval = 5;  phase = '시초가(SELL_ONLY/변동성 회피)'; forceSellOnly = true;
    }
    else if (t < 1200) { baseInterval = 3;  phase = '오전 주도주'; }
    else if (t < 1300) {
      baseInterval = 10; phase = '점심(SELL_ONLY)'; forceSellOnly = true;
      lastLunchBlockSeenAt = now; // 점심 구간 통과 중 — 해제 감지용 기록
    }
    else if (t < 1500) { baseInterval = 3;  phase = '오후 재개장'; }
    // ADR-0122 정합 보존 — 마감 30분 전 SELL_ONLY (15:00~15:30).
    else               { baseInterval = 2;  phase = '마감(SELL_ONLY)'; forceSellOnly = true; }
  }

  // ── 4. 레짐 배율 적용 ────────────────────────────────────────────────────
  if (forceSellOnly) {
    console.info(
      `[LEGACY_R6_SELLONLY_IGNORED] marketSession=ADAPTIVE_SCHEDULER_PHASE ` +
      `inputEntryBlockMode=SELL_ONLY ignoredReasons=TIME_WINDOW_SELL_ONLY_IGNORED_BY_ROLLBACK ` +
      `liveBuyAllowed=GATE_DATA_ONLY realOrderAllowed=GATE_DATA_ONLY shadowSignalAllowed=true ` +
      `diagnosticAllowed=true counterfactualAllowed=true executionImpact='NONE' rollback='R6_SELLONLY_DISABLED'`,
    );
    forceSellOnly = false;
    phase = phase.replace(/SELL_ONLY/g, 'ROLLBACK_DISABLED');
  }

  const multiplier = REGIME_MULTIPLIER[regime] ?? 1.0;

  // ── 5. 포지션 조정: 양방향 보상 ───────────────────────────────────────────
  //   포지션 ≥ maxPositions × 0.7 → +1분 (매도 모니터링 우선)
  //   포지션 ≤ maxPositions × 0.5 → -1분 (슬롯 여유 구간 빠른 재스캔)
  //   maxPositions=0 (R6_DEFENSE) 는 비교를 건너뜀.
  let positionAdj = 0;
  if (maxPositions > 0) {
    if (activePositions >= maxPositions * 0.7)      positionAdj = 1;
    else if (activePositions <= maxPositions * 0.5) positionAdj = -1;
  }

  const effectiveInterval = Math.max(1, Math.round(baseInterval * multiplier) + positionAdj);

  // ── 6. 피드백 루프: 빈 스캔 연속 시 간격 확대 ───────────────────────────
  //   5회 연속 빈 스캔 → 다음 사이클 1회 스킵 (Yahoo Finance 레이트 리밋 절약)
  //   연속 빈 스캔 누적에 따라 점진적 간격 확대 (최대 ×3)
  const emptyBackoff = consecutiveEmptyScans >= EMPTY_SCAN_BACKOFF_THRESHOLD
    ? Math.min(EMPTY_SCAN_MAX_MULTIPLIER, 1 + Math.floor(consecutiveEmptyScans / EMPTY_SCAN_BACKOFF_THRESHOLD))
    : 1;

  const finalInterval = effectiveInterval * emptyBackoff;

  // ── 6-b. 점심 차단 해제 직후 1회 강제 스캔 ───────────────────────────────
  // 11:30~13:00 에 forceSellOnly 로 돌던 직후 13:00 재개 시, 기본 5분 interval 을 기다리면
  // 슬롯 회복·오후 주도주 추격이 지연된다. 점심 구간 통과 기록(lastLunchBlockSeenAt)이 있고
  // 현재 t >= 1300 이며 아직 lunchResumeFiredAt 가 오늘 설정 안 됐다면 1회 force scan.
  if (!forceSellOnly && t >= 1300 && t < 1310 && lastLunchBlockSeenAt > 0) {
    immediateRescanRequested = true;
    // 같은 영업일 내 재진입을 막기 위해 lastLunchBlockSeenAt 를 소비.
    lastLunchBlockSeenAt = 0;
    console.log('[AdaptiveScheduler] 점심 차단 해제 감지 — 오후 개장 1회 강제 스캔');
  }

  // ── 7. 인터벌 미충족 → skip (단, immediateRescanRequested 면 우회) ───────
  //   ADR-0451 — 빈스캔 표시는 interval 확대로 격하 (SELL_ONLY 표현 제거).
  const elapsedMin = (now - lastScanAt) / 60_000;
  if (!immediateRescanRequested && elapsedMin < finalInterval) {
    return {
      shouldScan:      false,
      intervalMinutes: finalInterval,
      reason: (
        `${phase} / ${regime}(×${multiplier})` +
        (emptyBackoff > 1 ? ` / 빈스캔×${emptyBackoff} (interval expanded)` : '') +
        ` — ${elapsedMin.toFixed(1)}분 경과 (목표: ${finalInterval}분)`
      ),
      priority: 'SKIP',
    };
  }

  // ── 8. 스캔 실행 ─────────────────────────────────────────────────────────
  const triggeredByImmediate = immediateRescanRequested;
  immediateRescanRequested = false; // 1회 소비
  lastScanAt = now;

  // ── 8-a. ADR-0451 Empty Scan Liveness Policy ─────────────────────────────
  //   사용자 §"한 줄 정의" — 빈스캔 연속 발생을 SELL_ONLY hard 전환 사유로 쓰지 않고,
  //   DEGRADED/OBSERVE/RETRY 상태로 처리하여 Trading Engine liveness 유지.
  //   ADR-0157 정확 비교: `'1'` / `'TRUE'` / `'yes'` 모두 거부 — 정상 운영 default OFF.
  let livenessDecision: EmptyScanLivenessDecision | undefined;
  let emptyScanForcesSellOnly = false;
  if (!isEmptyScanLivenessPolicyDisabled()) {
    const marketSession = deriveMarketSessionFromKstMinutes(t, useLegacy);
    livenessDecision = evaluateEmptyScanLiveness({
      marketSession,
      emptyScanStreak: consecutiveEmptyScans,
      sellOnlyAlreadyActive: forceSellOnly,
    });
    // 핵심 — REGULAR session + emptyScanStreak 만으로 SELL_ONLY 강제 금지.
    // forceSellOnly (phase-based: 시초가/점심/마감 또는 R6_DEFENSE) 는 그대로 유지.
    emptyScanForcesSellOnly = false;
  }

  // 진단 로그 분기 — emptyBackoff > 1 시 SELL_ONLY 표시 대신 RETRY/DEGRADED · engine alive.
  let backoffLabel = '';
  if (emptyBackoff > 1) {
    backoffLabel = livenessDecision && !livenessDecision.allowSellOnlyTransition
      ? ` | 빈스캔×${emptyBackoff}→RETRY/DEGRADED · engine alive`
      : ` | 빈스캔×${emptyBackoff}→RETRY/DEGRADED · engine alive`;
  }

  return {
    shouldScan:      true,
    intervalMinutes: finalInterval,
    reason: (
      `${phase} | ${regime}(×${multiplier})` +
      backoffLabel +
      (triggeredByImmediate ? ' | ⚡즉시요청' : '') +
      ` | 포지션 ${activePositions}/${maxPositions}` +
      (positionAdj !== 0 ? ` (${positionAdj > 0 ? '+' : ''}${positionAdj}분 조정)` : '') +
      ` → ${finalInterval}분 간격`
    ),
    priority: 'FULL',
    emptyScanLivenessDecision: livenessDecision,
  };
}

/**
 * 매수 가능 시간대(KST) 판정 — 점심/시초가/마감전 SELL_ONLY/장외 제외.
 *
 * ADR-0192 (사용자 5/6): 09:30~12:00 (오전) + 13:00~15:30 (오후) 정책 적용.
 *   - 시초가 09:00~09:30: 변동성 회피 — SELL_ONLY (신규 진입 차단)
 *   - 점심 12:00~13:00: 차단 (기존 11:30~13:00 → 점심 30분 단축)
 *   - 마감 15:30 까지 신규 매매 허용 (기존 14:30 → 1h 추가)
 *
 * ENV `TRADE_WINDOW_LEGACY_HOURS=true` 우회 → ADR-0122 정합 09:00~14:30 동작 복원.
 */
function isBuyableKstWindow(now = Date.now()): boolean {
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  const dow = kst.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const t = kst.getUTCHours() * 100 + kst.getUTCMinutes();
  if (process.env.TRADE_WINDOW_LEGACY_HOURS === 'true') {
    // Legacy: 09:00~11:30 (오전) + 13:00~14:30 (오후) — ADR-0122 정합.
    return (t >= 900 && t < 1130) || (t >= 1300 && t < 1430);
  }
  // ADR-0192: 09:30~12:00 + 13:00~15:30 신규 정책.
  return (t >= 930 && t < 1200) || (t >= 1300 && t < 1530);
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
export interface RecordScanResultOptions {
  positionFull?: boolean;
  engineMode?: EngineModeForEmptyScan;
  now?: Date | number;
  candidateCount?: number;
  waitTriggerCount?: number;
  dataBlockedCount?: number;
}

function coerceRecordScanNow(now: Date | number | undefined): Date | undefined {
  if (now === undefined) return undefined;
  return typeof now === 'number' ? new Date(now) : now;
}

export function recordScanResult(signalCount: number, opts?: RecordScanResultOptions): void {
  // 포지션 만석으로 인한 진입 스킵은 "빈 스캔"이 아님 — 카운터에서 제외
  // 이를 빈 스캔으로 카운트하면 SELL_ONLY 무한 루프에 빠짐
  if (opts?.positionFull) {
    // 포지션 만석은 정상 동작이므로 카운터를 증가시키지 않고 유지
    return;
  }

  if (signalCount === 0) {
    const engineMode = opts?.engineMode === 'SELL_ONLY' ? 'NORMAL' : opts?.engineMode ?? 'NORMAL';
    const emptyScan = classifyEmptyScan({
      now: opts?.now ?? Date.now(),
      engineMode,
      candidateCount: opts?.candidateCount ?? 0,
      waitTriggerCount: opts?.waitTriggerCount ?? 0,
      dataBlockedCount: opts?.dataBlockedCount ?? 0,
    });

    // ADR-452b: SELL_ONLY/session-blocked/structural waits are not true empty scans.
    // shouldCountEmptyScan mirrors the coarse session+mode gate; classifyEmptyScan carries
    // the finer WAIT_TRIGGER/DATA_BLOCKED reason used in logs.
    const coarseCountAllowed = shouldCountEmptyScan(opts?.now ?? Date.now(), engineMode);
    if (!emptyScan.incrementEmptyScan || !coarseCountAllowed) {
      console.log(
        `[ADR-452] emptyScan type=${emptyScan.type} session=${emptyScan.session} ` +
        `engineMode=${engineMode} increment=false reason=${emptyScan.reason}`,
      );
      return;
    }

    // ADR-0237 / ADR-0515: volumeClock 매수 차단 구간 (시초가 09:00~09:29 /
    // 점심 12:00~12:59 (ADR-0192 정합) / 마감 동시호가 15:21~15:30) 의 빈 스캔은
    // preflight 가 의도적으로 abort 한 것이므로 정상 동작.
    // consecutiveEmptyScans 증가 + 경고 모두 차단.
    //   legacy(TRADE_WINDOW_LEGACY_HOURS=true): 점심 11:31~12:59 (ADR-0237).
    //
    // 결함 사유: 기존 코드는 isBuyableKstWindow (09:30~12:00 + 13:00~15:30, ADR-0192)
    // 만 사용해 *볼륨클록 BLOCKED + 매수창 inside* 영역에서 false positive 경고
    // ("Gate 임계치 점검 필요") 발생. 사용자 5/6 11:43 보고 — 점심 차단 빈 스캔 →
    // 잘못된 임계 조정 권유.
    //
    // checkVolumeClockWindow.allowEntry=false 시 즉시 return — 카운터 보존 (BLOCKED
    // 종료 후 매수창 재개 시 이전 누적 그대로 평가).
    const volumeClock = checkVolumeClockWindow(coerceRecordScanNow(opts?.now));
    if (!volumeClock.allowEntry) {
      return;
    }

    consecutiveEmptyScans++;
    // ── 포스트모템 자가판별: 3회 누적마다 "기능 vs 버그" 판정 ─────────────
    // 단순 백오프 확대보다 먼저 돌아서, 레짐이 정당히 거부한 것인지
    // 게이트가 병리적으로 닫힌 것인지를 엔진이 스스로 결론낸다.
    const postmortem = notifyEmptyScan();
    if (postmortem && postmortem.verdict === 'PATHOLOGICAL_BLOCK' && isBuyableKstWindow()) {
      // ADR-0417 — 다중 권고 액션 표시 (CHECK_DATA_SOURCE / PATCH_EVALUATOR / REVIEW_GATE_THRESHOLD).
      // 단일 `recommendedAction` 은 후방호환 alias (배열 첫 element).
      sendTelegramAlert(
        `🔬 <b>[빈스캔 포스트모템] PATHOLOGICAL_BLOCK</b>\n` +
        `레짐: ${postmortem.regime} | 원인: ${postmortem.dominantCause}\n` +
        `Gate 실패율: ${(postmortem.metrics.gateFailRatio * 100).toFixed(1)}% ` +
        `(${postmortem.metrics.gateFail}/${postmortem.metrics.gateReached})\n` +
        // ADR-0417 — 분리 분모 비율 보고 (unavailable + error 제외 trueFailRate).
        `📊 합산: trueFail=${(postmortem.metrics.trueFailRate * 100).toFixed(1)}% / ` +
        `unavailable=${(postmortem.metrics.unavailableRate * 100).toFixed(1)}% / ` +
        `error=${(postmortem.metrics.errorRate * 100).toFixed(1)}%\n` +
        (postmortem.topBlockerCondition
          ? `최대 병목: ${postmortem.topBlockerCondition} ` +
            `(legacy ${(postmortem.topBlockerFailRate * 100).toFixed(1)}%)\n`
          : '') +
        `권고: ${postmortem.recommendedActions.join(' + ')}\n` +
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
        logger.debug(`${msg} (legacy SELL_ONLY ignored by rollback; session observation only)`);
      } else {
        emitDiagnosticWarn({ code: 'P2_SCHEDULER_DIAGNOSTIC_DEGRADED', message: 'Adaptive scheduler observed consecutive empty scans in buyable window.', dedupKey: 'p2:scheduler:adaptive-empty-scans', details: { consecutiveEmptyScans, multiplier } });
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
  lastScanAt               = 0;
  lastVkospikSpikeAt       = 0;
  consecutiveEmptyScans    = 0;
  immediateRescanRequested = false;
  lastLunchBlockSeenAt     = 0;
  lastR6ConfirmationScanKey = null;
  lastBiasLabel             = null;
}
