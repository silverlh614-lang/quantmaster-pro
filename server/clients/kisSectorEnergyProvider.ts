// @responsibility KIS official/basket SectorEnergy provider (read-only, shadow-safe)

import { fetchKisDailyCandles, type KisChartCandle } from '../screener/kisChartDataFetcher.js';
import { SECTOR_INDEX_MASTER, type SectorKey } from './sectorEnergyMaster.js';
import type { KisInvestorTradeByStockDaily } from './kisClient/index.js';
import type { SectorEnergyDataQuality, SectorEnergyInput } from './sectorEnergyProvider.js';

export type KisSectorEnergySourceTier =
  | 'KIS_OFFICIAL_INDEX'
  | 'KIS_OFFICIAL_DAILY'
  | 'KIS_STOCK_BASKET_DERIVED'
  | 'MISSING';

export type KisSectorEnergyLeadershipConfidence =
  | 'WEIGHTED'
  | 'READY_FOR_SHADOW'
  | 'PARTIAL'
  | 'BLOCKED';

export interface KisSectorEnergyCoverageBreakdown {
  totalSectors: number;
  verifiedIndexCodeCount: number;
  verifiedIndexCodeCoverage: number;
  kisOfficialCount: number;
  kisOfficialCoverage: number;
  kisBasketCount: number;
  kisBasketCoverage: number;
  internalProxyCount: number;
  internalProxyCoverage: number;
  stockDailyFallbackCount: number;
  stockDailyFallbackCoverage: number;
  yahooGlobalProxyCount: number;
  yahooGlobalProxyCoverage: number;
}

export interface KisSectorBasketRow {
  sectorKey: string;
  displayName: string;
  representativeCodes: string[];
  validPriceCount: number;
  return1d?: number;
  return5d?: number;
  return20d?: number;
  turnoverAcceleration?: number;
  breadthAbove20ma?: number;
  source: 'KIS_PRICE' | 'KIS_DAILY_CHART';
  confidence: 'PARTIAL' | 'VERIFIED';
}

export interface KisSectorEnergyIndexRow {
  sectorKey: SectorKey;
  sectorReturn5d: number;
  sectorReturn20d: number;
  turnoverAcceleration?: number;
  breadthAbove20ma?: number;
  foreignInstitutionFlowAlignment?: number;
  sectorRelativeStrengthVsKospi?: number;
  sectorRelativeStrengthVsKosdaq?: number;
  leadingStockCount?: number;
  topConstituentMomentum?: number;
  sourceTier?: Extract<KisSectorEnergySourceTier, 'KIS_OFFICIAL_INDEX' | 'KIS_OFFICIAL_DAILY'>;
}

export interface KisSectorEnergyProviderOverrides {
  fetchOfficialIndexRows?: () => Promise<KisSectorEnergyIndexRow[]>;
  fetchOfficialDailyRows?: () => Promise<KisSectorEnergyIndexRow[]>;
  fetchCandles?: (code: string) => Promise<KisChartCandle[]>;
  fetchInvestorFlow?: (code: string) => Promise<KisInvestorTradeByStockDaily | null>;
  now?: () => Date;
}

export interface KisSectorEnergyProviderResult {
  inputs: SectorEnergyInput[];
  dataQuality: SectorEnergyDataQuality;
  validSectorCount: number;
  totalSectorCount: number;
  sourceTier: KisSectorEnergySourceTier;
  confidence: number;
  leadershipConfidence: KisSectorEnergyLeadershipConfidence;
  coverageBreakdown: KisSectorEnergyCoverageBreakdown;
  selectedSectors: string[];
  providerIssue: boolean;
  marketSignal: false;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  reasons: string[];
  diagnostics: string[];
}

const TOTAL_SECTOR_COUNT = SECTOR_INDEX_MASTER.length;

