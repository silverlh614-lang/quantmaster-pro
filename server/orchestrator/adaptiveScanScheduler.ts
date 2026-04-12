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
 * │  11:30~13:00 : 10분 (점심 횡보 — 신호 거의 없음)                 │
 * │  13:00~14:30 :  5분 (오후 재개장)                                │
 * │  14:30~15:20 :  2분 (마감 전 급변)                               │
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
    (s) => s.status === 'PENDING' || s.status === 'ACTIVE',
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
  let baseInterval: number;
  let phase: string;

  if      (t < 930)  { baseInterval = 2;  phase = '시초가(급변)'; }
  else if (t < 1130) { baseInterval = 3;  phase = '오전 주도주'; }
  else if (t < 1300) { baseInterval = 10; phase = '점심 횡보';   }
  else if (t < 1430) { baseInterval = 5;  phase = '오후 재개장'; }
  else               { baseInterval = 2;  phase = '마감전(급변)'; }

  // ── 4. 레짐 배율 적용 ────────────────────────────────────────────────────
  const multiplier = REGIME_MULTIPLIER[regime] ?? 1.0;

  // ── 5. 포지션 조정: 포지션 많음 → +1분 (매도 모니터링 우선) ─────────────
  const positionAdj = activePositions >= maxPositions * 0.7 ? 1 : 0;

  const effectiveInterval = Math.max(1, Math.round(baseInterval * multiplier) + positionAdj);

  // ── 6. 인터벌 미충족 → skip ──────────────────────────────────────────────
  const elapsedMin = (now - lastScanAt) / 60_000;
  if (elapsedMin < effectiveInterval) {
    return {
      shouldScan:      false,
      intervalMinutes: effectiveInterval,
      reason: (
        `${phase} / ${regime}(×${multiplier})` +
        ` — ${elapsedMin.toFixed(1)}분 경과 (목표: ${effectiveInterval}분)`
      ),
      priority: 'SKIP',
    };
  }

  // ── 7. 스캔 실행 ─────────────────────────────────────────────────────────
  lastScanAt = now;
  return {
    shouldScan:      true,
    intervalMinutes: effectiveInterval,
    reason: (
      `${phase} | ${regime}(×${multiplier})` +
      ` | 포지션 ${activePositions}/${maxPositions}` +
      ` → ${effectiveInterval}분 간격`
    ),
    priority: 'FULL',
  };
}

/** 테스트·진단용: 모듈 상태 초기화 */
export function resetScanState(): void {
  lastScanAt         = 0;
  lastVkospikSpikeAt = 0;
}
