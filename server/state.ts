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

export const getTradingMode = (): TradingMode => RUNTIME_MODE ?? readEnvMode();
export const setTradingMode = (mode: TradingMode): void => { RUNTIME_MODE = mode; };

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
