// @responsibility ADR-0491/P1-1C InvestorFlow snapshot lookup key normalization; diagnostic-only, no raw payload persistence.
import { isTradingDay } from '../../utils/marketDayClassifier.js';
import type { SupplySnapshotDomainAdr0491 } from './supplySnapshotStoreReplayAdr0491.js';

export type InvestorFlowSnapshotSourceAdr0491 = 'NAVER_INVESTOR_TREND' | 'SEMANTIC_NETBUY' | 'CACHE' | 'KRX_INVESTOR_FLOW' | 'KIS_API';

export interface NormalizeInvestorFlowSnapshotKeyInputAdr0491 {
  symbol?: string | null;
  code?: string | null;
  source?: string | null;
  provider?: string | null;
  domain?: string | null;
  route?: string | null;
  tradingDate?: string | null;
  sourceDate?: string | null;
  now?: Date;
}

export interface NormalizedInvestorFlowSnapshotKeyAdr0491 {
  normalizedCode: string;
  normalizedSource: InvestorFlowSnapshotSourceAdr0491 | 'UNKNOWN';
  normalizedDomain: SupplySnapshotDomainAdr0491;
  route: 'investor_flow';
  tradingDateCandidates: string[];
  sourceCandidates: InvestorFlowSnapshotSourceAdr0491[];
  lookupKey: string;
}

const SOURCE_ALIASES: Record<string, InvestorFlowSnapshotSourceAdr0491> = {
  NAVER: 'NAVER_INVESTOR_TREND',
  NAVER_INVESTOR_TREND: 'NAVER_INVESTOR_TREND',
  SEMANTIC_NETBUY: 'SEMANTIC_NETBUY',
  SEMANTICNETBUY: 'SEMANTIC_NETBUY',
  SEMANTIC_NET_BUY: 'SEMANTIC_NETBUY',
  SEMANTIC_NETBUY_NORMALIZER: 'SEMANTIC_NETBUY',
  'SEMANTIC NETBUY': 'SEMANTIC_NETBUY',
  'SEMANTIC NET_BUY': 'SEMANTIC_NETBUY',
  KRX: 'KRX_INVESTOR_FLOW',
  KRX_INVESTOR_FLOW: 'KRX_INVESTOR_FLOW',
  CACHE: 'CACHE',
  KIS: 'KIS_API',
  KIS_API: 'KIS_API',
};

function toKstDateYmd(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

export function previousTradingDateCandidateAdr0491(ymd: string): string {
  let cursor = shiftYmd(ymd, -1);
  for (let i = 0; i < 10; i += 1) {
    if (isTradingDay(cursor)) return cursor;
    cursor = shiftYmd(cursor, -1);
  }
  return cursor;
}

export function normalizeInvestorFlowCodeAdr0491(input: string | null | undefined): string {
  const digits = String(input ?? '').replace(/[^0-9]/g, '');
  if (digits.length >= 6) return digits.slice(-6);
  return digits.padStart(6, '0');
}

export function normalizeInvestorFlowSourceKeyAdr0491(input: string | null | undefined): InvestorFlowSnapshotSourceAdr0491 | 'UNKNOWN' {
  const raw = String(input ?? '').trim();
  if (!raw) return 'UNKNOWN';
  const key = raw.replace(/[\s-]+/g, '_').toUpperCase();
  return SOURCE_ALIASES[key] ?? SOURCE_ALIASES[raw.toUpperCase()] ?? 'UNKNOWN';
}

export function normalizeInvestorFlowSnapshotKeyAdr0491(
  input: NormalizeInvestorFlowSnapshotKeyInputAdr0491,
): NormalizedInvestorFlowSnapshotKeyAdr0491 {
  const normalizedCode = normalizeInvestorFlowCodeAdr0491(input.code ?? input.symbol);
  const source = normalizeInvestorFlowSourceKeyAdr0491(input.source ?? input.provider);
  const normalizedDomain: SupplySnapshotDomainAdr0491 = input.route === 'investor_flow' || input.domain === 'SUPPLY' ? 'SUPPLY' : 'SUPPLY';
  const today = toKstDateYmd(input.now);
  const explicitDate = input.tradingDate ?? input.sourceDate ?? today;
  const candidates = [...new Set([explicitDate, today, previousTradingDateCandidateAdr0491(explicitDate), previousTradingDateCandidateAdr0491(today)])]
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const sourceCandidates = source === 'UNKNOWN'
    ? ['KRX_INVESTOR_FLOW', 'KIS_API', 'NAVER_INVESTOR_TREND', 'CACHE', 'SEMANTIC_NETBUY'] as InvestorFlowSnapshotSourceAdr0491[]
    : [source];
  return {
    normalizedCode,
    normalizedSource: source,
    normalizedDomain,
    route: 'investor_flow',
    tradingDateCandidates: candidates,
    sourceCandidates,
    lookupKey: `route=investor_flow|domain=${normalizedDomain}|code=${normalizedCode}|source=${source}|dates=${candidates.join(',')}`,
  };
}
