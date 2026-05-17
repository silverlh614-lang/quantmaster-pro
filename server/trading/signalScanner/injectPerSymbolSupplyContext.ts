// @responsibility buyList candidates per-symbol investor-flow context hydration
import { createTraceId, logger, logVisibilityEvent } from '../../utils/logger.js';
import { fetchInvestorFlowWithPolicy, type InvestorFlowRouteResult } from '../../supply/investorFlowRouter.js';
import type { ExecutionImpact } from '../../runtime/engineRuntimePolicy.js';
import type { SupplyProviderHealthTrace } from './entryFilterDecomposition.js';

export type SupplyProviderHealth =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'UNKNOWN';

export type SupplySignal =
  | 'BULLISH'
  | 'ACCUMULATING'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'UNUSABLE';

export interface PerSymbolSupplyContext {
  symbol: string;
  provider: 'KIS_API' | 'KRX' | 'CACHE' | 'NONE';
  supplyProviderHealth: SupplyProviderHealth;
  supplySignal: SupplySignal;
  providerIssue: boolean;
  marketSignal: boolean;
  executionImpact: ExecutionImpact;
  investorNetBuyAmount?: number;
  foreignNetBuyAmount?: number;
  institutionNetBuyAmount?: number;
  programNetBuyAmount?: number;
  nonProgramNetBuyAmount?: number;
  fetchedAt?: string;
  staleReason?: string;
  rawStatus?: string;
}

export interface InvestorFlowResult {
  symbol: string;
  status: 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING' | string;
  provider?: 'KIS_API' | 'KRX' | 'CACHE' | 'NONE' | string | null;
  investorNetBuyAmount?: number;
  foreignNetBuyAmount?: number;
  institutionNetBuyAmount?: number;
  programNetBuyAmount?: number;
  nonProgramNetBuyAmount?: number;
  fetchedAt?: string;
  staleReason?: string;
  rawStatus?: string;
  routeResult?: InvestorFlowRouteResult;
}

export interface PerSymbolSupplyInjectionStats {
  totalCandidates: number;
  requestedSymbols: number;
  receivedResults: number;
  injected: number;
  verified: number;
  degraded: number;
  stale: number;
  missing: number;
  unknown: number;
  routerConnected: boolean;
  gateContextConnected: boolean;
}

export interface CandidateWithSupplyContext {
  symbol?: string;
  code?: string;
  preflight?: Record<string, unknown> & { supplyContext?: PerSymbolSupplyContext };
  gateContext?: Record<string, unknown> & { supplyContext?: PerSymbolSupplyContext };
  scoringContext?: Record<string, unknown> & { supplyContext?: PerSymbolSupplyContext };
  supplyContext?: PerSymbolSupplyContext;
  supplyProviderHealth?: Partial<SupplyProviderHealthTrace>;
}

export function normalizeSupplySymbol(value: unknown): string {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits;
}

function providerFromRoute(source: InvestorFlowRouteResult['source']): PerSymbolSupplyContext['provider'] {
  if (source === 'KIS_API') return 'KIS_API';
  if (source === 'KRX_INVESTOR_FLOW') return 'KRX';
  if (source === 'CACHE') return 'CACHE';
  return 'NONE';
}

function statusFromRoute(route: InvestorFlowRouteResult): InvestorFlowResult['status'] {
  if (route.data && route.status === 'OK') return 'VERIFIED';
  if (route.status === 'PROVIDER_UNAVAILABLE') return 'DEGRADED';
  return 'MISSING';
}

function resultFromRoute(symbol: string, route: InvestorFlowRouteResult, now: Date): InvestorFlowResult {
  const data = route.data;
  return {
    symbol,
    status: statusFromRoute(route),
    provider: providerFromRoute(route.source),
    foreignNetBuyAmount: data?.foreignNetBuy,
    institutionNetBuyAmount: data?.institutionalNetBuy,
    investorNetBuyAmount: data ? data.foreignNetBuy + data.institutionalNetBuy : undefined,
    fetchedAt: data?.fetchedAt ?? now.toISOString(),
    rawStatus: route.status,
    routeResult: route,
  };
}

