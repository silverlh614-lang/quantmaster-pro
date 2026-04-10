// src/constants/aiConfig.ts
export const AI_MODELS = {
  PRIMARY: 'gemini-3-flash-preview',      // 메인 AI 분석용
  SERVER_SIDE: 'gemini-3-flash-preview',  // autoTradeEngine 서버용
  FAST: 'gemini-3-flash-preview',         // 빠른 응답 필요 시
} as const;

export const AI_CONFIG = {
  DEFAULT_TEMPERATURE: 0.1,
  MAX_OUTPUT_TOKENS: 4096,
  RETRY_COUNT: 2,
  RETRY_DELAY_MS: 2000,
} as const;
