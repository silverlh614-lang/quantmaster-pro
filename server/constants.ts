// @responsibility constants 서버 모듈
// server/constants.ts — 서버 전용 AI 상수 (src/constants/aiConfig.ts 복사본)
// gemini-3.5-flash: GA(2026-05-19, stable) — gemini-3-flash-preview 대체. thinking 모델이라
//   thinking 토큰이 maxOutputTokens 를 함께 소비하므로 callGeminiText.buildThinkingConfig 가
//   gemini-3.x 분기에서 thinkingLevel:LOW 로 최소화한다(EMPTY_RESPONSE 방지).
export const AI_MODELS = {
  PRIMARY:     'gemini-3.5-flash',  // 장중 고빈도 반복 호출
  SERVER_SIDE: 'gemini-3.5-flash',  // conditionAuditor, globalScanAgent
  FAST:        'gemini-3.5-flash',  // 빠른 경량 처리
} as const;

export const AI_CONFIG = {
  DEFAULT_TEMPERATURE: 0.1,
  MAX_OUTPUT_TOKENS: 4096,
  RETRY_COUNT: 2,
  RETRY_DELAY_MS: 2000,
} as const;
