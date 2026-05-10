import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildGateFailureAttributionEntryAdr0497 } from './diagnosticTaxonomyAdr0497.js';
import {
  buildEmptyScanRootCauseDashboardAdr0500,
  buildEmptyScanRootCauseEventsFromGateFailuresAdr0500,
  buildEmptyScanRootCauseEventsFromStringsAdr0500,
  formatEmptyScanRootCauseCompactAdr0500,
  formatEmptyScanRootCauseDetailAdr0500,
  normalizeEmptyScanRootCauseAdr0500,
  safeBuildEmptyScanRootCauseDashboardAdr0500,
} from './emptyScanRootCauseDashboardAdr0500.js';

describe('ADR-0500 Empty Scan Root Cause Dashboard', () => {
  it('normalizes free-form empty scan causes to ADR-0497 GateFailureCause buckets', () => {
    expect(normalizeEmptyScanRootCauseAdr0500({ blockedReason: 'SELL_ONLY' })).toBe('SELL_ONLY_BLOCK');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'market closed holiday' })).toBe('MARKET_SESSION_BLOCK');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'missing no_data' })).toBe('DATA_MISSING');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'stale expired' })).toBe('DATA_STALE');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'provider_error api_error' })).toBe('PROVIDER_ERROR');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'empty no_rows' })).toBe('PROVIDER_EMPTY');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'risk_off crisis' })).toBe('MACRO_RISK_OFF');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'sector_energy missing_index_code' })).toBe('SECTOR_ENERGY_UNOBSERVABLE');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'supply_confluence' })).toBe('SUPPLY_CONFLUENCE_UNAVAILABLE');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'threshold required_score' })).toBe('THRESHOLD_TOO_STRICT');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'signal_conflict' })).toBe('SIGNAL_CONFLICT');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'positive_score score_starvation' })).toBe('INSUFFICIENT_POSITIVE_SCORE');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'risk_penalty' })).toBe('RISK_PENALTY_DOMINANT');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'sizing kelly_zero' })).toBe('SIZING_BLOCK');
    expect(normalizeEmptyScanRootCauseAdr0500({ message: 'unknown' })).toBe('UNKNOWN');
  });

  it('prioritizes provider, engine, and market-session structured fields', () => {
    expect(normalizeEmptyScanRootCauseAdr0500({ providerHealth: 'DOWN' })).toBe('PROVIDER_ERROR');
    expect(normalizeEmptyScanRootCauseAdr0500({ providerHealth: 'EMPTY' })).toBe('PROVIDER_EMPTY');
    expect(normalizeEmptyScanRootCauseAdr0500({ providerHealth: 'STALE' })).toBe('DATA_STALE');
    expect(normalizeEmptyScanRootCauseAdr0500({ engineMode: 'SELL_ONLY' })).toBe('SELL_ONLY_BLOCK');
    expect(normalizeEmptyScanRootCauseAdr0500({ marketSession: 'HOLIDAY' })).toBe('MARKET_SESSION_BLOCK');
  });

  it('groups, sums, percentages, sorts, and preserves diagnostic-only execution semantics', () => {
    const dashboard = buildEmptyScanRootCauseDashboardAdr0500({
      at: '2026-05-10T00:00:00.000Z',
      events: [
        { source: 'SCAN_BLOCKER', cause: 'PROVIDER_EMPTY', count: 8, message: 'no rows' },
        { source: 'SUPPLY_SNAPSHOT', cause: 'SUPPLY_CONFLUENCE_UNAVAILABLE', count: 14 },
        { source: 'SCAN_BLOCKER', cause: 'SELL_ONLY_BLOCK', count: 6 },
        { source: 'ENTRY_FILTER_DECOMPOSITION', cause: 'THRESHOLD_TOO_STRICT', count: 5 },
        { source: 'UNKNOWN', cause: 'UNKNOWN', count: 2 },
      ],
    });
    expect(dashboard.totalEvents).toBe(35);
    expect(dashboard.buckets.map((bucket) => bucket.cause)).toEqual([
      'SUPPLY_CONFLUENCE_UNAVAILABLE',
      'PROVIDER_EMPTY',
      'SELL_ONLY_BLOCK',
      'THRESHOLD_TOO_STRICT',
      'UNKNOWN',
    ]);
    expect(dashboard.buckets[0].pct).toBe(40);
    expect(dashboard.topCause).toBe('SUPPLY_CONFLUENCE_UNAVAILABLE');
    expect(dashboard.providerIssueCount).toBe(22);
    expect(dashboard.executionBlockCount).toBe(6);
    expect(dashboard.thresholdOrScoringCount).toBe(5);
    expect(dashboard.unknownCount).toBe(2);
    expect(dashboard.executionImpact).toBe('NONE');
    expect(dashboard.liveExecutionAllowed).toBe(false);
  });

  it('converts ADR-0497 GateFailureAttribution entries to root cause events', () => {
    expect(buildEmptyScanRootCauseEventsFromGateFailuresAdr0500(undefined)).toEqual([]);
    const events = buildEmptyScanRootCauseEventsFromGateFailuresAdr0500([
      buildGateFailureAttributionEntryAdr0497({ symbol: '005930', gateName: 'Gate1', failureCause: 'DATA_STALE' }),
    ]);
    expect(events[0]).toMatchObject({ source: 'GATE_FAILURE', cause: 'DATA_STALE', symbol: '005930', gateName: 'Gate1', count: 1 });
  });

  it('maps string blockers with count defaulting and partial inputs', () => {
    const events = buildEmptyScanRootCauseEventsFromStringsAdr0500([
      { source: 'SCAN_BLOCKER', reason: 'provider empty', count: 0 },
      { message: 'required score too strict' },
      { reason: null, message: null },
    ]);
    expect(events.map((event) => event.cause)).toEqual(['PROVIDER_EMPTY', 'THRESHOLD_TOO_STRICT', 'UNKNOWN']);
    expect(events.map((event) => event.count)).toEqual([1, 1, 1]);
  });

  it('formats compact Telegram-safe summary without raw content', () => {
    const dashboard = buildEmptyScanRootCauseDashboardAdr0500({
      events: [
        { source: 'SUPPLY_SNAPSHOT', cause: 'SUPPLY_CONFLUENCE_UNAVAILABLE', count: 14 },
        { source: 'SCAN_BLOCKER', cause: 'PROVIDER_EMPTY', count: 8, message: 'rawPayload: SECRET' },
      ],
    });
    const text = formatEmptyScanRootCauseCompactAdr0500(dashboard, { maxBuckets: 2 });
    expect(text).toContain('ADR-0500 EmptyScan');
    expect(text).toContain('total=22');
    expect(text).toContain('top=SUPPLY_CONFLUENCE_UNAVAILABLE');
    expect(text).toContain('provider=22');
    expect(text).toContain('execution=0');
    expect(text).toContain('threshold=0');
    expect(text).toContain('unknown=0');
    expect(text).toContain('1) SUPPLY_CONFLUENCE_UNAVAILABLE 14 (63.6%)');
    expect(text).not.toContain('SECRET');
  });

  it('formats detail with sources and truncated sanitized samples', () => {
    const dashboard = buildEmptyScanRootCauseDashboardAdr0500({
      events: [{ source: 'SCAN_BLOCKER', cause: 'PROVIDER_ERROR', message: `payload: SECRET ${'x'.repeat(120)}` }],
    });
    const text = formatEmptyScanRootCauseDetailAdr0500(dashboard);
    expect(text).toContain('sources=SCAN_BLOCKER');
    expect(text).toContain('samples=payload=[redacted]');
    expect(text).not.toContain('SECRET');
    expect(text.length).toBeLessThan(500);
  });

  it('safe builder never throws and returns UNKNOWN dashboard on internal error', () => {
    const dashboard = safeBuildEmptyScanRootCauseDashboardAdr0500({ at: '__ADR0500_FORCE_ERROR__' });
    expect(dashboard.totalEvents).toBe(1);
    expect(dashboard.topCause).toBe('UNKNOWN');
    expect(dashboard.warnings).toContain('ADR-0500 dashboard_error');
    expect(dashboard.executionImpact).toBe('NONE');
    expect(dashboard.liveExecutionAllowed).toBe(false);
  });

  it('statically preserves diagnostic-only safety invariants and wiring', () => {
    const moduleSource = fs.readFileSync(path.resolve(process.cwd(), 'server/diagnostics/emptyScanRootCauseDashboardAdr0500.ts'), 'utf-8');
    const scanBlockersSource = fs.readFileSync(path.resolve(process.cwd(), 'server/telegram/commands/system/scanBlockers.cmd.ts'), 'utf-8');
    const runtimeAuditSource = fs.readFileSync(path.resolve(process.cwd(), 'server/diagnostics/runtimePipelineAudit.ts'), 'utf-8');
    const scanDiagnosticsSource = fs.readFileSync(path.resolve(process.cwd(), 'server/trading/signalScanner/scanDiagnostics.ts'), 'utf-8');

    expect(moduleSource).not.toMatch(/from ['"].*(?:kis|orderExecutor|autoTradeEngine|trancheExecutor|buyPipeline|live).*['"]/i);
    expect(moduleSource).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|submitOrder|executeTrade/);
    expect(moduleSource).not.toMatch(/requiredScore\s*=|GATE_SCORE_THRESHOLD|setRuntimeThresholdDelta|conditionWeight/);
    expect(moduleSource).not.toMatch(/writeFile|appendFile|mkdir|rename|rmSync|createWriteStream/);
    expect(moduleSource).not.toMatch(/\bfetch\s*\(|axios|node-fetch/);
    expect(moduleSource).not.toMatch(/runScheduler|startScheduler|cron\.schedule/);
    expect(scanBlockersSource).toContain('formatEmptyScanRootCauseCompactAdr0500');
    expect(scanBlockersSource).toContain('safeBuildEmptyScanRootCauseDashboardAdr0500');
    expect(runtimeAuditSource).toContain('emptyScanRootCause?: EmptyScanRootCauseDashboardAdr0500');
    expect(runtimeAuditSource).toContain('emptyScanRootCauseCompact?: string');
    expect(scanDiagnosticsSource).toContain('emptyScanRootCause?: EmptyScanRootCauseDashboardAdr0500');
    expect(scanDiagnosticsSource).toContain('try {\n    const rootCauseInputs');
  });
});
