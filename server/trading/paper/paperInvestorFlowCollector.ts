// @responsibility Collect dated KIS investor quantities for Shadow research.
import { fetchKisInvestorTradeByStockDaily } from '../../clients/kisClient.js';
import type { KisInvestorFlow, KisInvestorTradeByStockDaily } from '../../clients/kisClient.js';
import type { PaperDailyClose } from '../../../src/types/paperExperiment.js';
import type { PaperInvestorFlow } from '../../../src/types/paperInvestorFlow.js';
import { previousKrxTradingDay } from '../../calendar/krxTradingCalendar.js';

const cache = new Map<string, { date: string; attemptedAt: number; result: KisInvestorTradeByStockDaily | null }>();

export async function collectPaperInvestorFlow(symbol: string): Promise<KisInvestorTradeByStockDaily | null> {
  const now = new Date();
  const date = previousKrxTradingDay(now);
  const existing = cache.get(symbol);
  const ttl = existing?.result?.tradingDate === date ? 3_600_000 : 300_000;
  if (existing?.date === date && now.getTime() >= existing.attemptedAt && now.getTime() - existing.attemptedAt < ttl) {
    return structuredClone(existing.result);
  }
  if (cache.size >= 3000) cache.clear();
  // Failed queries retry after five minutes; other observations continue independently.
  cache.set(symbol, { date, attemptedAt: now.getTime(), result: null });
  const result = await fetchKisInvestorTradeByStockDaily(symbol, 'LOW', date);
  cache.set(symbol, { date, attemptedAt: now.getTime(), result: structuredClone(result) });
  return result;
}

function quantity(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim().replace(/,/g, '');
  if (!/^[+-]?\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function observePaperInvestorFlow(
  symbol: string, flow: (KisInvestorFlow & Partial<KisInvestorTradeByStockDaily>) | null | undefined,
  closes: PaperDailyClose[], asOf: string,
): PaperInvestorFlow {
  const cutoff = Date.parse(asOf);
  const requestedTradingDate = Number.isFinite(cutoff) ? previousKrxTradingDay(new Date(asOf)) : '';
  const result: PaperInvestorFlow = { symbol, source: 'KIS_API', unit: 'SHARES', requestedTradingDate,
    tradingDate: /^\d{4}-\d{2}-\d{2}$/.test(flow?.tradingDate ?? '') ? flow!.tradingDate! : null,
    observedAt: Number.isFinite(Date.parse(flow?.fetchedAt ?? '')) ? flow!.fetchedAt! : null,
    foreignNetShares: null, institutionalNetShares: null, volume: null, issue: null };
  const fail = (issue: PaperInvestorFlow['issue']) => ({ ...result, issue });
  if (!Number.isFinite(cutoff)) return fail('TIME_INVALID');
  if (!flow) return fail('UNAVAILABLE');
  if (flow.source !== 'KIS_API' || flow.stockCode !== symbol) return fail('SYMBOL_MISMATCH');
  if (flow.tradingDate !== requestedTradingDate) return fail('DATE_MISMATCH');
  const closed = Date.parse(`${requestedTradingDate}T15:30:00+09:00`);
  const observed = Date.parse(flow.fetchedAt ?? '');
  if (!(observed >= closed && observed <= cutoff)) return fail('TIME_INVALID');
  // Only explicit share fields from one dated row are compatible with daily share volume.
  // The legacy normalized values can contain money aliases or cross-bucket values.
  const row = flow.actualRows?.find(item => String(item.stck_bsop_date ?? item.STCK_BSOP_DATE).replace(/-/g, '') === requestedTradingDate.replace(/-/g, ''));
  result.foreignNetShares = quantity(row?.frgn_ntby_qty ?? row?.FRGN_NTBY_QTY);
  result.institutionalNetShares = quantity(row?.orgn_ntby_qty ?? row?.ORGN_NTBY_QTY);
  if (result.foreignNetShares === null || result.institutionalNetShares === null) return fail('QUANTITY_MISSING');
  const bar = closes.find(item => item.tradingDate === requestedTradingDate
    && Date.parse(item.availableAt) >= closed && Date.parse(item.availableAt) <= cutoff);
  result.volume = quantity(bar?.volume);
  if (result.volume === null || result.volume <= 0) return fail('VOLUME_MISSING');
  if (Math.abs(result.foreignNetShares) > result.volume || Math.abs(result.institutionalNetShares) > result.volume) return fail('VOLUME_MISMATCH');
  return result;
}