export const KIS_REPRESENTATIVE_SECTOR_BASKET: Readonly<Record<string, readonly string[]>> = Object.freeze({
  SHIPBUILDING: ['329180', '042660', '010140', '009540'],
  DEFENSE: ['012450', '064350', '079550', '047810'],
  NUCLEAR: ['034020', '010120', '051600', '052690'],
  SEMICONDUCTOR: ['005930', '000660', '042700', '039030'],
  AUTOMOTIVE: ['005380', '000270', '012330', '161390'],
  BATTERY: ['373220', '051910', '006400', '247540'],
  BIO_HEALTHCARE: ['207940', '068270', '326030', '128940'],
  FINANCE: ['105560', '055550', '086790', '316140'],
  CHEMICAL: ['096770', '010950', '051910', '011170'],
  STEEL: ['005490', '004020', '010130', '016380'],
  CONSTRUCTION: ['000720', '028050', '047040', '006360'],
  CONSUMER_RETAIL: ['023530', '004170', '097950', '271560'],
  IT_INTERNET: ['035420', '035720', '036570', '259960'],
  OTHER: ['003550', '034730', '012750', '010120'],
});

const KIS_SECTOR_BASKET_DEFINITIONS: ReadonlyArray<{ sectorKey: string; displayName: string; representativeCodes: readonly string[] }> = Object.freeze([
  { sectorKey: 'SHIPBUILDING', displayName: '조선', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.SHIPBUILDING },
  { sectorKey: 'DEFENSE', displayName: '방산', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.DEFENSE },
  { sectorKey: 'NUCLEAR', displayName: '원자력', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.NUCLEAR },
  { sectorKey: 'SEMICONDUCTOR', displayName: '반도체', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.SEMICONDUCTOR },
  { sectorKey: 'AUTOMOTIVE', displayName: '자동차', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.AUTOMOTIVE },
  { sectorKey: 'BATTERY', displayName: '2차전지', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.BATTERY },
  { sectorKey: 'BIO_HEALTHCARE', displayName: '바이오', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.BIO_HEALTHCARE },
  { sectorKey: 'FINANCE', displayName: '금융', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.FINANCE },
  { sectorKey: 'CHEMICAL', displayName: '화학', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.CHEMICAL },
  { sectorKey: 'STEEL', displayName: '철강', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.STEEL },
  { sectorKey: 'CONSTRUCTION', displayName: '건설', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.CONSTRUCTION },
  { sectorKey: 'CONSUMER_RETAIL', displayName: '유통', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.CONSUMER_RETAIL },
]);

let overridesForTests: KisSectorEnergyProviderOverrides = {};

export function setKisSectorEnergyProviderOverridesForTests(overrides: KisSectorEnergyProviderOverrides): void {
  overridesForTests = { ...overrides };
}

