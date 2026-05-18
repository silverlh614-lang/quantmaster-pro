// @responsibility Macro data source health classification for regime snapshots.
import type { MacroState } from '../../persistence/macroStateRepo.js';
import type { RegimeDataHealth } from './effectiveRegimeSnapshot.js';

const DEFAULT_STALE_SEC = 36 * 60 * 60;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function hasAnyNumber(source: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => finiteNumber(source[key]) !== undefined);
}

function timestampHealth(timestamp: string | undefined, now: Date, staleSec = DEFAULT_STALE_SEC): RegimeDataHealth {
  if (!timestamp) return 'VERIFIED';
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return 'DEGRADED';
  const ageSec = Math.max(0, Math.floor((now.getTime() - ms) / 1000));
  return ageSec > staleSec ? 'STALE' : 'VERIFIED';
}

function classifySource(input: {
  source: Record<string, unknown>;
  valueKeys: string[];
  timestampKeys?: string[];
  sourceKeys?: string[];
  staleSec?: number;
  now: Date;
}): RegimeDataHealth {
  const hasValue = hasAnyNumber(input.source, input.valueKeys);
  if (!hasValue) return 'MISSING';

  const provider = input.sourceKeys ? readString(input.source, input.sourceKeys) : undefined;
  if (provider === 'NONE' || provider === 'FAILED' || provider === 'MISSING') return 'DEGRADED';

  const timestamp = input.timestampKeys ? readString(input.source, input.timestampKeys) : undefined;
  return timestampHealth(timestamp, input.now, input.staleSec);
}

export function classifyMacroDataHealth(
  macro: MacroState | null,
  now: Date = new Date(),
): Record<string, RegimeDataHealth> {
  if (!macro) {
    return {
      macroState: 'MISSING',
      kospi: 'MISSING',
      usdKrw: 'MISSING',
      spx: 'MISSING',
      dxy: 'MISSING',
      vkospi: 'MISSING',
      programTrading: 'MISSING',
      shortSelling: 'MISSING',
    };
  }

  const source = macro as unknown as Record<string, unknown>;
  const macroState = timestampHealth(macro.updatedAt, now, DEFAULT_STALE_SEC);
  const usdKrwTier = readString(source, ['usdKrwDivergenceTier']);

  return {
    macroState,
    kospi: classifySource({
      source,
      valueKeys: ['kospiDayReturn', 'kospi20dReturn', 'kospiCloseReturn', 'kospiIntradayLowReturn'],
      timestampKeys: ['kospiTriggerSourceUpdatedAt', 'updatedAt'],
      now,
    }),
    usdKrw: usdKrwTier === 'NO_DATA' ? 'MISSING' : classifySource({
      source,
      valueKeys: ['usdKrw', 'usdKrwDayChange', 'usdKrw20dChange'],
      timestampKeys: ['updatedAt'],
      sourceKeys: ['usdKrwSource'],
      now,
    }),
    spx: classifySource({
      source,
      valueKeys: ['spx20dReturn'],
      timestampKeys: ['updatedAt'],
      now,
    }),
    dxy: classifySource({
      source,
      valueKeys: ['dxy5dChange'],
      timestampKeys: ['updatedAt'],
      now,
    }),
    vkospi: classifySource({
      source,
      valueKeys: ['vkospi', 'vkospiDayChange', 'vkospi5dTrend'],
      timestampKeys: ['updatedAt'],
      now,
    }),
    programTrading: classifySource({
      source,
      valueKeys: ['programNetBuyAmount', 'programArbitrageNetBuy'],
      timestampKeys: ['programFetchedAt', 'updatedAt'],
      sourceKeys: ['programSource'],
      now,
    }),
    shortSelling: classifySource({
      source,
      valueKeys: ['shortSellingRatio'],
      timestampKeys: ['shortSellingFetchedAt', 'updatedAt'],
      sourceKeys: ['shortSellingSource'],
      now,
    }),
  };
}

export function summarizeMacroDataHealth(dataHealth: Record<string, RegimeDataHealth>): RegimeDataHealth {
  const values = Object.values(dataHealth);
  if (values.length === 0 || values.every((value) => value === 'MISSING')) return 'MISSING';
  if (values.some((value) => value === 'DEGRADED' || value === 'MISSING')) return 'DEGRADED';
  if (values.some((value) => value === 'STALE')) return 'STALE';
  return 'VERIFIED';
}

export function listMacroDataHealthIssues(dataHealth: Record<string, RegimeDataHealth>): string[] {
  return Object.entries(dataHealth)
    .filter(([, status]) => status !== 'VERIFIED')
    .map(([source, status]) => `${source}:${status}`);
}
