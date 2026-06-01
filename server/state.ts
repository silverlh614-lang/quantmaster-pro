// @responsibility state 서버 모듈
// server/state.ts — 공유 상태 모듈
// 서버사이드 비상 정지 플래그 & 일일 손실률을 단일 모듈에서 관리
import {
  loadPersistentExecutionMode,
  savePersistentExecutionMode,
  clearPersistentExecutionMode as clearPersistentOverride,
  __resetPersistentExecutionModeForTests,
  type ExecutionModeOverrideRecord,
} from './persistence/executionModeOverrideRepo.js';
import {
  PERSISTENT_MACRO_ENTRY_OVERRIDE_TARGETS,
  loadPersistentMacroEntryOverride,
  savePersistentMacroEntryOverride,
  clearPersistentMacroEntryOverride,
  __resetPersistentMacroEntryOverrideForTests,
  type PersistentMacroEntryOverrideRecord,
  type PersistentMacroEntryOverrideTarget,
} from './persistence/macroEntryOverrideRepo.js';
let EMERGENCY_STOP = false;
let EMERGENCY_STOP_REASON: string | null = null;
let EMERGENCY_STOP_AT: string | null = null;
let DAILY_LOSS_PCT = 0;

export const getEmergencyStop = () => EMERGENCY_STOP;
// P1: emergencyStop 사유/발동시각 추적 — 헬스체크·진단 가시화(false-positive 발동 시 운영자 즉시 원인 파악).
// boolean 동작은 byte-equivalent(EMERGENCY_STOP 불변), reason/at 은 관측 전용 부가 필드. at 은 false→true 전이에만 갱신.
export const setEmergencyStop = (v: boolean, reason?: string) => {
  if (v && !EMERGENCY_STOP) EMERGENCY_STOP_AT = new Date().toISOString();
  EMERGENCY_STOP = v;
  if (v) {
    if (reason !== undefined) EMERGENCY_STOP_REASON = reason;
  } else {
    EMERGENCY_STOP_REASON = null;
    EMERGENCY_STOP_AT = null;
  }
};
export const getEmergencyStopInfo = (): { active: boolean; reason: string | null; at: string | null } =>
  ({ active: EMERGENCY_STOP, reason: EMERGENCY_STOP_REASON, at: EMERGENCY_STOP_AT });
export const getDailyLossPct = () => DAILY_LOSS_PCT;
export const setDailyLoss = (pct: number) => { DAILY_LOSS_PCT = pct; };

// autoTradeEngine.ts에서 import하는 기존 함수명 호환 유지
export const isEmergencyStopped = () => EMERGENCY_STOP;

// ─── 거시-섹터-종목 동기화 루프: VIX 급등 보수 모드 ──────────────────────────
let VIX_CONSERVATIVE_MODE = false;
/** VIX 장중 급등(+3%) 감지 시 활성: positionPct −20%, 신규 진입 일시 중단 */
export const getVixConservativeMode = () => VIX_CONSERVATIVE_MODE;
export const setVixConservativeMode = (v: boolean) => { VIX_CONSERVATIVE_MODE = v; };

// ─── 데이터 정합성 게이팅 — Reconciliation 불일치 초과 시 신규 매수 차단 ───────
let DATA_INTEGRITY_BLOCKED = false;
/** Reconciliation 불일치 건수 > 임계치 시 true — 신뢰할 수 없는 상태에서 신규 매수 금지 */
export const getDataIntegrityBlocked = () => DATA_INTEGRITY_BLOCKED;
export const setDataIntegrityBlocked = (v: boolean) => { DATA_INTEGRITY_BLOCKED = v; };

// ─── 소프트 일시정지 — 텔레그램 /pause 명령으로 설정, /resume 으로 해제 ─────────
// 비상정지(hard stop)와 달리 미체결 주문은 취소하지 않고 신규 tick만 건너뜀.
let AUTO_TRADE_PAUSED = false;
export const getAutoTradePaused = () => AUTO_TRADE_PAUSED;
export const setAutoTradePaused = (v: boolean) => { AUTO_TRADE_PAUSED = v; };