export function resetKisSectorEnergyProviderOverridesForTests(): void {
  overridesForTests = {};
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function avg(values: number[]): number {
  const finiteValues = values.filter(finite);
  if (finiteValues.length === 0) return 0;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function pctChange(from: number, to: number): number {
  if (!finite(from) || from <= 0 || !finite(to)) return 0;
  return ((to - from) / from) * 100;
}

function safeCode(code: string): string {
  const digits = code.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, '0');
}

function sectorName(sectorKey: string): string {
  return SECTOR_INDEX_MASTER.find((entry) => entry.sectorKey === sectorKey)?.displayName ?? sectorKey;
}

function coverageBreakdown(input: Partial<KisSectorEnergyCoverageBreakdown>): KisSectorEnergyCoverageBreakdown {
  const total = input.totalSectors ?? TOTAL_SECTOR_COUNT;
  const count = (value: number | undefined) => Math.max(0, Math.floor(value ?? 0));
  const ratio = (value: number | undefined) => total > 0 ? clamp(count(value) / total, 0, 1) : 0;
  return {
    totalSectors: total,
    verifiedIndexCodeCount: count(input.verifiedIndexCodeCount),
    verifiedIndexCodeCoverage: input.verifiedIndexCodeCoverage ?? ratio(input.verifiedIndexCodeCount),
    kisOfficialCount: count(input.kisOfficialCount),
    kisOfficialCoverage: input.kisOfficialCoverage ?? ratio(input.kisOfficialCount),
    kisBasketCount: count(input.kisBasketCount),
    kisBasketCoverage: input.kisBasketCoverage ?? ratio(input.kisBasketCount),
    internalProxyCount: count(input.internalProxyCount),
    internalProxyCoverage: input.internalProxyCoverage ?? ratio(input.internalProxyCount),
    stockDailyFallbackCount: count(input.stockDailyFallbackCount),
    stockDailyFallbackCoverage: input.stockDailyFallbackCoverage ?? ratio(input.stockDailyFallbackCount),
    yahooGlobalProxyCount: count(input.yahooGlobalProxyCount),
    yahooGlobalProxyCoverage: input.yahooGlobalProxyCoverage ?? ratio(input.yahooGlobalProxyCount),
  };
}

function leadershipPhase(return5d: number, return20d: number, breadth: number): 'EARLY' | 'MID' | 'LATE' | 'UNKNOWN' {
  if (!finite(return5d) || !finite(return20d)) return 'UNKNOWN';
  if (return5d > 0 && return20d <= 5) return 'EARLY';
  if (return20d > 5 && breadth >= 60) return 'MID';
  if (return20d > 10 && breadth < 50) return 'LATE';
  return 'UNKNOWN';
}

function scoreForRanking(input: SectorEnergyInput): number {
  return (
    (input.sectorReturn5d ?? 0) * 0.30 +
    (input.sectorReturn20d ?? 0) * 0.25 +
    (input.turnoverAcceleration ?? 0) * 0.20 +
    (input.breadthAbove20ma ?? 0) * 0.15 +
    (input.foreignInstitutionFlowAlignment ?? 0) * 0.10
  );
}

export function rankKisSectorEnergyInputs(inputs: SectorEnergyInput[]): SectorEnergyInput[] {
  return [...inputs].sort((a, b) => scoreForRanking(b) - scoreForRanking(a));
}

function stockMetrics(candles: KisChartCandle[]): {
  return1d: number;
  return5d: number;
  return20d: number;
  turnoverAcceleration: number;
  above20ma: boolean;
  latestVolume: number;
} | null {
  const rows = [...candles]
    .filter((c) => finite(c.close) && c.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 6) return null;

  const latest = rows[rows.length - 1]!;
  const oneAgo = rows[Math.max(0, rows.length - 2)]!;
  const fiveAgo = rows[Math.max(0, rows.length - 6)]!;
  const twentyAgo = rows[Math.max(0, rows.length - 21)]!;
  const last20 = rows.slice(Math.max(0, rows.length - 20));
  const prev20 = rows.slice(Math.max(0, rows.length - 40), Math.max(0, rows.length - 20));
  const last5 = rows.slice(Math.max(0, rows.length - 5));
  const avgVol5 = avg(last5.map((c) => c.volume));
  const avgVol20 = avg((prev20.length > 0 ? prev20 : last20).map((c) => c.volume));
  const ma20 = avg(last20.map((c) => c.close));

  return {
    return1d: pctChange(oneAgo.close, latest.close),
    return5d: pctChange(fiveAgo.close, latest.close),
    return20d: pctChange(twentyAgo.close, latest.close),
    turnoverAcceleration: avgVol20 > 0 ? pctChange(avgVol20, avgVol5) : 0,
    above20ma: ma20 > 0 && latest.close > ma20,
    latestVolume: latest.volume,
  };
}

function flowAlignment(flows: Array<KisInvestorTradeByStockDaily | null | undefined>): number {
  const finiteScores: number[] = [];
  for (const flow of flows) {
    if (!flow) continue;
    const net = (flow.foreignNetBuy ?? 0) + (flow.institutionalNetBuy ?? 0);
    if (!finite(net)) continue;
    finiteScores.push(net > 0 ? 100 : net < 0 ? 0 : 50);
  }
  if (finiteScores.length === 0) return 0;
  return avg(finiteScores);
}

function inputFromMetrics(
  sectorKey: string,
  displayName: string,
  metrics: Array<ReturnType<typeof stockMetrics>>,
  codes: string[],
  flowScore: number,
): SectorEnergyInput | null {
  const valid = metrics.filter((item): item is NonNullable<typeof item> => item !== null);
  if (valid.length === 0) return null;
  const sectorReturn5d = avg(valid.map((item) => item.return5d));
  const sectorReturn20d = avg(valid.map((item) => item.return20d));
  const turnoverAcceleration = avg(valid.map((item) => item.turnoverAcceleration));
  const breadthAbove20ma = (valid.filter((item) => item.above20ma).length / valid.length) * 100;
  const topConstituentMomentum = Math.max(...valid.map((item) => item.return5d));
  const leadingStockCount = valid.filter((item) => item.return5d > 0 && item.above20ma).length;
  return {
    name: displayName,
    return4w: sectorReturn20d,
    volumeChangePct: turnoverAcceleration,
    foreignConcentration: flowScore,
    sourceTier: 'KIS_STOCK_BASKET_DERIVED',
    sectorReturn5d,
    sectorReturn20d,
    turnoverAcceleration,
    breadthAbove20ma,
    foreignInstitutionFlowAlignment: flowScore,
    sectorVolumeSurge: turnoverAcceleration >= 30,
    sectorBreadth: breadthAbove20ma,
    leadingStockCount,
    topConstituentMomentum,
    leadershipPhase: leadershipPhase(sectorReturn5d, sectorReturn20d, breadthAbove20ma),
    constituentCount: valid.length,
    basketCodes: codes,
  };
}


export function buildKisSectorBasketRowsFromSeries(
  seriesByCode: Record<string, KisChartCandle[]>,
): KisSectorBasketRow[] {
  const rows: KisSectorBasketRow[] = [];
  for (const entry of KIS_SECTOR_BASKET_DEFINITIONS) {
    const codes = entry.representativeCodes.map(safeCode);
    const metrics = codes
      .map((code) => stockMetrics(seriesByCode[code] ?? []))
      .filter((item): item is NonNullable<ReturnType<typeof stockMetrics>> => item !== null);
    if (metrics.length === 0) continue;
    rows.push({
      sectorKey: entry.sectorKey,
      displayName: entry.displayName,
      representativeCodes: codes,
      validPriceCount: metrics.length,
      return1d: avg(metrics.map((item) => item.return1d)),
      return5d: avg(metrics.map((item) => item.return5d)),
      return20d: avg(metrics.map((item) => item.return20d)),
      turnoverAcceleration: avg(metrics.map((item) => item.turnoverAcceleration)),
      breadthAbove20ma: (metrics.filter((item) => item.above20ma).length / metrics.length) * 100,
      source: 'KIS_DAILY_CHART',
      confidence: 'PARTIAL',
    });
  }
  return rows;
}

export function buildKisSectorEnergyBasketFromSeries(
  seriesByCode: Record<string, KisChartCandle[]>,
  flowByCode: Record<string, KisInvestorTradeByStockDaily | null | undefined> = {},
): SectorEnergyInput[] {
  const inputs: SectorEnergyInput[] = [];
  for (const entry of KIS_SECTOR_BASKET_DEFINITIONS) {
    const codes = entry.representativeCodes.map(safeCode);
    const metrics = codes.map((code) => stockMetrics(seriesByCode[code] ?? []));
    const flowScore = flowAlignment(codes.map((code) => flowByCode[code]));
    const input = inputFromMetrics(entry.sectorKey, entry.displayName, metrics, codes, flowScore);
    if (input) inputs.push(input);
  }

  const marketReturn20 = avg(inputs.map((input) => input.sectorReturn20d ?? 0));
  const turnoverRanks = rankKisSectorEnergyInputs(inputs)
    .map((input, idx) => [input.name, idx + 1] as const);
  const rankByName = new Map(turnoverRanks);
  return inputs.map((input) => ({
    ...input,
    sectorRelativeStrengthVsKospi: (input.sectorReturn20d ?? 0) - marketReturn20,
    sectorRelativeStrengthVsKosdaq: (input.sectorReturn20d ?? 0) - marketReturn20,
    turnoverRank: rankByName.get(input.name) ?? 0,
  }));
}

function inputFromOfficialRow(row: KisSectorEnergyIndexRow): SectorEnergyInput {
  const breadth = row.breadthAbove20ma ?? 0;
  return {
    name: sectorName(row.sectorKey),
    return4w: row.sectorReturn20d,
    volumeChangePct: row.turnoverAcceleration ?? 0,
    foreignConcentration: row.foreignInstitutionFlowAlignment ?? 0,
    sourceTier: row.sourceTier ?? 'KIS_OFFICIAL_INDEX',
    sectorReturn5d: row.sectorReturn5d,
    sectorReturn20d: row.sectorReturn20d,
    turnoverAcceleration: row.turnoverAcceleration ?? 0,
    breadthAbove20ma: breadth,
    foreignInstitutionFlowAlignment: row.foreignInstitutionFlowAlignment ?? 0,
    sectorRelativeStrengthVsKospi: row.sectorRelativeStrengthVsKospi,
    sectorRelativeStrengthVsKosdaq: row.sectorRelativeStrengthVsKosdaq,
    sectorVolumeSurge: (row.turnoverAcceleration ?? 0) >= 30,
    sectorBreadth: breadth,
    leadingStockCount: row.leadingStockCount ?? 0,
    topConstituentMomentum: row.topConstituentMomentum ?? row.sectorReturn5d,
    leadershipPhase: leadershipPhase(row.sectorReturn5d, row.sectorReturn20d, breadth),
    constituentCount: 0,
  };
}

async function defaultOfficialIndexRows(): Promise<KisSectorEnergyIndexRow[]> {
  return [];
}

async function defaultOfficialDailyRows(): Promise<KisSectorEnergyIndexRow[]> {
  return [];
}

async function defaultFetchCandles(code: string): Promise<KisChartCandle[]> {
  return fetchKisDailyCandles(code);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      output[idx] = await worker(items[idx]!);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => run());
  await Promise.all(workers);
  return output;
}

