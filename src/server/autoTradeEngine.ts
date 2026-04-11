/**
 * autoTradeEngine.ts — 하위 호환 re-export 허브
 *
 * ⚠️  이 파일은 순수 re-export 전용입니다.
 *     실제 구현은 각 서브모듈에 있습니다.
 *     server.ts 및 기존 import 경로 유지를 위해 모든 심볼을 재내보냅니다.
 */

// ─── Persistence ───────────────────────────────────────────────────────────────
export * from './persistence/watchlistRepo.js';
export * from './persistence/macroStateRepo.js';
export * from './persistence/shadowTradeRepo.js';
export * from './persistence/blacklistRepo.js';
export * from './persistence/conditionWeightsRepo.js';
export * from './persistence/fssRepo.js';
export * from './persistence/dartRepo.js';

// ─── Clients ───────────────────────────────────────────────────────────────────
export { refreshKisToken, KIS_IS_REAL } from './clients/kisClient.js';

// ─── Alerts ────────────────────────────────────────────────────────────────────
export * from './alerts/telegramClient.js';
export * from './alerts/dartPoller.js';
export * from './alerts/bearRegimeAlert.js';
export * from './alerts/mhsAlert.js';
export * from './alerts/ipsAlert.js';
export * from './alerts/reportGenerator.js';

// ─── Trading ───────────────────────────────────────────────────────────────────
export * from './trading/riskManager.js';
export * from './trading/signalScanner.js';
export * from './trading/fillMonitor.js';
export * from './trading/trancheExecutor.js';

// ─── Screener ──────────────────────────────────────────────────────────────────
export * from './screener/stockScreener.js';

// ─── Learning ──────────────────────────────────────────────────────────────────
export * from './learning/recommendationTracker.js';
export * from './learning/signalCalibrator.js';

// ─── Orchestrator ──────────────────────────────────────────────────────────────
export * from './orchestrator/tradingOrchestrator.js';
