/**
 * @responsibility Yahoo STALE_BASE recovery helper — force refresh + KIS fallback decision contract.
 *
 * PR-549 scope:
 * - Yahoo adapter already detects STALE_BASE via safePctChangeDetailed.
 * - This module turns that diagnosis into an operator-visible recovery decision.
 * - It intentionally never converts stale returns to 0% as a valid signal.
 */

import { fetchKisIntraday } from './kisQuoteAdapter.js';
import type { YahooQuoteExtended } from './yahooQuoteAdapter.js';

export type YahooStaleRecoveryStatus =
  | 'OK'
  | 'KIS_CHANGE_PERCENT_RECOVERED'
  | 'STALE_UNRECOVERED'
  | 'FETCH_FAIL';

export interface YahooStaleRecoveryResult {
  status: YahooStaleRecoveryStatus;
  quote: YahooQuoteExtended | null;
  recoveredFields: Array<'changePercent'>;
  unrecoveredIssues: Array<'changePercent' | 'return5d' | 'return20d'>;
  note: string;
}

function cloneQuote(q: YahooQuoteExtended): YahooQuoteExtended {
  return {
    ...q,
    dataQualityIssues: q.dataQualityIssues ? [...q.dataQualityIssues] : undefined,
    recentCloses10d: q.recentCloses10d ? [...q.recentCloses10d] : undefined,
    recentHighs10d: q.recentHighs10d ? [...q.recentHighs10d] : undefined,
    recentLows10d: q.recentLows10d ? [...q.recentLows10d] : undefined,
    recentVolumes10d: q.recentVolumes10d ? [...q.recentVolumes10d] : undefined,
  };
}

export function resolveYahooStaleRecoveryState(
  quote: YahooQuoteExtended | null,
): YahooStaleRecoveryResult {
  if (!quote) {
    return {
      status: 'FETCH_FAIL',
      quote: null,
      recoveredFields: [],
      unrecoveredIssues: [],
      note: 'Yahoo fetch failed before stale recovery.',
    };
  }

  if (quote.dataQuality !== 'STALE_BASE') {
    return {
      status: 'OK',
      quote,
      recoveredFields: [],
      unrecoveredIssues: [],
      note: 'Yahoo quote dataQuality OK.',
    };
  }

  return {
    status: 'STALE_UNRECOVERED',
    quote,
    recoveredFields: [],
    unrecoveredIssues: quote.dataQualityIssues ?? [],
    note: 'Yahoo quote has stale base issues and requires recovery or exclusion.',
  };
}

export async function recoverYahooStaleQuoteWithKis(
  code: string,
  quote: YahooQuoteExtended | null,
  options: {
    fetchKis?: typeof fetchKisIntraday;
  } = {},
): Promise<YahooStaleRecoveryResult> {
  const base = resolveYahooStaleRecoveryState(quote);
  if (base.status !== 'STALE_UNRECOVERED' || !base.quote) return base;

  const issues = base.unrecoveredIssues;
  const onlyChangePercent = issues.length === 1 && issues[0] === 'changePercent';
  if (!onlyChangePercent) {
    return {
      ...base,
      note: `Yahoo stale fields are not recoverable by intraday KIS fallback: ${issues.join(',') || 'UNKNOWN'}.`,
    };
  }

  const fetcher = options.fetchKis ?? fetchKisIntraday;
  const kis = await fetcher(code).catch(() => null);
  if (!kis || kis.price <= 0 || kis.prevClose <= 0) {
    return {
      ...base,
      note: 'KIS intraday fallback failed or missing prevClose.',
    };
  }

  const changePercent = ((kis.price - kis.prevClose) / kis.prevClose) * 100;
  if (!Number.isFinite(changePercent) || Math.abs(changePercent) > 30) {
    return {
      ...base,
      note: `KIS intraday fallback rejected by ±30% sanity: ${Number.isFinite(changePercent) ? changePercent.toFixed(2) : 'NaN'}%.`,
    };
  }

  const recovered = cloneQuote(base.quote);
  recovered.price = kis.price;
  recovered.prevClose = kis.prevClose;
  recovered.changePercent = parseFloat(changePercent.toFixed(2));
  recovered.dataQuality = 'OK';
  recovered.dataQualityIssues = undefined;

  return {
    status: 'KIS_CHANGE_PERCENT_RECOVERED',
    quote: recovered,
    recoveredFields: ['changePercent'],
    unrecoveredIssues: [],
    note: `Yahoo changePercent recovered from KIS intraday: ${changePercent.toFixed(2)}%.`,
  };
}

export function shouldExcludeFromMomentumByYahooStale(result: YahooStaleRecoveryResult): boolean {
  return result.status === 'FETCH_FAIL' || result.status === 'STALE_UNRECOVERED';
}