// ─── UI 수동 비상 액션 플래그 ───────────────────────────────────────────────
// UI 관제 패널(EmergencyActionsPanel)에서 직접 토글하는 2개 플래그.
// MANUAL_BLOCK_NEW_BUY  : 신규 매수만 차단 (기존 포지션은 계속 관리)
// MANUAL_MANAGE_ONLY    : 보유 포지션만 관리 (청산/트레일링은 계속, 신규 진입 금지)
// 비상정지(hard stop) 와 AUTO_TRADE_PAUSED(소프트) 와는 독립적으로 평가된다.
let MANUAL_BLOCK_NEW_BUY = false;
let MANUAL_MANAGE_ONLY = false;
export const getManualBlockNewBuy = () => MANUAL_BLOCK_NEW_BUY;
export const setManualBlockNewBuy = (v: boolean) => { MANUAL_BLOCK_NEW_BUY = v; };
export const getManualManageOnly = () => MANUAL_MANAGE_ONLY;
export const setManualManageOnly = (v: boolean) => { MANUAL_MANAGE_ONLY = v; };

// Operator-scoped macro entry override. This only bypasses macro no-new-entry
// gates (R6/VIX/FOMC). It is persisted so Telegram and scheduler processes share it on Railway.
export const MACRO_ENTRY_OVERRIDE_TARGETS = PERSISTENT_MACRO_ENTRY_OVERRIDE_TARGETS;

export type MacroEntryOverrideTarget = PersistentMacroEntryOverrideTarget;

export type MacroEntryOverrideState = PersistentMacroEntryOverrideRecord;

export interface SetMacroEntryOverrideInput {
  targets?: MacroEntryOverrideTarget[];
  reason?: string;
  setBy?: string;
  ttlMinutes?: number;
  now?: Date;
  kellyFloor?: number;
  maxPositionsFloor?: number;
}

const DEFAULT_MACRO_ENTRY_OVERRIDE_TTL_MINUTES = 60;
const DEFAULT_MACRO_ENTRY_OVERRIDE_MAX_TTL_MINUTES = 240;
const DEFAULT_MACRO_ENTRY_OVERRIDE_KELLY_FLOOR = 0.3;
const DEFAULT_MACRO_ENTRY_OVERRIDE_MAX_POSITIONS_FLOOR = 1;

let MACRO_ENTRY_OVERRIDE: MacroEntryOverrideState | null = null;

function clampMacroOverrideTtl(minutes: number | undefined): number {
  const configuredMax = Number(process.env.MACRO_ENTRY_OVERRIDE_MAX_MINUTES ?? DEFAULT_MACRO_ENTRY_OVERRIDE_MAX_TTL_MINUTES);
  const maxMinutes = Number.isFinite(configuredMax) && configuredMax > 0
    ? configuredMax
    : DEFAULT_MACRO_ENTRY_OVERRIDE_MAX_TTL_MINUTES;
  const raw = Number.isFinite(minutes) && minutes !== undefined
    ? minutes
    : DEFAULT_MACRO_ENTRY_OVERRIDE_TTL_MINUTES;
  return Math.max(1, Math.min(maxMinutes, Math.floor(raw)));
}

function normalizeMacroOverrideTargets(
  targets: MacroEntryOverrideTarget[] | undefined,
): MacroEntryOverrideTarget[] {
  const allowed = new Set<MacroEntryOverrideTarget>(MACRO_ENTRY_OVERRIDE_TARGETS);
  const normalized = [...new Set((targets ?? MACRO_ENTRY_OVERRIDE_TARGETS).filter((target) => allowed.has(target)))];
  return normalized.length > 0 ? normalized : [...MACRO_ENTRY_OVERRIDE_TARGETS];
}

function cloneMacroEntryOverrideState(state: MacroEntryOverrideState): MacroEntryOverrideState {
  return {
    ...state,
    targets: [...state.targets],
  };
}

function loadStoredMacroEntryOverride(): MacroEntryOverrideState | null {
  try {
    return loadPersistentMacroEntryOverride();
  } catch {
    return null;
  }
}

function persistMacroEntryOverride(state: MacroEntryOverrideState): void {
  try {
    savePersistentMacroEntryOverride(state);
  } catch (error) {
    console.warn('[state] macro entry override persist failed:', error);
  }
}

function clearStoredMacroEntryOverride(): void {
  try {
    clearPersistentMacroEntryOverride();
  } catch {
    // idempotent
  }
}

