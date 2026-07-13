// @responsibility Gate3 forward return calculation for outcome tracking; no provider fetch.

import { applyGate3OutcomeLabel, type Gate3OutcomeLabelContext } from './gate3OutcomeLabeler.js';
import type { Gate3ForwardReturns, Gate3OutcomeSeed, Gate3OutcomeStatus } from './gate3OutcomeSeed.js';
import { roundGate3OutcomePct } from './gate3OutcomeSeed.js';

export type Gate3ForwardHorizon = keyof Gate3ForwardReturns;

export interface Gate3ForwardPriceSnapshot {
  symbol: string;
  horizon: Gate3ForwardHorizon;
  price: number | null;
}

export interface Gate3ForwardReturnUpdateOptions {
  elapsedTradingDays?: number;
  labelContextBySeedId?: Record<string, Gate3OutcomeLabelContext>;
}

function finitePrice(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function forwardReturnPct(entryReferencePrice: number, futurePrice: number): number {
  return roundGate3OutcomePct(((futurePrice - entryReferencePrice) / entryReferencePrice) * 100);
}

export function calculateGate3ForwardReturnPct(
  entryReferencePrice: number | null,
  futurePrice: number | null,
): number | null {
  const entry = finitePrice(entryReferencePrice);
  const future = finitePrice(futurePrice);
  if (entry === null || future === null) return null;
  return forwardReturnPct(entry, future);
}

function buildGate3ForwardReturns(
  seed: Gate3OutcomeSeed,
  prices: Partial<Record<Gate3ForwardHorizon, number | null>>,
): Gate3ForwardReturns {
  return {
    d1: prices.d1 !== undefined ? calculateGate3ForwardReturnPct(seed.entryReferencePrice, prices.d1) : seed.forwardReturns.d1,
    d3: prices.d3 !== undefined ? calculateGate3ForwardReturnPct(seed.entryReferencePrice, prices.d3) : seed.forwardReturns.d3,
    d5: prices.d5 !== undefined ? calculateGate3ForwardReturnPct(seed.entryReferencePrice, prices.d5) : seed.forwardReturns.d5,
    d10: prices.d10 !== undefined ? calculateGate3ForwardReturnPct(seed.entryReferencePrice, prices.d10) : seed.forwardReturns.d10,
  };
}

function returnValues(returns: Gate3ForwardReturns): number[] {
  return Object.values(returns).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function outcomeStatusFor(seed: Gate3OutcomeSeed, returns: Gate3ForwardReturns, elapsedTradingDays: number | undefined): Gate3OutcomeStatus {
  const values = returnValues(returns);
  if (seed.entryReferencePrice === null) return 'DATA_INSUFFICIENT';
  if (values.length === 0) return elapsedTradingDays !== undefined && elapsedTradingDays > 10 ? 'DATA_INSUFFICIENT' : 'PENDING';
  if (returns.d10 !== null) return 'PARTIAL';
  if (elapsedTradingDays !== undefined && elapsedTradingDays > 10) return 'EXPIRED';
  return 'PARTIAL';
}

export function applyGate3ForwardReturns(
  seed: Gate3OutcomeSeed,
  prices: Partial<Record<Gate3ForwardHorizon, number | null>>,
  options: Gate3ForwardReturnUpdateOptions = {},
): Gate3OutcomeSeed {
  const forwardReturns = buildGate3ForwardReturns(seed, prices);
  const values = returnValues(forwardReturns);
  const maxForwardReturnPct = values.length > 0 ? Math.max(...values) : seed.maxForwardReturnPct;
  const minForwardReturnPct = values.length > 0 ? Math.min(...values) : seed.minForwardReturnPct;
  const hitTarget = seed.entryReferencePrice !== null && seed.targetPrice !== null && maxForwardReturnPct !== null
    ? seed.entryReferencePrice * (1 + maxForwardReturnPct / 100) >= seed.targetPrice
    : seed.hitTarget;
  const hitStop = seed.entryReferencePrice !== null && seed.stopLoss !== null && minForwardReturnPct !== null
    ? seed.entryReferencePrice * (1 + minForwardReturnPct / 100) <= seed.stopLoss
    : seed.hitStop;
  const updated: Gate3OutcomeSeed = {
    ...seed,
    forwardReturns,
    maxForwardReturnPct,
    minForwardReturnPct,
    hitTarget,
    hitStop,
    outcomeStatus: outcomeStatusFor(seed, forwardReturns, options.elapsedTradingDays),
    marketSignal: false,
    providerIssue: false,
  };
  if (updated.outcomeStatus === 'EXPIRED' || updated.outcomeStatus === 'DATA_INSUFFICIENT') return updated;
  return applyGate3OutcomeLabel(updated, options.labelContextBySeedId?.[seed.id]);
}

function priceMapForSymbol(
  snapshots: readonly Gate3ForwardPriceSnapshot[],
  symbol: string,
): Partial<Record<Gate3ForwardHorizon, number | null>> {
  const prices: Partial<Record<Gate3ForwardHorizon, number | null>> = {};
  for (const snapshot of snapshots) {
    if (snapshot.symbol === symbol) prices[snapshot.horizon] = snapshot.price;
  }
  return prices;
}

export function updatePendingGate3Outcomes(
  seeds: readonly Gate3OutcomeSeed[],
  currentQuotes: readonly Gate3ForwardPriceSnapshot[],
  options: Gate3ForwardReturnUpdateOptions = {},
): Gate3OutcomeSeed[] {
  return seeds.map((seed) => {
    if (seed.outcomeStatus === 'LABELED' || seed.outcomeStatus === 'EXPIRED') return seed;
    const prices = priceMapForSymbol(currentQuotes, seed.symbol);
    const hasPriceInput = Object.keys(prices).length > 0;
    if (!hasPriceInput && (options.elapsedTradingDays ?? 0) <= 10) return seed;
    return applyGate3ForwardReturns(seed, prices, options);
  });
}
