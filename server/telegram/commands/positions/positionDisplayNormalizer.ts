// @responsibility Normalize raw source holdings into display-safe position records.

import { emitPositionOperationalWarn } from './positionOperationalWarn.js';
import type {
  NormalizedPosition,
  NormalizedPositionMode,
  NormalizedPositionSourceTag,
  PositionSourceName,
} from './positionSourceTypes.js';

export interface NormalizePositionDisplayInput {
  source: PositionSourceName | string;
  symbol?: unknown;
  code?: unknown;
  name?: unknown;
  qty?: unknown;
  avgPrice?: unknown;
  currentPrice?: unknown;
  unrealizedPnl?: unknown;
  unrealizedPnlPct?: unknown;
  sourceTag?: NormalizedPositionSourceTag;
  mode?: NormalizedPositionMode;
  id?: unknown;
  status?: unknown;
  diagnostics?: unknown;
  raw?: unknown;
}

const SOURCE_TAG_BY_SOURCE: Record<PositionSourceName, NormalizedPositionSourceTag> = {
  ShadowPositionRegistry: 'SHADOW',
  ShadowPositionLedger: 'SHADOW',
  ShadowTradeRepo: 'SHADOW',
  VirtualAccount: 'VIRTUAL',
  PaperTradeLedger: 'PAPER',
  KISLiveHolding: 'LIVE',
};

export function sourceTagForPositionSource(source: PositionSourceName | string): NormalizedPositionSourceTag {
  return SOURCE_TAG_BY_SOURCE[source as PositionSourceName] ?? 'SHADOW';
}

function modeForSourceTag(sourceTag: NormalizedPositionSourceTag): NormalizedPositionMode {
  return sourceTag === 'LIVE' ? 'LIVE' : 'SHADOW';
}

export function normalizePositionDisplay(input: NormalizePositionDisplayInput): NormalizedPosition | null {
  try {
    const symbol = normalizeSymbol(input.symbol ?? input.code);
    const qty = finitePositive(input.qty);
    if (!symbol || qty === undefined) {
      emitPositionOperationalWarn({
        code: 'P0_POSITION_DISPLAY_NORMALIZE_FAILED',
        message: 'Position display normalization failed',
        context: {
          source: input.source,
          symbol: input.symbol ?? input.code,
          qty: input.qty,
        },
      });
      return null;
    }

    const sourceTag = input.sourceTag ?? sourceTagForPositionSource(input.source);
    const mode = input.mode ?? modeForSourceTag(sourceTag);
    const name = normalizeOptionalString(input.name);
    const id = normalizeOptionalString(input.id);
    const status = normalizeOptionalString(input.status);

    return {
      symbol,
      ...(name ? { name } : {}),
      qty,
      ...(finitePositive(input.avgPrice) !== undefined ? { avgPrice: finitePositive(input.avgPrice) } : {}),
      ...(finitePositive(input.currentPrice) !== undefined ? { currentPrice: finitePositive(input.currentPrice) } : {}),
      ...(finiteNumber(input.unrealizedPnl) !== undefined ? { unrealizedPnl: finiteNumber(input.unrealizedPnl) } : {}),
      ...(finiteNumber(input.unrealizedPnlPct) !== undefined ? { unrealizedPnlPct: finiteNumber(input.unrealizedPnlPct) } : {}),
      sourceTag,
      mode,
      source: input.source,
      ...(id ? { id } : {}),
      ...(status ? { status } : {}),
      ...(input.diagnostics !== undefined ? { diagnostics: input.diagnostics } : {}),
      ...(input.raw !== undefined ? { raw: input.raw } : {}),
    };
  } catch (error) {
    emitPositionOperationalWarn({
      code: 'P0_POSITION_DISPLAY_NORMALIZE_FAILED',
      message: 'Position display normalization threw',
      context: { source: input.source },
      cause: error,
    });
    return null;
  }
}

function normalizeSymbol(value: unknown): string {
  const raw = String(value ?? '').trim();
  return raw.length > 0 ? raw.padStart(6, '0') : '';
}

function normalizeOptionalString(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  return raw.length > 0 ? raw : undefined;
}

function finitePositive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