function isMacroEntryOverrideExpired(state: MacroEntryOverrideState, now: Date): boolean {
  return new Date(state.expiresAt).getTime() <= now.getTime();
}

export function setMacroEntryOverride(input: SetMacroEntryOverrideInput = {}): MacroEntryOverrideState {
  const now = input.now ?? new Date();
  const ttlMinutes = clampMacroOverrideTtl(input.ttlMinutes);
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
  const kellyFloor = Number.isFinite(input.kellyFloor) && input.kellyFloor !== undefined
    ? Math.max(0.05, Math.min(1.0, input.kellyFloor))
    : DEFAULT_MACRO_ENTRY_OVERRIDE_KELLY_FLOOR;
  const maxPositionsFloor = Number.isFinite(input.maxPositionsFloor) && input.maxPositionsFloor !== undefined
    ? Math.max(1, Math.min(3, Math.floor(input.maxPositionsFloor)))
    : DEFAULT_MACRO_ENTRY_OVERRIDE_MAX_POSITIONS_FLOOR;

  MACRO_ENTRY_OVERRIDE = {
    active: true,
    targets: normalizeMacroOverrideTargets(input.targets),
    reason: input.reason?.trim() || 'operator macro entry override',
    setBy: input.setBy?.trim() || 'operator',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ttlMinutes,
    kellyFloor,
    maxPositionsFloor,
  };

  persistMacroEntryOverride(MACRO_ENTRY_OVERRIDE);
  return cloneMacroEntryOverrideState(MACRO_ENTRY_OVERRIDE);
}

export function clearMacroEntryOverride(): MacroEntryOverrideState | null {
  const previous =
    MACRO_ENTRY_OVERRIDE
      ? cloneMacroEntryOverrideState(MACRO_ENTRY_OVERRIDE)
      : loadStoredMacroEntryOverride();
  MACRO_ENTRY_OVERRIDE = null;
  clearStoredMacroEntryOverride();
  return previous;
}

export function getMacroEntryOverrideState(now: Date = new Date()): MacroEntryOverrideState | null {
  const stored = loadStoredMacroEntryOverride();
  const current = stored ?? MACRO_ENTRY_OVERRIDE;
  if (!current) return null;
  if (isMacroEntryOverrideExpired(current, now)) {
    MACRO_ENTRY_OVERRIDE = null;
    clearStoredMacroEntryOverride();
    return null;
  }
  MACRO_ENTRY_OVERRIDE = cloneMacroEntryOverrideState(current);
  return cloneMacroEntryOverrideState(MACRO_ENTRY_OVERRIDE);
}

export function isMacroEntryOverrideActive(
  target: MacroEntryOverrideTarget,
  now: Date = new Date(),
): boolean {
  const state = getMacroEntryOverrideState(now);
  return state?.targets.includes(target) === true;
}

export function __resetMacroEntryOverrideForTests(): void {
  MACRO_ENTRY_OVERRIDE = null;
  __resetPersistentMacroEntryOverrideForTests();
}

// ─── Phase 2차 C7: Pre-Market Smoke Test Gate ──────────────────────────────────
// 08:45 KST 스모크 테스트 실패 시 LIVE 주문 경로만 차단한다. Shadow 학습 루프는
// 계속 돌아감 — 버그가 LIVE 주문에 도달하기 전에 선제적으로 차단하는 방어선.
// 다음 거래일 08:45 스모크 테스트가 성공하면 자동 해제된다.
let SMOKE_TEST_LIVE_BLOCKED = false;
let SMOKE_TEST_LAST_FAILED_REASON: string | null = null;
export const getSmokeTestLiveBlocked = () => SMOKE_TEST_LIVE_BLOCKED;
export const setSmokeTestLiveBlocked = (v: boolean, reason?: string): void => {
  SMOKE_TEST_LIVE_BLOCKED = v;
  SMOKE_TEST_LAST_FAILED_REASON = v ? reason ?? 'unknown' : null;
};
export const getSmokeTestLastFailedReason = () => SMOKE_TEST_LAST_FAILED_REASON;

