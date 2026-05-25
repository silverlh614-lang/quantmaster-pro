// @responsibility ADR-0523 compact Gate/Execution Telegram UX entrypoints. Read-only render layer.

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  formatScanBlockersMessage,
  getLastScanSummary,
} from '../../../trading/signalScanner/scanDiagnostics.js';
import { loadGate2ExternalCache } from '../../../trading/gate2/gate2ExternalCache.js';
import { buildGate2ConfluenceSummary } from '../../../quant/gate2ConfluenceScore.js';
import { buildGate3RuntimeClosureSummary } from '../../../quant/gate3RuntimeClosure.js';
import {
  buildFinalDecisionRuntimeAuditSummary,
  resolveFinalExecutionDecision,
  type FinalDecisionDataConfidenceCeiling,
  type FinalDecisionEffectiveRegime,
  type FinalDecisionEngineMode,
  type FinalDecisionEntryTimingSignal,
  type FinalDecisionMarketSession,
  type FinalDecisionProviderHealthStatus,
  type FinalDecisionShadowMode,
} from '../../../trading/gates/finalDecisionResolver.js';
import { outcomeClosureRepo } from '../../../learning/outcomeClosure.js';
import { buildDiagnosticCommandHint } from '../../renderers/diagnosticButtonBuilder.js';
import { renderExecutionCompact } from '../../renderers/executionCompactRenderer.js';
import { renderGateDetailSummary } from '../../renderers/gateDetailRenderer.js';
import { renderDebugRaw, renderGateFullForensic } from '../../renderers/gateFullRenderer.js';
import { buildCanonicalDebugRawView } from '../../renderers/canonicalDebugRawView.js';
import {
  renderGateCompactSummary,
} from '../../renderers/gateCompactRenderer.js';
import { learningSummaryFromOutcomeSummary } from '../../renderers/learningCompactRenderer.js';
import {
  arrayOfRecords,
  buildSnapshotBundleFromScanSummary,
  boolOf,
  executionSummaryFromAudit,
  gate2SummaryFromConfluence,
  getByPath,
  recordOf,
  text,
  type SnapshotBundle,
} from '../../renderers/snapshotBundle.js';

type AnyRecord = Record<string, unknown>;

function normalizeEngineMode(value: unknown): FinalDecisionEngineMode {
  const raw = text(value, 'OBSERVE_ONLY').toUpperCase();
  if (raw === 'NORMAL' || raw === 'DEGRADED' || raw === 'SELL_ONLY' || raw === 'SHADOW_ONLY' || raw === 'OBSERVE_ONLY') return raw;
  return 'OBSERVE_ONLY';
}

function normalizeMarketSession(value: unknown): FinalDecisionMarketSession {
  const raw = text(value, 'UNKNOWN').toUpperCase();
  if (raw === 'REGULAR' || raw === 'PRE_MARKET' || raw === 'POST_MARKET' || raw === 'HOLIDAY' || raw === 'LUNCH' || raw === 'UNKNOWN') return raw;
  if (raw === 'NON_TRADING_DAY' || raw === 'CLOSED') return 'HOLIDAY';
  return 'UNKNOWN';
}

function normalizeRegime(value: unknown): FinalDecisionEffectiveRegime {
  const raw = text(value, 'UNKNOWN').toUpperCase();
  if (raw === 'GREEN' || raw === 'YELLOW' || raw === 'RED' || raw === 'R6_DEFENSE' || raw === 'R5_STABILIZING' || raw === 'UNKNOWN') return raw;
  return raw.startsWith('R6') ? 'R6_DEFENSE' : 'UNKNOWN';
}

function normalizeHealth(value: unknown): FinalDecisionProviderHealthStatus {
  const raw = text(value, 'VERIFIED').toUpperCase();
  if (raw === 'VERIFIED' || raw === 'DEGRADED' || raw === 'STALE' || raw === 'MISSING') return raw;
  if (raw === 'FRESH' || raw === 'OK' || raw === 'PASS') return 'VERIFIED';
  return 'DEGRADED';
}

function normalizeConfidence(value: unknown): FinalDecisionDataConfidenceCeiling {
  const raw = text(value, 'HIGH').toUpperCase();
  return raw === 'LOW' || raw === 'MEDIUM' || raw === 'HIGH' ? raw : 'HIGH';
}

