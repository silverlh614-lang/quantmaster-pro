// @responsibility state 서버 모듈
// server/state.ts — 공유 상태 모듈
// 서버사이드 비상 정지 플래그 & 일일 손실률을 단일 모듈에서 관리
let EMERGENCY_STOP = false;
let DAILY_LOSS_PCT = 0;

export const getEmergencyStop = () => EMERGENCY_STOP;
export const setEmergencyStop = (v: boolean) => { EMERGENCY_STOP = v; };
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
 * 실행 모드 조회 — RUNTIME override 우선, 그 외 env 해석.
 * 본 함수가 신규 SSOT — getTradingMode() 는 deprecated wrapper.
 */
export const getExecutionMode = (): ExecutionMode =>
  RUNTIME_EXECUTION_MODE ?? readEnvExecutionMode();

/**
 * RUNTIME override 설정 — Kill switch / 운영자 강등 시 호출.
 * P1 Stage A 단계는 호출자 0건 (P1-Wiring 후속 PR 에서 wiring).
 */
export const setExecutionMode = (mode: ExecutionMode): void => {
  RUNTIME_EXECUTION_MODE = mode;
};

/**
 * 테스트 격리 헬퍼 — RUNTIME_EXECUTION_MODE 초기화.
 * 운영 코드는 호출 금지 (테스트 전용).
 */
export const __resetExecutionModeForTests = (): void => {
  RUNTIME_EXECUTION_MODE = null;
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
