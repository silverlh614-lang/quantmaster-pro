import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildGateFailureAttributionEntryAdr0497 } from './diagnosticTaxonomyAdr0497.js';
import {
  buildWeekendReplayRecordsFromGateFailuresAdr0501,
  buildWeekendReplayRecordsFromStringsAdr0501,
  buildWeekendReplaySummaryAdr0501,
  classifyWeekendReplayOutcomeAdr0501,
  formatWeekendReplayCompactAdr0501,
  formatWeekendReplayDetailAdr0501,
  normalizeWeekendReplayRecordAdr0501,
  safeBuildWeekendReplaySummaryAdr0501,
} from './weekendReplayAdr0501.js';
import type { GateFailureCauseAdr0497 } from './diagnosticTaxonomyAdr0497.js';

function record(cause: GateFailureCauseAdr0497) {
  return normalizeWeekendReplayRecordAdr0501({ failureCause: cause });
}

describe('ADR-0501 Weekend Replay using GateFailureCause', () => {
  it('normalizes records, preserves explicit failureCause, maps free-form reasons, and applies defaults', () => {
    const explicit = normalizeWeekendReplayRecordAdr0501({ failureCause: 'MACRO_RISK_OFF', reason: 'threshold' });
    expect(explicit.failureCause).toBe('MACRO_RISK_OFF');
    expect(normalizeWeekendReplayRecordAdr0501({ reason: 'SELL_ONLY' }).failureCause).toBe('SELL_ONLY_BLOCK');
    expect(normalizeWeekendReplayRecordAdr0501({ reason: 'provider empty no sample' }).failureCause).toBe('PROVIDER_EMPTY');
    expect(normalizeWeekendReplayRecordAdr0501({ blockedReason: 'stale expired' }).failureCause).toBe('DATA_STALE');
    expect(normalizeWeekendReplayRecordAdr0501({ message: 'required threshold too strict' }).failureCause).toBe('THRESHOLD_TOO_STRICT');
    const defaults = normalizeWeekendReplayRecordAdr0501({ reason: null, blockedReason: null });
    expect(defaults.source).toBe('UNKNOWN');
    expect(defaults.replayMode).toBe('MANUAL_INPUT');
    expect(defaults.failureCause).toBe('UNKNOWN');
    expect(defaults.timestamp).toBeTruthy();
  });

  it('converts GateFailureAttribution entries and handles undefined/empty input', () => {
    expect(buildWeekendReplayRecordsFromGateFailuresAdr0501(undefined)).toEqual([]);
    expect(buildWeekendReplayRecordsFromGateFailuresAdr0501([])).toEqual([]);
    const records = buildWeekendReplayRecordsFromGateFailuresAdr0501([
      buildGateFailureAttributionEntryAdr0497({
        scanId: 'scan-1',
        symbol: '005930',
        gateName: 'Gate2',
        failureCause: 'DATA_STALE',
        executionImpact: 'BLOCKED',
      }),
    ], 'WINDOW');
    expect(records[0]).toMatchObject({
      source: 'GATE_FAILURE_ATTRIBUTION',
      scanId: 'scan-1',
      symbol: '005930',
      replayMode: 'WINDOW',
      originalDecision: 'BLOCKED',
      replayDecision: 'Gate2',
      failureCause: 'DATA_STALE',
    });
  });

  it('converts free-form blocker strings to standardized causes and tolerates partial inputs', () => {
    const records = buildWeekendReplayRecordsFromStringsAdr0501([
      { reason: 'SELL_ONLY' },
      { source: 'RUNTIME_PIPELINE_AUDIT', message: 'provider error' },
      { scanId: 'scan-2', symbol: '000660' },
    ]);
    expect(records.map((item) => item.failureCause)).toEqual(['SELL_ONLY_BLOCK', 'PROVIDER_ERROR', 'UNKNOWN']);
    expect(records[2]).toMatchObject({ scanId: 'scan-2', symbol: '000660', replayMode: 'MANUAL_INPUT' });
  });

  it('classifies replay outcomes without applying changes', () => {
    expect(classifyWeekendReplayOutcomeAdr0501(record('DATA_MISSING')).outcome).toBe('NEEDS_MORE_DATA');
    expect(classifyWeekendReplayOutcomeAdr0501(record('PROVIDER_ERROR')).outcome).toBe('NEEDS_MORE_DATA');
    expect(classifyWeekendReplayOutcomeAdr0501(record('SUPPLY_CONFLUENCE_UNAVAILABLE')).outcome).toBe('NEEDS_MORE_DATA');
    expect(classifyWeekendReplayOutcomeAdr0501(record('SELL_ONLY_BLOCK')).outcome).toBe('LIKELY_CORRECT_BLOCK');
    expect(classifyWeekendReplayOutcomeAdr0501(record('MARKET_SESSION_BLOCK')).outcome).toBe('LIKELY_CORRECT_BLOCK');
    expect(classifyWeekendReplayOutcomeAdr0501(record('MACRO_RISK_OFF')).outcome).toBe('LIKELY_CORRECT_BLOCK');
    expect(classifyWeekendReplayOutcomeAdr0501(record('SIGNAL_CONFLICT')).outcome).toBe('LIKELY_CORRECT_BLOCK');
    expect(classifyWeekendReplayOutcomeAdr0501(record('THRESHOLD_TOO_STRICT')).outcome).toBe('LIKELY_OVER_BLOCKED');
    expect(classifyWeekendReplayOutcomeAdr0501(record('INSUFFICIENT_POSITIVE_SCORE')).outcome).toBe('LIKELY_OVER_BLOCKED');
    expect(classifyWeekendReplayOutcomeAdr0501(record('RISK_PENALTY_DOMINANT')).outcome).toBe('LIKELY_OVER_BLOCKED');
    expect(classifyWeekendReplayOutcomeAdr0501(record('UNKNOWN')).outcome).toBe('NEEDS_MORE_DATA');
  });

  it('builds summary counts, ADR-0500 dashboard, and diagnostic-only execution flags', () => {
    const summary = buildWeekendReplaySummaryAdr0501({
      generatedAt: '2026-05-10T00:00:00.000Z',
      replayMode: 'WINDOW',
      records: [
        record('PROVIDER_EMPTY'),
        record('DATA_STALE'),
        record('SELL_ONLY_BLOCK'),
        record('MARKET_SESSION_BLOCK'),
        record('THRESHOLD_TOO_STRICT'),
        record('MACRO_RISK_OFF'),
        record('SIGNAL_CONFLICT'),
        record('UNKNOWN'),
      ],
      totalScans: 2,
      totalSymbols: 8,
    });
    expect(summary.totalRecords).toBe(8);
    expect(summary.causeCounts.PROVIDER_EMPTY).toBe(1);
    expect(summary.emptyScanDashboard.totalEvents).toBe(8);
    expect(summary.providerIssueCount).toBe(2);
    expect(summary.executionBlockCount).toBe(2);
    expect(summary.thresholdOrScoringCount).toBe(1);
    expect(summary.marketRiskCount).toBe(2);
    expect(summary.unknownCount).toBe(1);
    expect(summary.likelyOverBlockedCount).toBe(1);
    expect(summary.likelyCorrectBlockCount).toBe(4);
    expect(summary.needsMoreDataCount).toBe(3);
    expect(summary.executionImpact).toBe('NONE');
    expect(summary.liveExecutionAllowed).toBe(false);
    expect(summary.operatorSummary).toContain('impact=NONE');
  });

  it('formats compact Telegram-safe output with marker, replay mode, totals, and top causes', () => {
    const summary = buildWeekendReplaySummaryAdr0501({
      replayMode: 'WINDOW',
      records: [record('SUPPLY_CONFLUENCE_UNAVAILABLE'), record('SUPPLY_CONFLUENCE_UNAVAILABLE'), record('THRESHOLD_TOO_STRICT')],
    });
    const text = formatWeekendReplayCompactAdr0501(summary, { maxCauses: 2 });
    expect(text).toContain('ADR-0501 WeekendReplay');
    expect(text).toContain('mode=WINDOW');
    expect(text).toContain('total=3');
    expect(text).toContain('overBlocked=1');
    expect(text).toContain('correct=0');
    expect(text).toContain('needsData=2');
    expect(text).toContain('1) SUPPLY_CONFLUENCE_UNAVAILABLE 2');
    expect(text).not.toContain('SECRET');
  });

  it('formats detail with category/outcome counts, warnings, and sanitized dashboard content', () => {
    const summary = safeBuildWeekendReplaySummaryAdr0501({ generatedAt: '__ADR0501_FORCE_ERROR__' });
    const text = formatWeekendReplayDetailAdr0501(summary);
    expect(text).toContain('outcomes:');
    expect(text).toContain('categories:');
    expect(text).toContain('warnings=ADR-0501 replay_error');
    expect(text).not.toContain('raw payload');
  });

  it('safe builder never throws and returns UNKNOWN replay_error summary on internal failure', () => {
    const summary = safeBuildWeekendReplaySummaryAdr0501({ generatedAt: '__ADR0501_FORCE_ERROR__' });
    expect(summary.totalRecords).toBe(1);
    expect(summary.causeCounts.UNKNOWN).toBe(1);
    expect(summary.warnings).toContain('ADR-0501 replay_error');
    expect(summary.executionImpact).toBe('NONE');
    expect(summary.liveExecutionAllowed).toBe(false);
  });

  it('statically preserves diagnostic-only safety invariants and wiring', () => {
    const moduleSource = fs.readFileSync(path.resolve(process.cwd(), 'server/diagnostics/weekendReplayAdr0501.ts'), 'utf-8');
    const scanBlockersSource = fs.readFileSync(path.resolve(process.cwd(), 'server/telegram/commands/system/scanBlockers.cmd.ts'), 'utf-8');
    const runtimeAuditSource = fs.readFileSync(path.resolve(process.cwd(), 'server/diagnostics/runtimePipelineAudit.ts'), 'utf-8');
    const scanDiagnosticsSource = fs.readFileSync(path.resolve(process.cwd(), 'server/trading/signalScanner/scanDiagnostics.ts'), 'utf-8');

    expect(moduleSource).not.toMatch(/from ['"].*(?:kis|orderExecutor|autoTradeEngine|trancheExecutor|buyPipeline|live).*['"]/i);
    expect(moduleSource).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|submitOrder|executeTrade/);
    expect(moduleSource).not.toMatch(/requiredScore\s*=|GATE_SCORE_THRESHOLD|setRuntimeThresholdDelta|conditionWeight/);
    expect(moduleSource).not.toMatch(/writeFile|appendFile|mkdir|rename|rmSync|createWriteStream/);
    expect(moduleSource).not.toMatch(/\bfetch\s*\(|axios|node-fetch/);
    expect(moduleSource).not.toMatch(/runScheduler|startScheduler|cron\.schedule/);
    expect(moduleSource).not.toMatch(/mutateGate|setGate|updateGate/);
    expect(scanBlockersSource).toContain('formatWeekendReplayCompactAdr0501');
    expect(scanBlockersSource).toContain('safeBuildWeekendReplaySummaryAdr0501');
    expect(runtimeAuditSource).toContain('weekendReplaySummary?: WeekendReplaySummaryAdr0501');
    expect(runtimeAuditSource).toContain('weekendReplayCompact?: string');
    expect(scanDiagnosticsSource).toContain('weekendReplaySummaryAdr0501?: WeekendReplaySummaryAdr0501');
  });
});
