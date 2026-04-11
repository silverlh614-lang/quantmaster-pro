/**
 * autoTradeEngine.ts — 하위 호환 re-export 허브
 *
 * ⚠️  이 파일은 순수 re-export 전용입니다.
 *     실제 구현은 server/ 서브모듈에 있습니다.
 *     server.ts 및 기존 import 경로 유지를 위해 모든 심볼을 재내보냅니다.
 */

// ─── Persistence ───────────────────────────────────────────────────────────────
export * from '../../server/persistence/watchlistRepo.js';
export * from '../../server/persistence/macroStateRepo.js';
export * from '../../server/persistence/shadowTradeRepo.js';
export * from '../../server/persistence/blacklistRepo.js';
export * from '../../server/persistence/conditionWeightsRepo.js';
export * from '../../server/persistence/fssRepo.js';
export * from '../../server/persistence/dartRepo.js';

// ─── Clients ───────────────────────────────────────────────────────────────────
export { refreshKisToken, KIS_IS_REAL } from '../../server/clients/kisClient.js';

// ─── Alerts ────────────────────────────────────────────────────────────────────
export * from '../../server/alerts/telegramClient.js';
export * from '../../server/alerts/dartPoller.js';
export * from '../../server/alerts/bearRegimeAlert.js';
export * from '../../server/alerts/mhsAlert.js';
export * from '../../server/alerts/ipsAlert.js';
export * from '../../server/alerts/reportGenerator.js';

// ─── Trading ───────────────────────────────────────────────────────────────────
export * from '../../server/trading/riskManager.js';
export * from '../../server/trading/signalScanner.js';
export * from '../../server/trading/fillMonitor.js';
export * from '../../server/trading/trancheExecutor.js';

// ─── Screener ──────────────────────────────────────────────────────────────────
export * from '../../server/screener/stockScreener.js';

// ─── Learning ──────────────────────────────────────────────────────────────────
export * from '../../server/learning/recommendationTracker.js';
export * from '../../server/learning/signalCalibrator.js';

// ─── Orchestrator ──────────────────────────────────────────────────────────────
export * from '../../server/orchestrator/tradingOrchestrator.js';
