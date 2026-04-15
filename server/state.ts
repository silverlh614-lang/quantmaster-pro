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
