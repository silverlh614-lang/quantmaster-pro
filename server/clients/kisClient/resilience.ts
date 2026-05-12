/**
 * @responsibility KIS 회로 차단기 + ADR-0014 jitter 백오프 + __testOnly 진입점
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 회복탄력성 격리.
 * PR-21 (404 완화 하드/소프트 분리) + PR-24 (24h 영속 블랙리스트) + PR-34 (ADR-0014 retry safety).
 */

import { sendTelegramAlert, escapeHtml } from '../../alerts/telegramClient.js';
import {
  isEndpointBlacklisted as _isBlacklisted,
  recordEndpoint404 as _recordBlacklist404,
  resetEndpoint404Counter as _resetBlacklistCounter,
  resetKisEndpointBlacklist as _resetBlacklistAll,
} from '../../persistence/kisEndpointBlacklistRepo.js';

// ─── HTTP 헬퍼 — 재시도/sleep 공용 ──────────────────────────────────────────

export const _kisSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ADR-0014 — 5xx exponential backoff + 50% jitter.
 * - jitter 활성: retriesLeft=3 → 500~1500ms, 2 → 1000~3000ms, 1 → 2000~6000ms
 * - jitter 비활성 (KIS_RETRY_JITTER_DISABLED=true): 1000/2000/4000ms 고정 (회귀 비교용)
 */
export const _kisBackoffDelayMs = (retriesLeft: number): number => {
  const base = Math.pow(2, 3 - retriesLeft) * 1000;
  if (process.env.KIS_RETRY_JITTER_DISABLED === 'true') return base;
  return Math.floor(base * 0.5 + Math.random() * base);
};

/**
 * ADR-0014 — 429 rate-limit 대기 + 0~500ms jitter.
 * 동시 호출이 KIS 게이트웨이 제한에 동시에 걸리면 동기화된 1초 대기 → 동시 재시도 폭주.
 * Jitter 로 재시도 시점을 분산.
 */
export const _kis429DelayMs = (): number => {
  if (process.env.KIS_RETRY_JITTER_DISABLED === 'true') return 1000;
  return 1000 + Math.floor(Math.random() * 500);
};

/**
 * ADR-0014 — 재시도 자체를 무력화하는 긴급 스위치.
 * KIS 자체 장애로 인한 재시도 폭주를 즉시 차단해야 할 때 사용.
 */
export const _isKisRetryEnabled = (): boolean => process.env.KIS_RETRY_DISABLED !== 'true';

// ─── 회로 차단기 (Circuit Breaker) ──────────────────────────────────────────
// KIS 서버가 특정 trId(예: TTTC8434R 잔고조회)에 대해 지속적으로 5xx를 반환할 때,
// 재시도 루프가 매 호출마다 최대 7초(1+2+4s)를 소비하고 rate-limiter 큐에 적체되어
// Railway 메모리/타임아웃 한도를 초과하고 SIGTERM을 유발하는 문제를 차단한다.
//
// 동작 (PR-21: 404 완화):
//   - trId별로 연속 실패 카운터 2개: 하드(5xx/403) + 소프트(404) 분리 관리.
//   - 하드 — CIRCUIT_THRESHOLD_HARD(3회) → CIRCUIT_COOLDOWN_HARD_MS(10분) 차단.
//   - 소프트 — CIRCUIT_THRESHOLD_SOFT(10회) → CIRCUIT_COOLDOWN_SOFT_MS(2분) 차단.
//   - KIS_LENIENT_404=true 이면 404 은 경고만 — 회로 절대 안 닫음.
//   - 개방 상태에서는 fetch 호출 자체를 건너뛰고 즉시 null 반환.
//   - 성공 응답(2xx) 시 두 카운터 모두 리셋 + 회로 복구.
//
// 404 완화 근거: KIS 실계좌 데이터(realDataKisGet) 에서 특정 trId 의 404 는
// 엔드포인트 영구 불일치뿐 아니라 일시 장애·종목 일시 미지원에서도 발생한다.
// 3회만 실패해도 10분 차단하던 기존 정책은 정상 조회까지 함께 죽였다.

const CIRCUIT_THRESHOLD_HARD = 3;         // 5xx, 403 — 자연 복구 어려움
const CIRCUIT_COOLDOWN_HARD_MS = 10 * 60 * 1000;
const CIRCUIT_THRESHOLD_SOFT = 10;        // 404 — 종종 일시적, 관대 정책
const CIRCUIT_COOLDOWN_SOFT_MS = 2 * 60 * 1000;
const CIRCUIT_RECOVERY_LOG_RATE_LIMIT_MS = 5 * 60 * 1000;

const _circuitRecoveryLogAt = new Map<string, number>();

function _lenient404(): boolean {
  return (process.env.KIS_LENIENT_404 ?? 'false').toLowerCase() === 'true';
}

