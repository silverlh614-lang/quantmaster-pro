// @responsibility ADR-0523 compact Gate/Execution Telegram UX entrypoints. Read-only render layer.

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  formatScanBlockersMessage,
  getLastScanSummary,
} from '../../../trading/signalScanner/scanDiagnostics.js';
import { outcomeClosureRepo } from '../../../learning/outcomeClosure.js';
import { buildDiagnosticCommandHint } from '../../renderers/diagnosticButtonBuilder.js';
import { renderExecutionCompact } from '../../renderers/executionCompactRenderer.js';
import { renderGateDetailSummary } from '../../renderers/gateDetailRenderer.js';
import { buildQmpGateDetailHeaderView } from '../../renderers/qmpGateDetailHeaderCanonical.js';
import { renderDebugRaw, renderGateFullForensic } from '../../renderers/gateFullRenderer.js';
import { buildCanonicalDebugRawView } from '../../renderers/canonicalDebugRawView.js';
import {
  renderGateCompactSummary,
} from '../../renderers/gateCompactRenderer.js';
import { learningSummaryFromOutcomeSummary } from '../../renderers/learningCompactRenderer.js';
import {
  buildSnapshotBundleFromScanSummary,
  executionSummaryFromUnifiedAggregate,
  gate2SummaryFromAggregate,
  getByPath,
  recordOf,
  text,
  type SnapshotBundle,
} from '../../renderers/snapshotBundle.js';

function normalizeEngineMode(value: unknown): string {
  const raw = text(value, 'OBSERVE_ONLY').toUpperCase();
  if (raw === 'NORMAL' || raw === 'DEGRADED' || raw === 'SELL_ONLY' || raw === 'SHADOW_ONLY' || raw === 'OBSERVE_ONLY') return raw;
  return 'OBSERVE_ONLY';
}

function normalizeMarketSession(value: unknown): string {
  const raw = text(value, 'UNKNOWN').toUpperCase();
  if (raw === 'REGULAR' || raw === 'PRE_MARKET' || raw === 'POST_MARKET' || raw === 'HOLIDAY' || raw === 'LUNCH' || raw === 'UNKNOWN') return raw;
  if (raw === 'NON_TRADING_DAY' || raw === 'CLOSED') return 'HOLIDAY';
  return 'UNKNOWN';
}

function buildGateUxBundle(): SnapshotBundle {
  const summary = getLastScanSummary();
  const summaryRecord = recordOf(summary);
  const base = buildSnapshotBundleFromScanSummary(summary);
  const engineMode = normalizeEngineMode(summaryRecord?.engineMode ?? getByPath(summaryRecord, 'macroGateState.engineMode'));
  const marketSession = normalizeMarketSession(summaryRecord?.marketSession ?? getByPath(summaryRecord, 'macroGateState.canonicalSession'));
  // 정본 macro regime 은 base(snapshotBundle = scanEvaluation.effectiveRegime SSOT)에서 가져온다.
  // 폐기된 macroRegimeEffective(legacyRegimeNotUsedForDecision)를 재계산하면 R6_DEFENSE 오표기 → 차단.
  const canonicalEffectiveRegime = base.effectiveRegime;
  // ADR-0527 Phase 2b: execution 표시 정본 = 스캔-시점 persist(executionResolutionAggregate).
  // 더미 시각(1970) resolveFinalExecutionDecision 재계산 + buildFinalDecisionRuntimeAuditSummary 집계 제거 →
  // 실제 asOf 로 도출된 정본 read 로 교체(렌더 비결정성/더미-시각 divergence 제거 = 의도된 버그 정정).
  // gate2/gate3 표시는 View read 라 더 이상 execution input plumbing 이 필요 없어 GATE-VIEW-EXEMPT 면제 불요(가드가 강제).
  const execution = executionSummaryFromUnifiedAggregate(summaryRecord?.executionResolutionAggregate);
  return {
    ...base,
    marketSession,
    engineMode,
    effectiveRegime: canonicalEffectiveRegime,
    // ADR-0526 Phase1b: gate2 표시 status 정본 = 스캔-시점 View(candidateGateAggregate). confluence(캐시 보강) override 제거.
    gate2: gate2SummaryFromAggregate(summaryRecord?.candidateGateAggregate),
    // ADR-0525: gate3 표시 override 제거 → base 의 canonical gate3(gateLayerAudit.gate3Consolidated 투영)를 사용한다.
    execution,
    learning: learningSummaryFromOutcomeSummary(outcomeClosureRepo.summarizeLearningOutcomes()),
    // Phase2b: executionImpact 정본 = executionResolutionAggregate(더미-시각 executionAudit 제거).
    executionImpact: execution.executionImpact,
    // main(536A2): QMP gate detail header canonical view (summary read).
    qmpGateDetailHeader: buildQmpGateDetailHeaderView(summary),
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
