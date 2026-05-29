// @responsibility Macro data source health classification for regime snapshots; shortSelling freshness is trading-day-aware.
import type { MacroState } from '../../persistence/macroStateRepo.js';
import type { RegimeDataHealth } from './effectiveRegimeSnapshot.js';
import { tradingDayDistanceAdr0483 } from '../signalScanner/supplySourceFreshnessAdr0483.js';

const DEFAULT_STALE_SEC = 36 * 60 * 60;

/**
 * ADR-0190/ADR-0483 정합: KRX 공매도(shortSelling)는 일 1회 장후 발표 + T+1 지연 데이터라
 * 36h 캘린더-flat 임계로는 주말·휴장 갭에서 정상 지연을 STALE 로 오판한다.
 * 직전 거래일 발표 기준 + 주말/공휴일 갭 허용을 위해 거래일 거리 2영업일까지 FRESH 로 본다.
 * 그보다 더 오래(진짜 endpoint outage)면 STALE 유지 → 불변식 #6(provider≠bearish) 보존:
 * STALE/FRESH 모두 confidence/ExecutionPermission 만 영향, marketSignal/SourceSnapshot 불변.
 */
const SHORT_SELLING_STALE_TRADING_DAYS = 2;

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

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * shortSelling 전용 거래일-aware freshness 판정 (ADR-0190 거래일 달력 + ADR-0483 거래일 거리 재사용).
 * fetchedAt(마지막 성공 시각) 의 날짜와 now 사이의 거래일 거리가 staleTradingDays 이내면 FRESH.
 *   - 주말/공휴일 갭은 거래일 거리에 포함되지 않으므로 정상 T+1 지연을 STALE 로 오판하지 않는다.
 *   - 2영업일 초과(진짜 endpoint outage)면 STALE 유지.
 * fetchedAt 미존재 시(자체 timestamp 없음) 기존 36h flat 임계로 폴백.
 */
function shortSellingTimestampHealth(
  fetchedAt: string | undefined,
  now: Date,
  staleTradingDays = SHORT_SELLING_STALE_TRADING_DAYS,
): RegimeDataHealth {
  if (!fetchedAt) return 'VERIFIED';
  const ms = Date.parse(fetchedAt);
  if (!Number.isFinite(ms)) return 'DEGRADED';
  const distance = tradingDayDistanceAdr0483(ymd(new Date(ms)), ymd(now));
  return distance > staleTradingDays ? 'STALE' : 'VERIFIED';
}

function classifySource(input: {
  source: Record<string, unknown>;
  valueKeys: string[];
  timestampKeys?: string[];
  sourceKeys?: string[];
  staleSec?: number;
  now: Date;
  /**
   * 거래일-aware 자체 timestamp 키 (예 shortSellingFetchedAt). 지정·존재 시
   * 거래일 거리 기반 판정(shortSellingTimestampHealth) 적용. 미존재 시 timestampKeys 36h 폴백.
   */
  tradingDayAwareTimestampKey?: string;
}): RegimeDataHealth {
  const hasValue = hasAnyNumber(input.source, input.valueKeys);
  if (!hasValue) return 'MISSING';

  const provider = input.sourceKeys ? readString(input.source, input.sourceKeys) : undefined;
  if (provider === 'NONE' || provider === 'FAILED' || provider === 'MISSING') return 'DEGRADED';

  if (input.tradingDayAwareTimestampKey) {
    const ownTimestamp = readString(input.source, [input.tradingDayAwareTimestampKey]);
    if (ownTimestamp) return shortSellingTimestampHealth(ownTimestamp, input.now);
  }

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
      tradingDayAwareTimestampKey: 'shortSellingFetchedAt',
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