// ─── 엔진 하트비트 — Railway 좀비 프로세스 감지용 ──────────────────────────────
// 스케줄러 tick 마다 갱신. UI는 (Date.now() - lastHeartbeatTs) > 90_000 일 때
// "엔진 응답 없음" 적색 배너를 노출한다. 14분 self-ping 은 프로세스 생존만
// 확인하지만, heartbeat 는 cron 루프가 실제로 돌고 있는지 증명한다.
let LAST_HEARTBEAT_TS = 0;
let LAST_HEARTBEAT_SOURCE = 'init';
export const getLastHeartbeat = () => LAST_HEARTBEAT_TS;
export const getLastHeartbeatSource = () => LAST_HEARTBEAT_SOURCE;
/**
 * @param source 트리거 소스 ('orchestrator' | 'oco-confirm' | 'oco-poll' | ...) — 디버깅용
 */
export const touchHeartbeat = (source: string) => {
  LAST_HEARTBEAT_TS = Date.now();
  LAST_HEARTBEAT_SOURCE = source;
};

// ─── 런타임 운영 모드 — Kill Switch Cascade 로 강등 가능 ─────────────────────────
// 기본값은 env 의 AUTO_TRADE_MODE. 강등 발생 시 메모리 상에서 SHADOW 로 덮어쓴다.
// 재시작 시 env 값으로 복원 — 스냅샷(Phase 5) 도입 시 영속화 예정.
type TradingMode = 'LIVE' | 'PAPER' | 'SHADOW' | 'MANUAL';
let RUNTIME_MODE: TradingMode | null = null;

function readEnvMode(): TradingMode {
  const raw = (process.env.AUTO_TRADE_MODE ?? 'SHADOW').toUpperCase();
  if (raw === 'LIVE') return 'LIVE';
  if (raw === 'PAPER' || raw === 'VTS') return 'PAPER';
  if (raw === 'SHADOW') return 'SHADOW';
  return 'MANUAL';
}

// ─── ADR-0393 P1 — ExecutionMode 3-state SSOT ───────────────────────────────
//
// 사용자 명시 메타 모델: "방향은 OFF/PAPER/LIVE + shadowLedger always-on".
// SHADOW 는 *실행 모드* 가 아니라 *학습 layer* — 모든 모드에서 always-on.
// MANUAL 은 *수동 가드 플래그* (MANUAL_BLOCK_NEW_BUY 등) 와 별개 개념.
//
// 매핑 정책:
//   EXECUTION_MODE 명시 → 그대로 사용 (LIVE/PAPER/OFF)
//   EXECUTION_MODE 미설정 → AUTO_TRADE_MODE 호환 매핑:
//     - LIVE       → LIVE
//     - PAPER/VTS  → PAPER
//     - SHADOW/MANUAL/그 외 → OFF
//
// shadowLedger always-on — 모든 모드에서 매수 평가 결과 영속 (ADR-0393 §P1-2).
// 본 P1 Stage A 는 *타입 + SSOT 진입점만* 도입, 매수 흐름 wiring 은 별도 PR (P1-Wiring).

/**
 * 실행 모드 — OFF (영속 학습만) / PAPER (가상 체결) / LIVE (실주문).
 *
 * shadowLedger 는 모든 모드에서 작동 (ADR-0393 always-on 정책).
 * 신규 코드는 본 타입을 사용하며, legacy `TradingMode` 는 deprecated wrapper 로 호환 유지.
 */
export type ExecutionMode = 'OFF' | 'PAPER' | 'LIVE';

let RUNTIME_EXECUTION_MODE: ExecutionMode | null = null;

/**
 * @deprecated Use {@link getExecutionMode} instead.
 *
 * ADR-0393 P1 — `getTradingMode()` 는 4-state legacy wrapper.
 * ExecutionMode 3-state (OFF/PAPER/LIVE) + shadowLedger always-on 모델로 격상 중.
 * 신규 호출자는 `getExecutionMode()` 사용 의무. 기존 호출자는 점진 마이그레이션.
 *
 * 본 함수는 ExecutionMode → TradingMode 매핑 wrapper:
 *   - ExecutionMode 'LIVE'  → TradingMode 'LIVE'
 *   - ExecutionMode 'PAPER' → TradingMode 'PAPER'
 *   - ExecutionMode 'OFF'   → TradingMode 'SHADOW' (legacy SHADOW + MANUAL 통합)
 *
 * MANUAL 반환 케이스 사라짐 — 기존 readEnvMode 가 unrecognized env value fallback 으로
 * 'MANUAL' 반환했지만 호출자 0건 (audit 검증). ADR-0393 안전 invariant 정합.
 *
 * RUNTIME_MODE (legacy) 가 있으면 우선 — 기존 setTradingMode 호출 (engineSnapshotRepo /
 * killSwitch 의 SHADOW 강등) 동작 보존. 둘 다 미설정 시 ExecutionMode SSOT 로 derive.
 */
