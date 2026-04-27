// @responsibility stockService 서비스 모듈
export * from './stock/types';
export * from './stock/aiClient';
// PR-25-C (ADR-0011): kisDataFetcher 제거 — AI 추천 경로의 KIS 의존 완전 차단.
//   자동매매 KIS 호출은 server/clients/kisClient.ts 로 이미 통합되어 있음.
export * from './stock/dartDataFetcher';
export * from './stock/enrichment';
export * from './stock/priceSync';
export * from './stock/stockSearch';
export * from './stock/historicalData';
export * from './stock/backtestService';
export * from './stock/reportUtils';
export * from './stock/marketOverview';
export * from './stock/quantScreener';
export * from './stock/recommendations';
export * from './stock/macroIntel';
export * from './stock/globalIntel';
export * from './stock/batchIntel';
export type { Portfolio, BacktestResult, BacktestPosition, BacktestPortfolioState, BacktestDailyLog } from '../types/portfolio';