interface CircuitState {
  /** 5xx/403 연속 실패 — 하드 실패 카운터 */
  hardFailures: number;
  /** 404 연속 실패 — 소프트 실패 카운터 */
  softFailures: number;
  /** 차단 만료 시각 (epoch ms). 0 = 차단 안 됨. */
  openUntil: number;
  /** 마지막 차단이 어느 경로로 왔는지 (로그용) */
  lastBlockedBy?: 'HARD' | 'SOFT';
}

const _circuitByTrId = new Map<string, CircuitState>();

function _getCircuit(trId: string): CircuitState {
  let state = _circuitByTrId.get(trId);
  if (!state) {
    state = { hardFailures: 0, softFailures: 0, openUntil: 0 };
    _circuitByTrId.set(trId, state);
  }
  return state;
}

/** 회로가 열려 있으면 true — 호출을 건너뛰어야 함 */
export function _isCircuitOpen(trId: string): boolean {
  // ADR-0010: 영속 블랙리스트가 회로보다 우선. 24h 차단 윈도우 동안 즉시 true.
  if (_isBlacklisted(trId)) return true;
  const state = _circuitByTrId.get(trId);
  if (!state) return false;
  if (Date.now() < state.openUntil) return true;
  // 쿨다운 만료 — 반열림 상태로 전환(카운터는 유지하고 한 번 시도)
  if (state.openUntil > 0 && Date.now() >= state.openUntil) {
    state.openUntil = 0;
  }
  return false;
}

/**
 * 실패 기록. status 값에 따라 하드(5xx/403) 또는 소프트(404) 카운터를 증가시킨다.
 * 400/429 등은 호출자 측 파라미터·레이트 이슈라 회로 대상에서 제외한다.
 */
export function _recordCircuitFailure(trId: string, status: number): void {
  const state = _getCircuit(trId);

  if (status === 404) {
    if (_lenient404()) {
      console.warn(`[KIS] ⚠️ 404 (${trId}) — KIS_LENIENT_404 모드: 회로 비활성`);
      return;
    }
    state.softFailures += 1;
    // ADR-0010: 영속 블랙리스트 카운터도 함께 누적 — 30분 윈도우/10회 누적 시 24h 차단.
    _recordBlacklist404(trId);
    if (state.softFailures >= CIRCUIT_THRESHOLD_SOFT) {
      state.openUntil = Date.now() + CIRCUIT_COOLDOWN_SOFT_MS;
      state.lastBlockedBy = 'SOFT';
      console.warn(
        `[KIS] 🟡 소프트 회로 차단 — ${trId} 404 ${state.softFailures}회 연속, ` +
        `${CIRCUIT_COOLDOWN_SOFT_MS / 60000}분간 호출 차단 (엔드포인트 일시 불가)`
      );
    } else {
      const remaining = CIRCUIT_THRESHOLD_SOFT - state.softFailures;
      console.warn(`[KIS] 404 (${trId}) — 소프트 카운트 ${state.softFailures}/${CIRCUIT_THRESHOLD_SOFT} (잔여 ${remaining}회)`);
    }
    return;
  }

  // 5xx / 403 — 하드 실패
  state.hardFailures += 1;
  if (state.hardFailures >= CIRCUIT_THRESHOLD_HARD) {
    state.openUntil = Date.now() + CIRCUIT_COOLDOWN_HARD_MS;
    state.lastBlockedBy = 'HARD';
    console.warn(
      `[KIS] 🚨 회로 차단 — ${trId} ${state.hardFailures}회 연속 ${status} 실패, ` +
      `${CIRCUIT_COOLDOWN_HARD_MS / 60000}분간 호출 차단`
    );
  }
}

function shouldEmitCircuitRecoveryLog(trId: string, now: number): boolean {
  const last = _circuitRecoveryLogAt.get(trId) ?? 0;
  if (now - last < CIRCUIT_RECOVERY_LOG_RATE_LIMIT_MS) return false;
  _circuitRecoveryLogAt.set(trId, now);
  return true;
}

export function _recordCircuitSuccess(trId: string): void {
  // ADR-0010: 성공 시 영속 블랙리스트의 윈도우 카운터도 리셋(24h 차단 entry 는 만료 대기).
  _resetBlacklistCounter(trId);
  const state = _circuitByTrId.get(trId);
  if (!state) return;
  const hadFailure = state.hardFailures > 0 || state.softFailures > 0 || state.openUntil > 0;
  if (hadFailure) {
    const now = Date.now();
    const previousHard = state.hardFailures;
    const previousSoft = state.softFailures;
    const wasOpen = state.openUntil > 0;
    const minorRecovery = previousHard <= 1 && previousSoft === 0 && !wasOpen;
    if (shouldEmitCircuitRecoveryLog(trId, now)) {
      const event = {
        type: 'CIRCUIT_RECOVERY' as const,
        trId,
        previousHard,
        previousSoft,
        wasOpen,
        logClass: minorRecovery ? 'TELEMETRY' as const : 'RECOVERY' as const,
      };
      const message = minorRecovery
        ? '[KIS] circuit recovery minor'
        : '[KIS] circuit recovery';
      if (minorRecovery) console.debug(message, event);
      else console.info(message, event);
    }
  }
  state.hardFailures = 0;
  state.softFailures = 0;
  state.openUntil = 0;
  state.lastBlockedBy = undefined;
}