export const getTradingMode = (): TradingMode => {
  if (RUNTIME_MODE !== null) return RUNTIME_MODE;
  // ExecutionMode SSOT 에서 derive
  const exec = getExecutionMode();
  if (exec === 'LIVE') return 'LIVE';
  if (exec === 'PAPER') return 'PAPER';
  return 'SHADOW';
};

/**
 * @deprecated Use {@link setExecutionMode} instead.
 *
 * ADR-0393 P1 — RUNTIME_MODE (legacy) + RUNTIME_EXECUTION_MODE 동시 동기화.
 * 기존 호출자 (engineSnapshotRepo:99, killSwitch:152) 가 SHADOW 강등 시 ExecutionMode 도
 * OFF 로 자동 매핑. 신규 호출자는 setExecutionMode 직접 사용.
 *
 * 매핑:
 *   TradingMode 'LIVE'   → ExecutionMode 'LIVE'
 *   TradingMode 'PAPER'  → ExecutionMode 'PAPER'
 *   TradingMode 'SHADOW' → ExecutionMode 'OFF'
 *   TradingMode 'MANUAL' → ExecutionMode 'OFF' (legacy MANUAL 통합)
 */
export const setTradingMode = (mode: TradingMode): void => {
  RUNTIME_MODE = mode;
  // ExecutionMode 동기화 — ADR-0393 SSOT 일관성.
  if (mode === 'LIVE') RUNTIME_EXECUTION_MODE = 'LIVE';
  else if (mode === 'PAPER') RUNTIME_EXECUTION_MODE = 'PAPER';
  else RUNTIME_EXECUTION_MODE = 'OFF';
};

/**
 * ExecutionMode env 해석 SSOT.
 *
 * 우선순위:
 *   1. EXECUTION_MODE env (LIVE/PAPER/OFF, 대문자 무관) — 명시 시 그대로
 *   2. AUTO_TRADE_MODE env 호환 매핑 — legacy 4-state 와 호환
 */
export function readEnvExecutionMode(): ExecutionMode {
  const explicit = (process.env.EXECUTION_MODE ?? '').toUpperCase();
  if (explicit === 'LIVE') return 'LIVE';
  if (explicit === 'PAPER') return 'PAPER';
  if (explicit === 'OFF') return 'OFF';

  // 호환: AUTO_TRADE_MODE → ExecutionMode 매핑
  const legacy = (process.env.AUTO_TRADE_MODE ?? 'SHADOW').toUpperCase();
  if (legacy === 'LIVE') return 'LIVE';
  if (legacy === 'PAPER' || legacy === 'VTS') return 'PAPER';
  // SHADOW + MANUAL + 그 외 unrecognized → OFF (실행 안 함, 학습만)
  return 'OFF';
}

/**
 * 실행 모드 조회 — ADR-0395 P2 우선순위 체인.
 *
 * 우선순위:
 *   1. RUNTIME_EXECUTION_MODE (메모리 — Kill Switch 즉시 강등) — 휘발성, 재시작 시 사라짐
 *   2. 영속 override (data/execution_mode_override.json — 운영자 영속 강등) — Railway 재배포 후에도 유지
 *   3. env (EXECUTION_MODE / AUTO_TRADE_MODE) — 운영 default
 *
 * 본 함수가 ADR-0393/0395 SSOT — getTradingMode() 는 deprecated wrapper.
 *
 * 영속 override read 는 try/catch 격리 — 디스크 read 결함이 매매 흐름 차단 안 함.
 * `EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED=true` 환경변수 시 영속 layer skip
 * (ADR-0395 회귀 위험 격리, default OFF).
 */