function shadowModeFor(engineMode: FinalDecisionEngineMode): FinalDecisionShadowMode {
  if (engineMode === 'SHADOW_ONLY') return 'SHADOW_ONLY';
  if (engineMode === 'OBSERVE_ONLY') return 'OBSERVE_ONLY';
  return 'NORMAL';
}

function resolveEntryFilter(summary: AnyRecord | null): AnyRecord | null {
  return recordOf(summary?.entryFilterDecomposition) ?? recordOf(summary?.entryFilterDecompositionAdr0464);
}

function resolveCandidateTraces(summary: AnyRecord | null): AnyRecord[] {
  return arrayOfRecords(resolveEntryFilter(summary)?.candidateTraces);
}

function latestGate2CacheRecords(cache: ReturnType<typeof loadGate2ExternalCache>): Record<string, unknown>[] {
  const traceSymbols = new Set((cache.lastRefresh?.traces ?? []).map(trace => trace.symbol));
  const records = traceSymbols.size > 0
    ? cache.records.filter(record => traceSymbols.has(record.symbol))
    : cache.records;
  return records as unknown as Record<string, unknown>[];
}

function buildGateUxBundle(): SnapshotBundle {
  const summary = getLastScanSummary();
  const summaryRecord = recordOf(summary);
  const base = buildSnapshotBundleFromScanSummary(summary);
  const traces = resolveCandidateTraces(summaryRecord);
  const gate2Cache = loadGate2ExternalCache();
  const confluence = buildGate2ConfluenceSummary({
    traces,
    sourceSnapshotId: base.sourceSnapshotId,
    gate2CacheRecords: latestGate2CacheRecords(gate2Cache),
  });
  const gate2StatusBySymbol = new Map<string, string>(confluence.results.map(result => [result.symbol, result.gate2Status]));
  const gate3 = buildGate3RuntimeClosureSummary({ traces, sourceSnapshotId: base.sourceSnapshotId, gate2StatusBySymbol });
  const engineMode = normalizeEngineMode(summaryRecord?.engineMode ?? getByPath(summaryRecord, 'macroGateState.engineMode'));
  const marketSession = normalizeMarketSession(summaryRecord?.marketSession ?? getByPath(summaryRecord, 'macroGateState.canonicalSession'));
  // 정본 macro regime 은 base(snapshotBundle = scanEvaluation.effectiveRegime SSOT)에서 가져온다.
  // 폐기된 macroRegimeEffective(legacyRegimeNotUsedForDecision)를 재계산하면 R6_DEFENSE 오표기 → 차단.
  const canonicalEffectiveRegime = base.effectiveRegime;
  // FinalDecisionResolver 는 color/R6 taxonomy 만 받는다 — R3_EARLY 등 macro 레짐은 UNKNOWN 으로 정규화(가짜 R6 아님).
  const finalDecisionRegime = normalizeRegime(canonicalEffectiveRegime);
  const inputs = gate3.results.map((result) => {
    const trace = traces.find((item) => text(item.symbol, '') === result.symbol) ?? {};
    return {
      sourceSnapshotId: base.sourceSnapshotId,
      symbol: result.symbol,
      asOf: base.asOf,
      gate1Status: result.gate1Status,
      gate2Status: result.gate2Status,
      gate3Readiness: result.gate3Readiness,
      entryTimingSignal: result.entryTimingSignal as FinalDecisionEntryTimingSignal,
      engineMode,
      marketSession,
      effectiveRegime: finalDecisionRegime,
      riskOverride: finalDecisionRegime === 'R6_DEFENSE' ? 'R6_DEFENSE' as const : 'NONE' as const,
      providerHealth: {
        quote: normalizeHealth(result.priceFreshness),
        supply: normalizeHealth(getByPath(trace, 'providerHealth.supply') ?? trace.supplyConfidence),
        dart: normalizeHealth(getByPath(trace, 'providerHealth.dart') ?? trace.dartConfidence),
        macro: normalizeHealth(getByPath(summaryRecord, 'providerHealth.macro')),
      },
      dataConfidenceCeiling: normalizeConfidence(trace.dataConfidenceCeiling ?? summaryRecord?.dataConfidenceCeiling),
      marketSignal: boolOf(summaryRecord?.marketSignal, false),
      providerIssue: boolOf(summaryRecord?.providerIssue, false) || boolOf(trace.providerIssue, false),
      shadowMode: shadowModeFor(engineMode),
      requestedSide: 'BUY' as const,
      currentPositionState: 'NONE' as const,
      isDiagnosticOnly: boolOf(trace.isDiagnosticOnly, false) || result.gate3Readiness === 'SKIPPED',
    };
  });
  const decisions = inputs.map(input => resolveFinalExecutionDecision(input, new Date('1970-01-01T00:00:00.000Z')));
  const executionAudit = buildFinalDecisionRuntimeAuditSummary({ sourceSnapshotId: base.sourceSnapshotId, decisions, inputs });
  return {
    ...base,
    marketSession,
    engineMode,
    effectiveRegime: canonicalEffectiveRegime,
    gate2: gate2SummaryFromConfluence(confluence),
    // ADR-0525: gate3 표시 override 제거 → base 의 canonical gate3(gateLayerAudit.gate3Consolidated 투영)를 사용한다.
    // /gate · /gate_detail · /gate_full · debug_raw 가 동일 gate3 정본을 본다. (gate2/execution override 는 Phase1/2 대상으로 잔류)
    execution: executionSummaryFromAudit(executionAudit),
    learning: learningSummaryFromOutcomeSummary(outcomeClosureRepo.summarizeLearningOutcomes()),
    executionImpact: executionSummaryFromAudit(executionAudit).executionImpact,
    fullForensicText: formatScanBlockersMessage(summary),
  };
}

