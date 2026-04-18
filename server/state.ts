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