export const getExecutionMode = (): ExecutionMode => {
  if (RUNTIME_EXECUTION_MODE !== null) return RUNTIME_EXECUTION_MODE;
  if (process.env.EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED !== 'true') {
    try {
      const persisted = loadPersistentExecutionMode();
      if (persisted) return persisted.mode;
    } catch {
      // 디스크 read 결함 fallback — env 로 정상 동작 유지.
    }
  }
  return readEnvExecutionMode();
};

/**
 * RUNTIME override 설정 — Kill switch / 운영자 일회성 강등 시 호출.
 *
 * 본 함수는 *메모리만* 변경 — 재시작 시 사라짐.
 * 영속 강등은 `setPersistentExecutionMode` 사용 (ADR-0395).
 */
export const setExecutionMode = (mode: ExecutionMode): void => {
  RUNTIME_EXECUTION_MODE = mode;
};

/**
 * 영속 override 설정 — 운영자 영속 강등 시 호출 (ADR-0395 P2).
 *
 * 본 함수는 *디스크 영속* 변경 — Railway 재배포 후에도 유지.
 * RUNTIME_EXECUTION_MODE 도 동시 갱신 — 즉시 효과 보장.
 *
 * 호출자: 운영자 명령 (`/exec_mode_persist OFF` 등 후속 PR), Kill Switch escalation,
 * 자동 강등 정책 (ADR-0395 §운영자 활성화).
 *
 * @param mode 강등할 ExecutionMode
 * @param meta 강등 사유 + 설정자 (감사 추적용)
 */
export const setPersistentExecutionMode = (
  mode: ExecutionMode,
  meta?: { reason?: string; setBy?: string },
): void => {
  RUNTIME_EXECUTION_MODE = mode;
  savePersistentExecutionMode({ mode, reason: meta?.reason, setBy: meta?.setBy });
};

/**
 * 영속 override 제거 — 영속 강등 해제 (ADR-0395 P2).
 *
 * RUNTIME_EXECUTION_MODE 도 함께 초기화 — env default 즉시 회복.
 *
 * 호출자: 운영자 명령 (`/exec_mode_clear` 후속 PR), 자동 회복 정책.
 */
export const clearPersistentExecutionMode = (): void => {
  RUNTIME_EXECUTION_MODE = null;
  clearPersistentOverride();
};

/**
 * 영속 override 조회 — 진단·UI 용 (메모리 RUNTIME 과 별개).
 *
 * `getExecutionMode()` 가 internal 우선순위 체인 적용한 *최종 결정값* 을 반환한다면,
 * 본 함수는 *영속 layer 의 raw record* 를 반환 — `/mode_consistency` 같은 진단 명령에서
 * RUNTIME vs persistent vs env 3-way 비교에 사용.
 */
export const getPersistentExecutionModeRecord = (): ExecutionModeOverrideRecord | null => {
  if (process.env.EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED === 'true') return null;
  try {
    return loadPersistentExecutionMode();
  } catch {
    return null;
  }
};

/**
 * 테스트 격리 헬퍼 — RUNTIME_EXECUTION_MODE + 영속 파일 모두 초기화.
 * 운영 코드는 호출 금지 (테스트 전용).
 */
export const __resetExecutionModeForTests = (): void => {
  RUNTIME_EXECUTION_MODE = null;
  __resetPersistentExecutionModeForTests();
};

// ─── Kill Switch Cascade 원인 추적 ──────────────────────────────────────────
// 강등 시 UI + 알림에 이유를 전달하기 위한 최근 강등 레코드.
export interface KillSwitchRecord {
  /** ISO timestamp */
  at: string;
  /** 강등 전 모드 */
  from: TradingMode;
  /** 강등 후 모드 (현재는 SHADOW 고정, 확장 여지) */
  to: TradingMode;
  /** 강등 트리거 원인 (사람이 읽을 수 있는 한국어 문구) */
  reason: string;
  /** 해당 사이클 감지된 전체 원인 키 (하나 이상일 수 있음) */
  triggers: string[];
}

let KILL_SWITCH_LAST: KillSwitchRecord | null = null;
export const getKillSwitchLast = () => KILL_SWITCH_LAST;
export const setKillSwitchLast = (rec: KillSwitchRecord) => { KILL_SWITCH_LAST = rec; };