// ─── 테스트 전용 export (PR-21) ──────────────────────────────────────────────
// 런타임 코드 호출 대상이 아님 — 단위 테스트에서 회로 상태를 직접 조작한다.
export const __testOnly = {
  recordFailure: (trId: string, status: number) => _recordCircuitFailure(trId, status),
  recordSuccess: (trId: string) => _recordCircuitSuccess(trId),
  isOpen: (trId: string) => _isCircuitOpen(trId),
  // ADR-0014 재시도 안전성 테스트 — jitter 동작·재시도 스위치 검증용.
  backoffDelayMs: (retriesLeft: number) => _kisBackoffDelayMs(retriesLeft),
  rateLimit429DelayMs: () => _kis429DelayMs(),
  isRetryEnabled: () => _isKisRetryEnabled(),
  resetRecoveryLogRateLimit: () => _circuitRecoveryLogAt.clear(),
};

/** 회로 차단기 상태 조회 (디버깅/모니터링용) */
export function getCircuitBreakerStats(): Array<{
  trId: string;
  /** 하드 실패 수 (5xx/403) */
  hardFailures: number;
  /** 소프트 실패 수 (404) */
  softFailures: number;
  /** 호환용 별칭 — hardFailures + softFailures 합. 레거시 UI 를 위해 유지. */
  consecutiveFailures: number;
  openFor: number;
  lastBlockedBy?: 'HARD' | 'SOFT';
}> {
  const now = Date.now();
  return Array.from(_circuitByTrId.entries()).map(([trId, state]) => ({
    trId,
    hardFailures: state.hardFailures,
    softFailures: state.softFailures,
    consecutiveFailures: state.hardFailures + state.softFailures,
    openFor: Math.max(0, state.openUntil - now),
    lastBlockedBy: state.lastBlockedBy,
  }));
}

/**
 * 모든 KIS 회로 차단을 즉시 해제 — 운영자용.
 *
 * 배경: 저녁 추천 스캔 시간대(KST 16~22)에 KIS 잔고/랭킹 TR 이 5xx 를 누적해
 * 회로가 닫힌 채로 들어가면 10분 cooldown 동안 후보 종목 호출이 모두 null 로
 * 떨어진다. /reset 비상 정지 해제로는 회로가 풀리지 않으므로 별도 경로 필요.
 *
 * @returns 해제 전 열려 있던 회로 수
 */
export function resetKisCircuits(): number {
  let openCount = 0;
  const now = Date.now();
  for (const state of _circuitByTrId.values()) {
    if (state.openUntil > now) openCount++;
  }
  _circuitByTrId.clear();
  _circuitRecoveryLogAt.clear();
  // ADR-0010: 영속 블랙리스트도 함께 청소 (운영자 수동 복구).
  const blacklistCleared = _resetBlacklistAll();
  if (openCount > 0 || blacklistCleared > 0) {
    console.warn(
      `[KIS] 🔧 운영자 수동 회로 reset — 회로 ${openCount}개 + 블랙리스트 ${blacklistCleared}개 해제`
    );
  }
  return openCount;
}

/**
 * ADR-0014 — WRITE 5xx 실패 시 텔레그램 즉시 경보 (1회).
 *
 * 5xx 재시도를 차단했으므로 호출자가 실패를 즉시 인지해야 한다. 운영자는 KIS HTS 로
 * 실주문 상태를 직접 확인 후 수동 재실행 또는 /reconcile live 로 후속 조치.
 *
 * 텔레그램 송신 자체 실패는 무시 (재시도 폭주 방지).
 */
export async function _alertUnsafeWriteFailure(
  trId: string, apiPath: string, status: number,
): Promise<void> {
  const msg =
    `🚨 <b>[KIS WRITE 5xx — 재시도 차단]</b>\n` +
    `TR: <code>${escapeHtml(trId)}</code>\n` +
    `Path: <code>${escapeHtml(apiPath)}</code>\n` +
    `Status: ${status}\n\n` +
    `중복 주문 위험으로 자동 재시도 없음.\n` +
    `KIS HTS 로 실주문 상태 확인 후 필요 시 수동 재실행 또는 ` +
    `<code>/reconcile live</code> 점검.`;
  try { await sendTelegramAlert(msg); } catch { /* swallow */ }
}
