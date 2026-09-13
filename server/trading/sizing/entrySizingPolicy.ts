// @responsibility 계좌 자금과 명시 배분 한도로 주문 수량을 계산한다.
import type { EntryOrderSizingInput, EntryOrderSizingResult } from '../../../src/types/entrySizing.js';
import type { PositionPolicySizingResult } from './regimePositionPolicy.js';
import type { PortfolioExposureBudget, ApplyPortfolioExposureCapResult } from './regimeExposurePolicy.js';

/** Persisted historical trade marker; retained for ledger compatibility. */
export const ENTRY_SIZING_SOURCE = 'LEGACY_SSOT' as const;

export interface EntryPositionSizingInput {
  totalEquity: number;
  currentPositions?: number;
  /** Historical caller compatibility only; never used in allocation. */
  regime?: string | null;
  /** Existing trading settings default: maximum fifteen percent per stock. */
  positionSizePct?: number;
  maxPositions?: number;
  maxGrossExposurePct?: number;
}

export function calculateEntryPositionSizing(input: EntryPositionSizingInput): PositionPolicySizingResult {
  const positionSizePct = Number.isFinite(input.positionSizePct ?? 15)
    ? Math.max(0, Math.min(100, input.positionSizePct ?? 15)) : 0;
  const maxGrossExposurePct = Number.isFinite(input.maxGrossExposurePct ?? 100)
    ? Math.max(0, Math.min(100, input.maxGrossExposurePct ?? 100)) : 0;
  const derivedSlots = positionSizePct > 0 ? Math.floor(maxGrossExposurePct / positionSizePct) : 0;
  const maxPositions = Number.isFinite(input.maxPositions ?? derivedSlots)
    ? Math.max(0, Math.floor(input.maxPositions ?? derivedSlots)) : 0;
  const currentPositions = Number.isFinite(input.currentPositions ?? 0)
    ? Math.max(0, Math.floor(input.currentPositions ?? 0)) : maxPositions;
  const totalEquity = Number.isFinite(input.totalEquity) && input.totalEquity > 0 ? input.totalEquity : 0;
  return {
    policy: { regime: 'FIXED_BUDGET', maxPositions, maxGrossExposurePct, perPositionPct: positionSizePct },
    currentPositions, remainingSlots: Math.max(0, maxPositions - currentPositions),
    positionSizePct, positionAmount: totalEquity * positionSizePct / 100,
    kellyDisabled: true, kellyIgnoredReason: 'REMOVED_BY_SIMPLIFICATION_POLICY',
  };
}

export function calculateOrderQuantity(input: EntryOrderSizingInput): EntryOrderSizingResult {
  if (![input.totalAssets, input.orderableCash, input.positionPct, input.price, input.remainingSlots].every(Number.isFinite)
    || input.price <= 0 || input.remainingSlots <= 0 || input.orderableCash <= 0 || input.totalAssets <= 0) {
    return { quantity: 0, effectiveBudget: 0 };
  }
  const targetBudget = Math.max(0, input.totalAssets * Math.min(1, input.positionPct));
  const slotBudget = input.orderableCash / input.remainingSlots;
  const effectiveBudget = Math.max(0, Math.min(input.orderableCash, targetBudget, slotBudget));
  return { quantity: Math.floor(effectiveBudget / input.price), effectiveBudget };
}

export interface ApplyExposureBudgetCapInput {
  rawQuantity: number;
  shadowEntryPrice: number;
  accountEquity: number;
  currentEquityExposureAmount: number;
  currentCashAmount: number;
  isAddOnBuy: boolean;
  maxGrossExposurePct?: number;
  maxPositionAmount?: number;
  currentPositionAmount?: number;
  /** Historical arguments retained solely to accept old callers; none are read. */
  regime?: string;
  exposureRegime?: string;
  macro?: unknown;
}

export interface ApplyExposureBudgetCapResult {
  applied: boolean;
  finalQuantity: number;
  capResult?: ApplyPortfolioExposureCapResult;
  /** Historical result compatibility only. New calculations never synthesize a regime budget. */
  budget?: PortfolioExposureBudget;
  skipReason?: 'INPUT_MISSING';
}

/** Cap the requested quantity; no policy may multiply it or substitute missing account data. */
export function applyExposureBudgetCap(input: ApplyExposureBudgetCapInput): ApplyExposureBudgetCapResult {
  const values = [input.rawQuantity, input.shadowEntryPrice, input.accountEquity,
    input.currentEquityExposureAmount, input.currentCashAmount];
  const grossPct = input.maxGrossExposurePct ?? 100;
  const currentPositionAmount = input.currentPositionAmount ?? 0;
  const invalid = !values.every(Number.isFinite) || input.accountEquity <= 0 || input.shadowEntryPrice <= 0
    || input.rawQuantity < 0 || input.currentCashAmount < 0 || input.currentEquityExposureAmount < 0
    || !Number.isFinite(grossPct) || grossPct < 0 || !Number.isFinite(currentPositionAmount) || currentPositionAmount < 0
    || (input.maxPositionAmount !== undefined && (!Number.isFinite(input.maxPositionAmount) || input.maxPositionAmount < 0));
  if (invalid) {
    return { applied: true, finalQuantity: 0, skipReason: 'INPUT_MISSING',
      capResult: { finalPositionAmount: 0, cappedByExposureBudget: true, blockReason: '가격·계좌 자금 확인 필요' } };
  }
  const capitalLimit = input.accountEquity * Math.min(100, grossPct) / 100;
  const capitalRemaining = Math.max(0, capitalLimit - input.currentEquityExposureAmount);
  const positionRemaining = input.maxPositionAmount === undefined ? capitalLimit
    : Math.max(0, input.maxPositionAmount - currentPositionAmount);
  const requested = Math.floor(input.rawQuantity);
  const amount = Math.min(requested * input.shadowEntryPrice, input.currentCashAmount, capitalRemaining, positionRemaining);
  const finalQuantity = Math.min(requested, Math.floor(Math.max(0, amount) / input.shadowEntryPrice));
  const capped = finalQuantity < requested;
  return { applied: true, finalQuantity,
    capResult: { finalPositionAmount: finalQuantity * input.shadowEntryPrice, cappedByExposureBudget: capped,
      ...(capped ? { blockReason: '현금·계좌·종목별 자금 한도' } : {}) } };
}