export function createDefaultInvestorFlowRouter(now = new Date()): {
  fetchForSymbols: (symbols: string[]) => Promise<InvestorFlowResult[]>;
} {
  return {
    fetchForSymbols: async (symbols: string[]) => {
      const unique = [...new Set(symbols.map(normalizeSupplySymbol).filter(Boolean))];
      const settled = await Promise.allSettled(
        unique.map(async (symbol) => resultFromRoute(symbol, await fetchInvestorFlowWithPolicy(symbol, now), now)),
      );
      return settled.map((item, idx) => item.status === 'fulfilled'
        ? item.value
        : {
            symbol: unique[idx] ?? '',
            status: 'MISSING',
            provider: 'NONE',
            fetchedAt: now.toISOString(),
            rawStatus: item.reason instanceof Error ? item.reason.message : String(item.reason),
          });
    },
  };
}

export async function injectPerSymbolSupplyContext<T extends CandidateWithSupplyContext>(params: {
  candidates: T[];
  investorFlowRouter: {
    fetchForSymbols: (symbols: string[]) => Promise<InvestorFlowResult[]>;
  };
  now?: Date;
}): Promise<{ candidates: T[]; stats: PerSymbolSupplyInjectionStats }> {
  const { candidates, investorFlowRouter } = params;
  const now = params.now ?? new Date();
  const symbols = [...new Set(candidates.map(candidateSymbol).filter(Boolean))];

  if (candidates.length === 0) {
    const stats = buildStats(candidates, [], symbols, true);
    logStats(stats);
    return { candidates, stats };
  }

  let flowResults: InvestorFlowResult[] = [];
  let routerConnected = true;

  try {
    flowResults = await investorFlowRouter.fetchForSymbols(symbols);
  } catch (error) {
    routerConnected = false;
    flowResults = [];
    logger.warn('[PER_SYMBOL_SUPPLY_CONTEXT_INJECTION_ROUTER_THROW]', error instanceof Error ? error.message : String(error));
  }

  const flowMap = new Map<string, InvestorFlowResult>();
  for (const result of flowResults) {
    const key = normalizeSupplySymbol(result?.symbol);
    if (key) flowMap.set(key, result);
  }

  for (const candidate of candidates) {
    const symbol = candidateSymbol(candidate);
    const flow = symbol ? flowMap.get(symbol) : undefined;
    const supplyContext = classifyPerSymbolSupplyContext({
      symbol,
      flow,
      now,
      missingReason: routerConnected ? 'NO_PER_SYMBOL_INVESTOR_FLOW_RESULT' : 'INVESTOR_FLOW_ROUTER_THROW',
    });
    candidate.preflight = {
      ...(candidate.preflight ?? {}),
      supplyContext,
    };
    candidate.gateContext = mergeCandidateSupplyContext(candidate.gateContext, supplyContext);
    candidate.scoringContext = mergeCandidateSupplyContext(candidate.scoringContext, supplyContext);
    candidate.supplyContext = supplyContext;
    candidate.supplyProviderHealth = supplyContextToHealthTrace(supplyContext, candidate.supplyProviderHealth);
  }

  const stats = buildStats(candidates, flowResults, symbols, routerConnected);
  logStats(stats);
  return { candidates, stats };
}

function candidateSymbol(candidate: CandidateWithSupplyContext): string {
  return normalizeSupplySymbol(candidate.symbol ?? candidate.code);
}

function mergeCandidateSupplyContext(
  context: CandidateWithSupplyContext['gateContext'] | CandidateWithSupplyContext['scoringContext'],
  supplyContext: PerSymbolSupplyContext,
): Record<string, unknown> & { supplyContext: PerSymbolSupplyContext } {
  return {
    ...(context ?? {}),
    supplyContext,
    supplyProviderHealth: supplyContext.supplyProviderHealth,
    supplySignal: supplyContext.supplySignal,
    providerIssue: supplyContext.providerIssue,
    marketSignal: supplyContext.marketSignal,
    executionImpact: supplyContext.executionImpact,
  };
}

