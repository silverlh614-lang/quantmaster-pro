// @responsibility constants 서버 모듈
// server/constants.ts — 서버 전용 AI 상수 (src/constants/aiConfig.ts 복사본)
// gemini-2.5-flash: Stable — 장중 고빈도 반복 호출 및 서버사이드 AI에 권장
// gemini-3-flash-preview는 rate limit이 엄격하고 예고 없이 변경될 수 있어 제외
export const AI_MODELS = {
  PRIMARY:     'gemini-2.5-flash',  // 장중 고빈도 반복 호출
  SERVER_SIDE: 'gemini-2.5-flash',  // conditionAuditor, globalScanAgent
  FAST:        'gemini-2.5-flash',  // 빠른 경량 처리
} as const;

export const AI_CONFIG = {
  DEFAULT_TEMPERATURE: 0.1,
  MAX_OUTPUT_TOKENS: 4096,
  RETRY_COUNT: 2,
  RETRY_DELAY_MS: 2000,
} as const;