async function replyText(reply: (message: string) => Promise<void>, message: string): Promise<void> {
  const maxLen = 3600;
  if (message.length <= maxLen) {
    await reply(message);
    return;
  }
  let chunk = '';
  for (const line of message.split('\n')) {
    if (chunk.length + line.length + 1 > maxLen) {
      await reply(chunk.trimEnd());
      chunk = '';
    }
    chunk += `${line}\n`;
  }
  if (chunk.trim()) await reply(chunk.trimEnd());
}

function withHint(message: string, scope: 'gate' | 'execution' | 'learning' = 'gate'): string {
  return `${message}\n${buildDiagnosticCommandHint(scope)}`;
}

const gate: TelegramCommand = {
  name: '/gate',
  aliases: ['/gate_compact', '/scan_blockers_compact'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Compact Gate/Execution/Learning summary',
  usage: '/gate',
  menuPriority: 0,
  async execute({ reply }) {
    await replyText(reply, withHint(renderGateCompactSummary(buildGateUxBundle())));
  },
};

const gateDetail: TelegramCommand = {
  name: '/gate_detail',
  aliases: ['/scan_blockers_detail'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Gate detail summary without raw forensic payload',
  usage: '/gate_detail',
  async execute({ reply }) {
    await replyText(reply, withHint(renderGateDetailSummary(buildGateUxBundle())));
  },
};

const gateFull: TelegramCommand = {
  name: '/gate_full',
  aliases: ['/scan_blockers_full'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Full Gate forensic report',
  usage: '/gate_full',
  async execute({ reply }) {
    const bundle = buildGateUxBundle();
    await replyText(reply, renderGateFullForensic(bundle, bundle.fullForensicText));
  },
};

const execCompact: TelegramCommand = {
  name: '/exec',
  aliases: ['/execution'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Compact execution permission summary',
  usage: '/exec',
  async execute({ reply }) {
    await replyText(reply, withHint(renderExecutionCompact(buildGateUxBundle()), 'execution'));
  },
};

const execFull: TelegramCommand = {
  name: '/exec_full',
  aliases: ['/execution_full'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Execution permission detail via Gate bundle',
  usage: '/exec_full',
  async execute({ reply }) {
    await replyText(reply, renderGateDetailSummary(buildGateUxBundle()));
  },
};

const debugGate: TelegramCommand = {
  name: '/debug_gate',
  aliases: ['/debug_snapshot'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  showInMenu: false,
  description: 'Raw Gate snapshot bundle debug',
  usage: '/debug_gate',
  async execute({ reply }) {
    // ADR-0525: debug_raw 는 재계산 번들(buildGateUxBundle)이 아니라 persisted 정본 슬라이스를 직렬화한다.
    await replyText(reply, renderDebugRaw(buildCanonicalDebugRawView(getLastScanSummary())));
  },
};

for (const cmd of [gate, gateDetail, gateFull, execCompact, execFull, debugGate]) {
  commandRegistry.register(cmd);
}

export {
  buildGateUxBundle,
  gate,
  gateDetail,
  gateFull,
  execCompact,
  execFull,
  debugGate,
};