function classifyPerSymbolSupplyContext(params: {
  symbol: string;
  flow?: InvestorFlowResult;
  now: Date;
  missingReason: string;
}): PerSymbolSupplyContext {
  const { symbol, flow, now } = params;

  if (!flow) {
    return buildMissingSupplyContext({ symbol, reason: params.missingReason, now });
  }

  if (flow.status === 'VERIFIED') {
    return {
      symbol,
      provider: normalizeProvider(flow.provider, 'KIS_API'),
      supplyProviderHealth: 'VERIFIED',
      supplySignal: deriveSupplySignal(flow),
      providerIssue: false,
      marketSignal: true,
      executionImpact: 'NONE',
      investorNetBuyAmount: flow.investorNetBuyAmount,
      foreignNetBuyAmount: flow.foreignNetBuyAmount,
      institutionNetBuyAmount: flow.institutionNetBuyAmount,
      programNetBuyAmount: flow.programNetBuyAmount,
      nonProgramNetBuyAmount: flow.nonProgramNetBuyAmount,
      fetchedAt: flow.fetchedAt ?? now.toISOString(),
      rawStatus: flow.rawStatus ?? flow.status,
    };
  }

  if (flow.status === 'STALE') {
    return {
      symbol,
      provider: normalizeProvider(flow.provider, 'CACHE'),
      supplyProviderHealth: 'STALE',
      supplySignal: 'UNUSABLE',
      providerIssue: true,
      marketSignal: false,
      executionImpact: 'NONE',
      fetchedAt: flow.fetchedAt,
      staleReason: flow.staleReason ?? 'STALE_INVESTOR_FLOW',
      rawStatus: flow.rawStatus ?? flow.status,
    };
  }

  if (flow.status === 'DEGRADED') {
    return {
      symbol,
      provider: normalizeProvider(flow.provider, 'KIS_API'),
      supplyProviderHealth: 'DEGRADED',
      supplySignal: deriveSupplySignal(flow),
      providerIssue: true,
      marketSignal: false,
      executionImpact: 'NONE',
      fetchedAt: flow.fetchedAt ?? now.toISOString(),
      rawStatus: flow.rawStatus ?? flow.status,
    };
  }

  return buildMissingSupplyContext({
    symbol,
    reason: flow.rawStatus ?? flow.status ?? 'UNCLASSIFIED_INVESTOR_FLOW_STATUS',
    now,
  });
}

function normalizeProvider(value: unknown, fallback: PerSymbolSupplyContext['provider']): PerSymbolSupplyContext['provider'] {
  if (value === 'KIS_API') return 'KIS_API';
  if (value === 'KRX' || value === 'KRX_INVESTOR_FLOW') return 'KRX';
  if (value === 'CACHE') return 'CACHE';
  if (value === 'NONE') return 'NONE';
  return fallback;
}

function buildMissingSupplyContext(params: {
  symbol: string;
  reason: string;
  now: Date;
}): PerSymbolSupplyContext {
  return {
    symbol: params.symbol,
    provider: 'NONE',
    supplyProviderHealth: 'MISSING',
    supplySignal: 'UNUSABLE',
    providerIssue: true,
    marketSignal: false,
    executionImpact: 'NONE',
    fetchedAt: params.now.toISOString(),
    rawStatus: params.reason,
  };
}

function deriveSupplySignal(flow: InvestorFlowResult): SupplySignal {
  const foreign = flow.foreignNetBuyAmount ?? 0;
  const institution = flow.institutionNetBuyAmount ?? 0;
  const program = flow.programNetBuyAmount ?? 0;
  const nonProgram = flow.nonProgramNetBuyAmount ?? 0;
  const smartMoneyScore =
    scorePositive(foreign) +
    scorePositive(institution) +
    scorePositive(program) +
    scorePositive(nonProgram);

  if (smartMoneyScore >= 3) return 'BULLISH';
  if (smartMoneyScore <= 0 && foreign < 0 && institution < 0) return 'BEARISH';
  return 'NEUTRAL';
}

function scorePositive(value: number): number {
  return value > 0 ? 1 : 0;
}

