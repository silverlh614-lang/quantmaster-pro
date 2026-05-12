// @responsibility Yahoo time-series execution guard
import { isTradingDay } from '../utils/marketDayClassifier.js';

export interface ChartPointLike {
  close?: number | null;
  timestamp?: number | string | Date | null;
  date?: string | Date | null;
  time?: number | string | Date | null;
}

export interface YahooProviderGuardResult {
  provider: 'YAHOO';
  health: 'OK' | 'STALE';
  usableForExecution: boolean;
  usableForSignal: boolean;
  usableForRouter: boolean;
  usableForShadow: true;
  reason: 'YAHOO_TIMESERIES_FRESH' | 'YAHOO_TIMESERIES_STALE';
  latestDateKst?: string;
  expectedTradingDateKst: string;
  staleDays: number;
}

const MS_PER_DAY = 86_400_000;

function kstYmd(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function previousOrSameTradingDateKst(now: Date): string {
  let cursor = kstYmd(now);
  for (let i = 0; i < 14; i += 1) {
    if (isTradingDay(cursor)) return cursor;
    const d = new Date(`${cursor}T00:00:00.000Z`);
    cursor = new Date(d.getTime() - MS_PER_DAY).toISOString().slice(0, 10);
  }
  return kstYmd(now);
}

function parsePointDate(point: ChartPointLike | undefined): Date | null {
  const raw = point?.timestamp ?? point?.date ?? point?.time;
  if (raw == null) return null;
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null;
  if (typeof raw === 'number') {
    const ms = raw < 10_000_000_000 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function evaluateYahooTimeseriesGuard(
  chart: ChartPointLike[] | null | undefined,
  options: { now?: Date; allowedStaleDays?: number } = {},
): YahooProviderGuardResult {
  const now = options.now ?? new Date();
  const allowedStaleDays = options.allowedStaleDays ?? 1;
  const expectedTradingDateKst = previousOrSameTradingDateKst(now);
  const latest = [...(chart ?? [])].reverse().find((point) => Number.isFinite(Number(point.close)));
  const latestDate = parsePointDate(latest);
  const latestDateKst = latestDate ? kstYmd(latestDate) : undefined;
  const staleDays = latestDateKst
    ? Math.max(0, Math.floor((Date.parse(`${expectedTradingDateKst}T00:00:00Z`) - Date.parse(`${latestDateKst}T00:00:00Z`)) / MS_PER_DAY))
    : Number.POSITIVE_INFINITY;
  const stale = !latestDateKst || staleDays > allowedStaleDays || latestDateKst !== expectedTradingDateKst;

  return {
    provider: 'YAHOO',
    health: stale ? 'STALE' : 'OK',
    usableForExecution: !stale,
    usableForSignal: !stale,
    usableForRouter: !stale,
    usableForShadow: true,
    reason: stale ? 'YAHOO_TIMESERIES_STALE' : 'YAHOO_TIMESERIES_FRESH',
    latestDateKst,
    expectedTradingDateKst,
    staleDays,
  };
}

export function noFreshExecutionProviderDecision(): {
  decision: 'NO_SIGNAL';
  engineMode: 'DEGRADED';
  executionAllowed: false;
  shadowAllowed: true;
  reason: 'NO_FRESH_EXECUTION_PROVIDER';
} {
  return {
    decision: 'NO_SIGNAL',
    engineMode: 'DEGRADED',
    executionAllowed: false,
    shadowAllowed: true,
    reason: 'NO_FRESH_EXECUTION_PROVIDER',
  };
}