function resultFromInputs(
  inputs: SectorEnergyInput[],
  sourceTier: KisSectorEnergySourceTier,
  reasons: string[],
): KisSectorEnergyProviderResult {
  const validSectorCount = inputs.length;
  const selectedSectors = rankKisSectorEnergyInputs(inputs).slice(0, 3).map((input) => String(input.name));
  const dataQuality: SectorEnergyDataQuality =
    sourceTier === 'KIS_STOCK_BASKET_DERIVED'
      ? (validSectorCount >= 9 ? 'PARTIAL' : validSectorCount > 0 ? 'STALE' : 'FAILED')
      : validSectorCount >= TOTAL_SECTOR_COUNT ? 'OK' : validSectorCount >= 9 ? 'PARTIAL' : validSectorCount > 0 ? 'STALE' : 'FAILED';
  const confidence =
    sourceTier === 'KIS_OFFICIAL_INDEX' || sourceTier === 'KIS_OFFICIAL_DAILY'
      ? clamp(validSectorCount / TOTAL_SECTOR_COUNT, 0, 1)
      : sourceTier === 'KIS_STOCK_BASKET_DERIVED'
        ? clamp(0.75 * (validSectorCount / TOTAL_SECTOR_COUNT), 0, 1)
        : 0;
  const leadershipConfidence: KisSectorEnergyLeadershipConfidence =
    sourceTier === 'KIS_OFFICIAL_INDEX' || sourceTier === 'KIS_OFFICIAL_DAILY'
      ? 'WEIGHTED'
      : sourceTier === 'KIS_STOCK_BASKET_DERIVED' && validSectorCount > 0
        ? 'READY_FOR_SHADOW'
        : 'BLOCKED';
  const breakdown = coverageBreakdown({
    verifiedIndexCodeCount: 0,
    kisOfficialCount: sourceTier === 'KIS_OFFICIAL_INDEX' || sourceTier === 'KIS_OFFICIAL_DAILY' ? validSectorCount : 0,
    kisBasketCount: sourceTier === 'KIS_STOCK_BASKET_DERIVED' ? validSectorCount : 0,
  });
  return {
    inputs,
    dataQuality,
    validSectorCount,
    totalSectorCount: TOTAL_SECTOR_COUNT,
    sourceTier,
    confidence,
    leadershipConfidence,
    coverageBreakdown: breakdown,
    selectedSectors,
    providerIssue: validSectorCount === 0,
    marketSignal: false,
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    reasons,
    diagnostics: [
      `sourceTier=${sourceTier}`,
      `validSectorCount=${validSectorCount}/${TOTAL_SECTOR_COUNT}`,
      `leadershipConfidence=${leadershipConfidence}`,
      'officialSource=KIS_API',
      'officialIndex=false',
      'sectorBoostAllowed=false',
      'strongBuyAllowed=false',
      'sourcePolicy=KIS_STOCK_BASKET_DERIVED',
      'liveExecutionAllowed=false',
      'executionImpact=NONE',
    ],
  };
}

