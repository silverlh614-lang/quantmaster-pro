// @responsibility Compact Gate0 macro / permission guard slice from the latest scan_blockers snapshot.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getLastScanSummary, type MacroGateState, type ScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';

function text(value: unknown, fallback = 'UNKNOWN'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function boolText(value: unknown, fallback = false): string {
  return String(typeof value === 'boolean' ? value : fallback);
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'null';
}

function topReason(...values: unknown[]): string {
  for (const value of values) {
    const raw = text(value, '');
    if (raw) return raw;
  }
  return 'NONE';
}

function sourceSnapshotId(summary: ScanSummary | null | undefined): string {
  return text(summary?.snapshotId ?? summary?.scanEvaluation?.scanId ?? summary?.macroGateState?.regimeSnapshotId, 'NO_SCAN_SUMMARY');
}

function effectiveRegime(mg: MacroGateState): string {
  const rawRegime = mg.macroRegimeRaw ?? mg.regime;
  const displayRegime = mg.displayRegime ?? mg.regime;
  const legacyEffectiveRegime = mg.macroRegimeEffective ?? mg.regime;
  const staleLegacyR6Path =
    legacyEffectiveRegime === 'R6_DEFENSE'
    && displayRegime !== 'R6_DEFENSE'
    && mg.regime !== 'R6_DEFENSE';
  return staleLegacyR6Path ? rawRegime : legacyEffectiveRegime;
}

function macroMarketSignal(mg: MacroGateState): boolean {
  return Boolean(
    mg.emergencyStop
    || mg.vixGatingActive
    || mg.bearDefenseMode
    || mg.mhsBelow30
    || mg.regime === 'R6_DEFENSE'
    || mg.macroRegimeEffective === 'R6_DEFENSE',
  );
}

function permissionLine(mg: MacroGateState): string {
  const shadowOnly = text(mg.engineMode ?? mg.displayRegime ?? mg.riskOverride, '').toUpperCase() === 'SHADOW_ONLY';
  const brokerRouteAlive = mg.brokerRouteAlive ?? mg.brokerOrderAllowed ?? mg.liveEntryAllowed ?? false;
  const brokerLiveOrderAllowed = mg.brokerLiveOrderAllowed ?? (!shadowOnly && brokerRouteAlive && mg.liveEntryAllowed === true);
  return [
    `liveEntryAllowed=${boolText(mg.liveEntryAllowed, false)}`,
    `brokerRouteAlive=${boolText(brokerRouteAlive, false)}`,
    `brokerLiveOrderAllowed=${boolText(brokerLiveOrderAllowed, false)}`,
    `paperOrderAllowed=${boolText(mg.paperOrderAllowed, true)}`,
    `shadowAllowed=${boolText(mg.shadowAllowed ?? mg.shadowBuyAllowed, true)}`,
    `counterfactualAllowed=${boolText(mg.counterfactualAllowed, true)}`,
    `diagnosticAllowed=${boolText(mg.diagnosticAllowed, true)}`,
  ].join(' ');
}

export function formatScanBlockersGate0Section(summary: ScanSummary | null | undefined): string {
  const mg = summary?.macroGateState;
  if (!summary || !mg) {
    return [
      'Gate0 Macro / Permission Guard',
      'evaluated: 0/0',
      'reason=MACRO_GATE_STATE_NOT_CARRIED',
      `sourceSnapshotId=${sourceSnapshotId(summary)}`,
      'providerIssue=false',
      'executionImpact=NONE',
      'diagnosticOnly=true',
    ].join('\n');
  }

  const rawRegime = mg.macroRegimeRaw ?? mg.regime;
  const displayRegime = mg.displayRegime ?? mg.regime;
  const resolvedEffectiveRegime = effectiveRegime(mg);
  const riskOverride = mg.riskOverride ?? 'NONE';
  const liveBlockReason = topReason(
    mg.liveEntryBlockedReason,
    mg.recoveryBlockedReason,
    mg.emergencyStop ? 'EMERGENCY_STOP' : '',
    mg.autoTradeEnabled === false ? 'AUTO_TRADE_DISABLED' : '',
    mg.sellOnlyMode ? 'SELL_ONLY_MODE' : '',
    mg.vixGatingActive ? 'VIX_GATING_ACTIVE' : '',
    mg.bearDefenseMode ? 'BEAR_DEFENSE_MODE' : '',
    mg.mhsBelow30 ? 'MHS_BELOW_30' : '',
  );
  const activeRiskFlags = [
    mg.emergencyStop ? 'emergencyStop' : null,
    mg.autoTradeEnabled === false ? 'autoTradeDisabled' : null,
    mg.sellOnlyMode ? 'sellOnly' : null,
    mg.vixGatingActive ? 'vixGate' : null,
    mg.bearDefenseMode ? 'bearDefense' : null,
    mg.mhsBelow30 ? 'mhsBelow30' : null,
    mg.watchlistEmpty ? 'watchlistEmpty' : null,
  ].filter(Boolean).join(',') || 'none';

  return [
    'Gate0 Macro / Permission Guard',
    'evaluated: 1/1',
    `sourceSnapshotId=${sourceSnapshotId(summary)}`,
    `regimeSnapshotId=${text(mg.regimeSnapshotId, 'NONE')}`,
    `regimeSnapshotAsOf=${text(mg.regimeSnapshotAsOf, 'NONE')}`,
    `regimeSnapshotTtlSec=${numberText(mg.regimeSnapshotTtlSec)}`,
    `regime: raw=${rawRegime} effective=${resolvedEffectiveRegime} display=${displayRegime} riskOverride=${riskOverride}`,
    `engineMode=${text(mg.engineMode ?? displayRegime, 'UNKNOWN')}`,
    `sourceHealth=${text(mg.sourceHealth, 'UNKNOWN')}`,
    `mhs=${numberText(mg.mhs)} mhsBelow30=${boolText(mg.mhsBelow30)} kospi20dReturn=${numberText(mg.kospi20dReturn)}`,
    `kelly: regime=${numberText(mg.kellyMultiplierFromRegime)} fomc=${numberText(mg.fomcKellyMultiplier)} final=${numberText(mg.finalKellyMultiplier)}`,
    `fomcPhase=${text(mg.fomcPhase)} vixGatingActive=${boolText(mg.vixGatingActive)} bearDefenseMode=${boolText(mg.bearDefenseMode)}`,
    `autoTradeEnabled=${boolText(mg.autoTradeEnabled)} emergencyStop=${boolText(mg.emergencyStop)} sellOnlyMode=${boolText(mg.sellOnlyMode)}`,
    `activeRiskFlags=${activeRiskFlags}`,
    `liveBlockReason=${liveBlockReason}`,
    `permissions: ${permissionLine(mg)}`,
    `macroMarketSignal=${macroMarketSignal(mg)}`,
    'providerIssue=false',
    'executionImpact=NONE',
    'diagnosticOnly=true',
    'note: Gate0 slice is read-only; no scan execution, no provider fetch, no broker order, no live promotion.',
  ].join('\n');
}

async function replyInChunks(reply: (message: string) => Promise<void>, message: string): Promise<void> {
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

const scanBlockersGate0: TelegramCommand = {
  name: '/scan_blockers_gate0',
  aliases: ['/blockers_gate0', '/gate0_blockers', '/gate0_macro'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Gate0 macro regime / permission guard slice from latest scan blockers',
  usage: '/scan_blockers_gate0',
  async execute({ reply }) {
    const summary = getLastScanSummary();
    await replyInChunks(reply, [
      '[scan_blockers_gate0] Gate0 Macro / Permission Guard',
      `source=${summary ? 'lastScanSummary' : 'none'} executionImpact=NONE`,
      '',
      formatScanBlockersGate0Section(summary),
    ].join('\n'));
  },
};

commandRegistry.register(scanBlockersGate0);

export default scanBlockersGate0;