function supplyContextToHealthTrace(
  ctx: PerSymbolSupplyContext,
  existing?: Partial<SupplyProviderHealthTrace>,
): Partial<SupplyProviderHealthTrace> {
  return {
    ...(existing ?? {}),
    status: ctx.supplyProviderHealth === 'MISSING' ? 'MISSING' : ctx.supplyProviderHealth,
    providerName: ctx.provider === 'NONE' ? 'investor-flow' : ctx.provider,
    lastSampleAt: ctx.fetchedAt,
    sampleCountRecent: ctx.supplyProviderHealth === 'VERIFIED' ? 1 : 0,
    hasForeignFlow: ctx.foreignNetBuyAmount !== undefined,
    hasInstitutionFlow: ctx.institutionNetBuyAmount !== undefined,
    hasProgramFlow: ctx.programNetBuyAmount !== undefined,
    providerIssue: ctx.providerIssue,
    marketSignal: ctx.marketSignal,
    gate1Severity: ctx.supplyProviderHealth === 'VERIFIED' ? 'NONE' : 'SOFT_FAIL',
    requestSymbol: ctx.symbol,
    candidateSymbol: ctx.symbol,
    normalizedSymbol: ctx.symbol,
    providerScope: 'SYMBOL_LEVEL',
    routePurpose: 'BUY_CANDIDATE_PREFLIGHT',
    materialized: ctx.supplyProviderHealth === 'VERIFIED',
    usableForRouter: ctx.supplyProviderHealth === 'VERIFIED',
    usableForGate: false,
    usableForLive: false,
    usableForShadow: true,
    semanticNetBuyStatus: ctx.rawStatus,
    semanticNetBuySignal: ctx.supplySignal === 'UNUSABLE' ? 'UNKNOWN' : ctx.supplySignal,
    diagnostics: [
      `perSymbolSupplyContext=${ctx.supplyProviderHealth}`,
      `executionImpact=${ctx.executionImpact}`,
      ...(ctx.staleReason ? [`staleReason=${ctx.staleReason}`] : []),
    ],
    reason: [
      ctx.supplyProviderHealth === 'VERIFIED'
        ? 'per-symbol investor-flow verified'
        : `per-symbol investor-flow ${ctx.supplyProviderHealth.toLowerCase()}: ${ctx.rawStatus ?? 'n/a'}`,
    ],
  };
}

function buildStats(
  candidates: CandidateWithSupplyContext[],
  flowResults: InvestorFlowResult[],
  symbols: string[],
  routerConnected: boolean,
): PerSymbolSupplyInjectionStats {
  const counts = { verified: 0, degraded: 0, stale: 0, missing: 0, unknown: 0 };
  let gateContextConnected = candidates.length > 0;
  for (const candidate of candidates) {
    const health = candidate.preflight?.supplyContext?.supplyProviderHealth;
    const gateHealth = candidate.gateContext?.supplyContext?.supplyProviderHealth;
    const scoringHealth = candidate.scoringContext?.supplyContext?.supplyProviderHealth;
    if (!health || !gateHealth || !scoringHealth) gateContextConnected = false;
    if (health === 'VERIFIED') counts.verified += 1;
    else if (health === 'DEGRADED') counts.degraded += 1;
    else if (health === 'STALE') counts.stale += 1;
    else if (health === 'MISSING') counts.missing += 1;
    else counts.unknown += 1;
  }
  return {
    totalCandidates: candidates.length,
    requestedSymbols: symbols.length,
    receivedResults: flowResults.length,
    injected: counts.verified,
    ...counts,
    routerConnected,
    gateContextConnected,
  };
}

function logStats(stats: PerSymbolSupplyInjectionStats): void {
  const traceId = createTraceId('supply_context');
  logVisibilityEvent({
    visibility: 'DIAGNOSTIC',
    category: 'SUPPLY',
    sourceCommand: '/scan',
    traceId,
    message:
      `[PER_SYMBOL_SUPPLY_CONTEXT_INJECTION_SUMMARY] ` +
      `totalCandidates=${stats.totalCandidates} requestedSymbols=${stats.requestedSymbols} ` +
      `receivedResults=${stats.receivedResults} injected=${stats.injected} verified=${stats.verified} ` +
      `degraded=${stats.degraded} stale=${stats.stale} missing=${stats.missing} unknown=${stats.unknown} ` +
      `routerConnected=${stats.routerConnected} gateContextConnected=${stats.gateContextConnected} ` +
      `executionImpact=NONE traceId=${traceId}`,
    summary: { ...stats, executionImpact: 'NONE' },
    details: { stats },
    level: 'info',
    executionImpact: 'NONE',
  });
  logVisibilityEvent({
    visibility: 'TRACE',
    category: 'SUPPLY',
    sourceCommand: '/scan',
    traceId,
    message: `[PER_SYMBOL_SUPPLY_CONTEXT_INJECTION] traceId=${traceId} payloadHidden=true executionImpact=NONE`,
    summary: { totalCandidates: stats.totalCandidates, injected: stats.injected, verified: stats.verified, executionImpact: 'NONE' },
    details: { stats },
    level: 'info',
    executionImpact: 'NONE',
  });
  logger.info(
    `[AutoTrade/SupplyHealth] preflight context investor-flow connected ` +
      `buyList=${stats.totalCandidates} VERIFIED=${stats.verified} DEGRADED=${stats.degraded} ` +
      `STALE=${stats.stale} MISSING=${stats.missing} UNKNOWN=${stats.unknown} ` +
      `executionImpact=NONE engineAlive=true shadowLearning=true`,
  );
}
