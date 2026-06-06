// @responsibility aiConfig 모듈
// src/constants/aiConfig.ts
// gemini-3.5-flash: GA(2026-05-19, stable) — gemini-3-flash-preview(폐기 예정) 대체.
// thinking 모델이라 thinking 토큰이 maxOutputTokens 를 함께 소비 → getAI() 래퍼가
// 모든 generateContent 에 thinkingLevel:LOW 를 기본 주입해 빈/잘린 응답을 방지한다.
export const AI_MODELS = {
  PRIMARY: 'gemini-3.5-flash',      // 메인 AI 분석용
  SERVER_SIDE: 'gemini-3.5-flash',  // autoTradeEngine 서버용
  FAST: 'gemini-3.5-flash',         // 빠른 응답 필요 시
} as const;

export const AI_CONFIG = {
  DEFAULT_TEMPERATURE: 0.1,
  MAX_OUTPUT_TOKENS: 4096,
  RETRY_COUNT: 2,
  RETRY_DELAY_MS: 2000,
} as const;