export async function buildKisSectorEnergyInputsWithMeta(
  overrides: KisSectorEnergyProviderOverrides = {},
): Promise<KisSectorEnergyProviderResult> {
  const used = { ...overridesForTests, ...overrides };

  const fetchOfficialIndexRows = used.fetchOfficialIndexRows ?? defaultOfficialIndexRows;
  const fetchOfficialDailyRows = used.fetchOfficialDailyRows ?? defaultOfficialDailyRows;
  const fetchCandles = used.fetchCandles ?? defaultFetchCandles;
  const fetchInvestorFlow = used.fetchInvestorFlow;

  const indexRows = await fetchOfficialIndexRows().catch(() => [] as KisSectorEnergyIndexRow[]);
  const indexInputs = indexRows.map((row) => inputFromOfficialRow({ ...row, sourceTier: 'KIS_OFFICIAL_INDEX' }));
  if (indexInputs.length > 0) {
    return resultFromInputs(indexInputs, 'KIS_OFFICIAL_INDEX', [
      'KIS official sector/index quote selected before KRX indexCode validation.',
    ]);
  }

  const dailyRows = await fetchOfficialDailyRows().catch(() => [] as KisSectorEnergyIndexRow[]);
  const dailyInputs = dailyRows.map((row) => inputFromOfficialRow({ ...row, sourceTier: 'KIS_OFFICIAL_DAILY' }));
  if (dailyInputs.length > 0) {
    return resultFromInputs(dailyInputs, 'KIS_OFFICIAL_DAILY', [
      'KIS official sector/index daily chart selected before KRX indexCode validation.',
    ]);
  }

  const allCodes = Array.from(
    new Set(
      KIS_SECTOR_BASKET_DEFINITIONS
        .flatMap((entry) => entry.representativeCodes)
        .map(safeCode),
    ),
  );
  const candleEntries = await mapLimit(allCodes, 4, async (code) => {
    const candles = await fetchCandles(code).catch(() => [] as KisChartCandle[]);
    return [code, candles] as const;
  });
  const seriesByCode = Object.fromEntries(candleEntries);

  const flowByCode: Record<string, KisInvestorTradeByStockDaily | null> = {};
  if (fetchInvestorFlow) {
    const flowEntries = await mapLimit(allCodes, 4, async (code) => {
      const flow = await fetchInvestorFlow(code).catch(() => null);
      return [code, flow] as const;
    });
    Object.assign(flowByCode, Object.fromEntries(flowEntries));
  }

  const basketRows = buildKisSectorBasketRowsFromSeries(seriesByCode);
  const basketInputs = buildKisSectorEnergyBasketFromSeries(seriesByCode, flowByCode);
  if (basketInputs.length > 0) {
    return resultFromInputs(basketInputs, 'KIS_STOCK_BASKET_DERIVED', [
      'KIS official sector index unavailable; derived representative basket from official KIS daily prices.',
      `basketRows=${basketRows.length}`,
      'Basket is PARTIAL, not KRX official index.',
    ]);
  }

  return resultFromInputs([], 'MISSING', [
    'KIS sector index and representative basket returned no materialized rows.',
    'providerIssue=true; marketSignal=false',
  ]);
}
