// @responsibility adaptiveScanScheduler 오케스트레이터 모듈
/**
 * adaptiveScanScheduler.ts — 적응형 스캔 빈도 결정기
 *
 * cron은 1분 간격으로 tick하지만, 실제 스캔 실행은 여기서 결정한다.
 * 4가지 변수로 유효 간격(effectiveInterval)을 산출한 뒤
 * 마지막 스캔 후 충분한 시간이 경과했을 때만 스캔을 허용한다.
 *
 * ┌─ 1. 시간대별 기본 간격 (ALWAYS-ON: 스캔 *빈도*만, 매수 차단 아님) ─────────┐
 * │  09:00~09:30 :  2분 (시초가 급변 — 매수 허용, 감점만)            │
 * │  09:30~11:30 :  3분 (오전 주도주 형성)                           │
 * │  11:30~13:00 : 10분 저빈도 관찰 (점심 — 매수 허용, volumeClock 감점만) │
 * │  13:00~14:30 :  5분 (오후 재개장)                                │
 * │  14:30~14:55 :  2분 (마감 전 급변)                               │
 * │  14:55~15:20 :  2분 (마감 동시호가 준비 — exitEngine 전용)       │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * 레짐 배율·회복 분기는 제거했다. 기존 시간대, 실측 변동성, 포지션, 빈스캔 주기는 유지한다.
 *
 * ┌─ 3. VKOSPI 급변 ─────────────────────────────────────────────────┐
 * │  당일 +5% 이상 급등 → 즉시 관측 실행 (30분 쿨다운)     │
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
import type { ShadowCandidateScanTrigger } from '../trading/marketStateResolver.js';
import { resetEmptyScanCounter } from './emptyScanPostmortem.js';
import { checkVolumeClockWindow } from '../trading/volumeClock.js';
import {
  classifyEmptyScan,
  shouldCountEmptyScan,
  type EngineModeForEmptyScan,
} from '../trading/signalScanner/emptyScanTaxonomy.js';
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
  // ADR-0552: 점심(12:00~13:00) 휴장 제거 — KRX 연속장. 09:30~15:00 단일 REGULAR.
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
  const convictionCap = Number(process.env.MAX_CONVICTION_POSITIONS ?? '10');
  const maxPositions = Math.max(0, Math.min(convictionCap, 4)); // 기존 fallback 한도 유지

  // ── 1. VKOSPI 급등 감지 → 즉시 관측 실행 ──────────────────────
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

  // ── 3. 시간대별 기본 간격 (ALWAYS-ON: 시간대는 스캔 빈도만 조정, 매매 차단 없음) ──
  //   시초가/점심/마감 구간도 매매는 허용한다. 빠른 변동/저거래 구간은 baseInterval(스캔 주기)
  //   로만 반영하고, 진입 가/감점은 volumeClock.scoreBonus 가 담당한다. 시간대 기반 SELL_ONLY 없음.
  let baseInterval: number;
  let phase: string;

  // ADR-0192 시간 구간(스캔 빈도 SSOT). ENV `TRADE_WINDOW_LEGACY_HOURS=true` 우회 시 기존 구간 복원.
  const useLegacy = process.env.TRADE_WINDOW_LEGACY_HOURS === 'true';
  if (useLegacy) {
    if      (t < 930)  { baseInterval = 2;  phase = '시초가(급변)'; }
    else if (t < 1130) { baseInterval = 3;  phase = '오전 주도주'; }
    else if (t < 1300) {
      baseInterval = 10; phase = '점심(저빈도 관찰)';
      lastLunchBlockSeenAt = now;
    }
    else if (t < 1430) { baseInterval = 5;  phase = '오후 재개장'; }
    else if (t < 1500) { baseInterval = 2;  phase = '마감전(급변)'; }
    else               { baseInterval = 2;  phase = '마감(관찰)'; }
  } else {
    if      (t < 930)  { baseInterval = 5;  phase = '시초가(변동성 회피)'; }
    else if (t < 1200) { baseInterval = 3;  phase = '오전 주도주'; }
    else if (t < 1300) {
      baseInterval = 10; phase = '점심(저빈도 관찰)';
      lastLunchBlockSeenAt = now; // 점심 구간 통과 중 — 오후 재개 1회 강제 스캔 감지용
    }
    else if (t < 1500) { baseInterval = 3;  phase = '오후 재개장'; }
    else               { baseInterval = 2;  phase = '마감(관찰)'; }
  }

  // ── 5. 포지션 조정: 양방향 보상 ───────────────────────────────────────────
  //   포지션 ≥ maxPositions × 0.7 → +1분 (매도 모니터링 우선)
  //   포지션 ≤ maxPositions × 0.5 → -1분 (슬롯 여유 구간 빠른 재스캔)
  //   maxPositions=0 이면 비교를 건너뜀.
  let positionAdj = 0;
  if (maxPositions > 0) {
    if (activePositions >= maxPositions * 0.7)      positionAdj = 1;
    else if (activePositions <= maxPositions * 0.5) positionAdj = -1;
  }

  const effectiveInterval = Math.max(1, baseInterval + positionAdj);

  // ── 6. 피드백 루프: 빈 스캔 연속 시 간격 확대 ───────────────────────────
  //   5회 연속 빈 스캔 → 다음 사이클 1회 스킵 (Yahoo Finance 레이트 리밋 절약)
  //   연속 빈 스캔 누적에 따라 점진적 간격 확대 (최대 ×3)
  const emptyBackoff = consecutiveEmptyScans >= EMPTY_SCAN_BACKOFF_THRESHOLD
    ? Math.min(EMPTY_SCAN_MAX_MULTIPLIER, 1 + Math.floor(consecutiveEmptyScans / EMPTY_SCAN_BACKOFF_THRESHOLD))
    : 1;

  const finalInterval = effectiveInterval * emptyBackoff;

  // ── 6-b. 점심 저빈도 구간 직후 1회 강제 스캔 ─────────────────────────────
  // 점심(12:00~13:00) 저빈도 스캔 직후 13:00 재개 시, 기본 interval 을 기다리면 슬롯 회복·오후
  // 주도주 추격이 지연된다. 점심 구간 통과 기록(lastLunchBlockSeenAt)이 있고 t >= 1300 이면 1회 force scan.
  if (t >= 1300 && t < 1310 && lastLunchBlockSeenAt > 0) {
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
        `${phase}` +
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
      sellOnlyAlreadyActive: false, // ALWAYS-ON: 시간대 기반 SELL_ONLY 없음.
    });
    // 핵심 — REGULAR session + emptyScanStreak 만으로 SELL_ONLY 강제 금지.
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
      `${phase}` +
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
 * 매수 가능 시간대(KST) 진단 판정 — volumeClock ALWAYS-ON SSOT 정합 (실주문 게이트 아님).
 *
 * volumeClock SSOT(09:00~15:20 전부 allowEntry=true)에 맞춰 시초가/점심도 buyable 로 본다.
 * 시초가/점심은 차단이 아니라 점수 감점 구간이며, 비-buyable 은 마감 동시호가 준비(15:20~)·장외뿐.
 *   - 09:00~09:29: 시초가 — 변동성 감점 (차단 아님)
 *   - 점심 12:00~13:00: 매수 허용 (ADR-0552 — KRX 점심 휴장 폐지 반영, 잔재 제거)
 *   - 15:20 부터: 마감 동시호가 준비 — 진단상 비-buyable (volumeClock 하드 차단 15:21~15:30 정합)
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
  // volumeClock ALWAYS-ON 정합: 09:00~15:20 연속 매수 허용 (시초가/점심 포함, 감점만).
  return t >= 900 && t < 1520;
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

    // ADR-0237 / ADR-0515: volumeClock ALWAYS-ON 상 유일한 하드 차단(마감 동시호가 15:21~15:30,
    // legacy=true 시 09:00~09:29 / 12:00~12:59 추가) 구간의 빈 스캔은 preflight 가 의도적으로
    // abort 한 것이므로 정상 동작. consecutiveEmptyScans 증가 + 경고 모두 차단.
    //   legacy(VOLUME_CLOCK_LEGACY_HARD_BLOCK=true): 점심·시초가 추가 차단.
    //
    // 게이팅 단일 진실은 checkVolumeClockWindow.allowEntry 다 (isBuyableKstWindow 는 진단 윈도일 뿐).
    // allowEntry=false 시 즉시 return — 카운터 보존 (차단 종료 후 매수창 재개 시 이전 누적 그대로 평가).
    // 시초가/점심은 ALWAYS-ON 상 allowEntry=true(감점만)이므로 여기서 차단하지 않는다.
    const volumeClock = checkVolumeClockWindow(coerceRecordScanNow(opts?.now));
    if (!volumeClock.allowEntry) {
      return;
    }

    consecutiveEmptyScans++;
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
}
