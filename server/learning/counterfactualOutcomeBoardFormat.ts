// @responsibility Format read-only counterfactual outcome board sections into Telegram diagnostic text.
import type {
  CounterfactualOutcomeBoard,
  CounterfactualBandOutcome,
} from './counterfactualOutcomeBoard.js';

function pct(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : 'N/A';
}

function num(value: number | null | undefined, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : 'N/A';
}

/** 부호 명시 % — 초과수익(alpha) 표기 (+x.xx% / -x.xx%), 부재 시 N/A. */
function signedPct(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
    : 'N/A';
}

/**
 * KOSPI 초과수익 컬럼 suffix (2026-07-03 patch — display-only additive).
 * kospiJoinStatus 미전달(gate2/gate3 뷰) 시 '' — 기존 라인 byte 무변경.
 */
function kospiExcessSuffix(row: CounterfactualBandOutcome, kospiJoinStatus?: 'JOINED' | 'UNAVAILABLE'): string {
  if (kospiJoinStatus === undefined) return '';
  if (kospiJoinStatus === 'UNAVAILABLE') return ' excessD5=N/A(idx=UNAVAILABLE)';
  return ` excessD5=${signedPct(row.avgExcessD5)} winVsMkt=${pct(row.winVsMarketD5)} (idx n=${row.kospiJoinedD5 ?? 0})`;
}

function safetyLine(ok: boolean, code: string, note: string): string {
  return `[${ok ? 'OK' : 'WARN'}] ${code} - ${note}`;
}

function distributionLine(title: string, distribution: Record<string, number>, limit = 8): string {
  const entries = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => `${key}=${count}`);
  return `${title}: ${entries.length ? entries.join(', ') : 'none'}`;
}

export function formatCounterfactualSafetyChecks(board: CounterfactualOutcomeBoard): string {
  const s = board.safety;
  return [
    safetyLine(s.counterfactualReportingNonExecutional, 'COUNTERFACTUAL_REPORTING_NON_EXECUTIONAL', 'outcomes are not connected to trading decisions'),
    safetyLine(s.thresholdAutoChangeForbidden, 'THRESHOLD_AUTO_CHANGE_FORBIDDEN', 'thresholdAutoChanged=false'),
    safetyLine(s.livePermissionUnchanged, 'LIVE_PERMISSION_UNCHANGED', 'live permission is read-only in this board'),
    safetyLine(s.shadowLearningContinues, 'SHADOW_LEARNING_CONTINUES', 'shadow/counterfactual diagnostics remain on'),
    safetyLine(s.sourceSnapshotLinked, 'SOURCE_SNAPSHOT_LINKED', 'included rows carry scan/source/candidate ids at >=95%'),
    safetyLine(s.outcomeMaturityRequired, 'OUTCOME_MATURITY_REQUIRED', 'pre-D5 rows stay insufficient maturity'),
    safetyLine(s.gateBlockerAttributionPreserved, 'GATE_BLOCKER_ATTRIBUTION_PRESERVED', 'primary/secondary blockers are preserved'),
  ].join('\n');
}

export function formatCounterfactualBoardSummary(board: CounterfactualOutcomeBoard): string {
  const s = board.summary;
  return [
    '[Counterfactual Outcome Board]',
    `Period: ${board.periodLabel}`,
    `Total recorded: ${s.totalRecorded}`,
    `Mature D1/D3/D5/D10: ${s.matureD1} / ${s.matureD3} / ${s.matureD5} / ${s.matureD10}`,
    '',
    `D5 Avg Return: ${num(s.avgReturnD5, '%')}`,
    `D5 Win Rate: ${pct(s.winRateD5)}`,
    `D5 Missed Opportunity(+3%): ${pct(s.missedOpportunityRateD5)}`,
    `D5 Correct Block: ${pct(s.correctBlockRateD5)}`,
    `False Negative: ${pct(s.falseNegativeRateD5)}`,
    `Data Unavailable Rate: ${pct(s.dataUnavailableRate)}`,
    '',
    'Verdict:',
    `- Gate1: ${board.review.gate1ReviewReady ? 'READY_FOR_OPERATOR_REVIEW' : 'OBSERVE_MORE'}`,
    `- Gate2: ${board.review.gate2ReviewReady ? 'READY_FOR_OPERATOR_REVIEW' : 'OBSERVE_MORE'}`,
    `- Gate3: ${board.review.gate3ReviewReady ? 'READY_FOR_OPERATOR_REVIEW' : 'OBSERVE_MORE'}`,
    '- Threshold Auto Change: OFF',
    '- Operator Approval Required: ON',
    '- Execution Impact: NONE',
    '',
    formatCounterfactualSafetyChecks(board),
  ].join('\n');
}

function formatBandRows(title: string, rows: readonly CounterfactualBandOutcome[], kospiJoinStatus?: 'JOINED' | 'UNAVAILABLE'): string {
  const lines = [title];
  for (const row of rows) {
    lines.push(
      `${row.key}: n=${row.count} matureD5=${row.matureD5} avgD5=${num(row.avgReturnD5, '%')} win=${pct(row.winRateD5)} +3=${pct(row.hitPlus3PctRateD5)} correctBlock=${pct(row.correctBlockRateD5)} missed=${pct(row.missedOpportunityRateD5)} recommendation=${row.recommendation ?? 'OBSERVE_MORE'}${kospiExcessSuffix(row, kospiJoinStatus)}`,
    );
  }
  lines.push('thresholdAutoChanged=false operatorApprovalRequired=true executionImpact=NONE');
  return lines.join('\n');
}

export function formatCounterfactualGate1(board: CounterfactualOutcomeBoard): string {
  // 비가시 탈락 가시화(2026-06-11 §4 · 2026-06-12 Track A R1): UNSCORED/excluded 행이 5밴드에 안 잡혀
  // "전 밴드 0건"을 숨긴다 — scoreSource 격리(70+)·제외 사유 분포 명시 노출 (board.debug 재사용; silent 금지).
  const excludedTotal = Object.values(board.debug.excludedReasonDistribution).reduce((sum, n) => sum + n, 0);
  const legacyScale70Plus = board.rows.filter((row) => row.gate1Band === '70+' && row.scoreSource !== 'MIN_SIGNAL_TRACE').length;
  const g = board.bandMaturityStallGuard;
  const stallPrefix = g.status === 'STALL_SUSPECTED' ? '⚠️ ' : '';
  return [
    formatBandRows('[Counterfactual Gate1 Bands]', board.gate1Bands, board.kospiJoinStatus ?? 'UNAVAILABLE'),
    `legacyScaleMixed(밴드 제외): n=${board.gate1LegacyScale.count} matureD5=${board.gate1LegacyScale.matureD5} avgD5=${num(board.gate1LegacyScale.avgReturnD5, '%')} correctBlock=${pct(board.gate1LegacyScale.correctBlockRateD5)}`,
    `${stallPrefix}bandMaturityStallGuard: status=${g.status} oldestAgeTradingDays=${g.oldestBandRowAgeTradingDays ?? 'N/A'} totalMatureD5=${g.totalBandMatureD5}/${g.totalBandRows} threshold=${g.stallThresholdTradingDays} missingRefPrice=${g.excludedReferencePriceCount} action=${g.recommendedAction}`,
    `legacyScale70Plus(scoreSource 격리): n=${legacyScale70Plus}`,
    `unscored=${board.rows.filter((row) => row.gate1Band === 'UNSCORED').length} excludedRows=${excludedTotal}`,
    distributionLine('excludedByReason', board.debug.excludedReasonDistribution),
    // KOSPI 시장 컨텍스트 1줄 (2026-07-03 patch — display-only additive).
    `kospiD5Avg=${signedPct(board.kospiAvgD5)} joinStatus=${board.kospiJoinStatus ?? 'UNAVAILABLE'}`,
  ].join('\n');
}

export function formatCounterfactualGate2(board: CounterfactualOutcomeBoard): string {
  return formatBandRows('[Counterfactual Gate2 Review]', board.gate2Blockers);
}

export function formatCounterfactualGate3(board: CounterfactualOutcomeBoard): string {
  return formatBandRows('[Counterfactual Gate3 Review]', board.gate3Blockers);
}

export function formatCounterfactualMissed(board: CounterfactualOutcomeBoard): string {
  const lines = ['[Top Missed Opportunities D5]'];
  if (board.topMissedOpportunities.length === 0) {
    lines.push('INSUFFICIENT_SAMPLE - OBSERVE_MORE - NO_THRESHOLD_CHANGE');
  }
  board.topMissedOpportunities.forEach((row, index) => {
    lines.push(
      `${index + 1}. ${row.symbol}${row.name ? ` ${row.name}` : ''}`,
      `D5 ${num(row.returnD5, '%')} / MFE ${num(row.mfeD5, '%')} / MAE ${num(row.maeD5, '%')}`,
      `blockedBy=${[row.blockedByPrimary, row.blockedBySecondary].filter(Boolean).join(',') || 'N/A'}`,
      `gate1Score=${num(row.gate1Score)} / band=${row.gate1Band}`,
      `label=${row.outcomeLabel}`,
      `action=${row.recommendedAction}`,
    );
  });
  lines.push('executionImpact=NONE thresholdAutoChanged=false operatorApprovalRequired=true');
  return lines.join('\n');
}

export function formatCounterfactualToday(board: CounterfactualOutcomeBoard): string {
  const t = board.today;
  return [
    '[Counterfactual Today]',
    `date: ${t.dateKey}`,
    `scanId: ${t.scanId ?? 'N/A'}`,
    `sourceSnapshotId: ${t.sourceSnapshotId ?? 'N/A'}`,
    `total recorded: ${t.totalRecorded}`,
    `ready count: ${t.gateCounterfactualReadyCount}`,
    `entryCounterfactualRecorded: ${t.entryCounterfactualRecorded}`,
    `pending count: ${t.pendingCount}`,
    `Gate1 fail count: ${t.gate1FailCount}`,
    `Gate2 fail count: ${t.gate2FailCount}`,
    `Gate3 blocked/wait count: ${t.gate3BlockedOrWaitCount}`,
    `paper observational symbols: ${t.paperObservationalSymbols.length ? t.paperObservationalSymbols.join(', ') : '-'}`,
    'thresholdAutoChanged=false',
    'executionImpact=NONE',
    'Shadow/Learning/Counterfactual=ON',
  ].join('\n');
}

export function formatCounterfactualReview(board: CounterfactualOutcomeBoard): string {
  const r = board.review;
  return [
    '[Counterfactual Review Readiness]',
    `status=${r.status}`,
    `gate1BandReview=${r.gate1ReviewReady ? 'READY' : 'INSUFFICIENT_SAMPLE'}`,
    `gate2BlockerReview=${r.gate2ReviewReady ? 'READY' : 'INSUFFICIENT_SAMPLE'}`,
    `gate3Review=${r.gate3ReviewReady ? 'READY' : 'INSUFFICIENT_SAMPLE'}`,
    `blockers=${r.blockers.length ? r.blockers.join(',') : 'NONE'}`,
    `nextAction=${r.nextAction}`,
    'NO_THRESHOLD_CHANGE',
    'thresholdAutoChanged=false operatorApprovalRequired=true executionImpact=NONE',
  ].join('\n');
}

export function formatCounterfactualDebug(board: CounterfactualOutcomeBoard): string {
  const d = board.debug;
  const lines = [
    '[Counterfactual Debug]',
    `totalRawRows=${d.totalRawRows}`,
    `includedRows=${d.includedRows}`,
    `excludedRows=${d.excludedRows}`,
    `summaryVerdict=${board.summary.verdict}`,
    `todayRecorded=${board.today.totalRecorded}`,
    board.summary.verdict === 'NO_VALID_COUNTERFACTUAL_ROWS'
      ? 'operatorAction=FIX_ROW_SELECTION_OR_COUNTERFACTUAL_WRITE_PATH'
      : 'operatorAction=OBSERVE_INCLUDED_COUNTERFACTUAL_ROWS',
    '',
    'Linkage:',
    `sourceSnapshotLinked=${board.safety.sourceSnapshotLinked}`,
    `hasScanId=${d.hasScanIdCount}/${d.includedRows}`,
    `hasSourceSnapshotId=${d.hasSourceSnapshotIdCount}/${d.includedRows}`,
    `hasCandidateSetId=${d.hasCandidateSetIdCount}/${d.includedRows}`,
    `hasSymbol=${d.hasSymbolCount}/${d.includedRows}`,
    `hasGate1Score=${d.hasGate1ScoreCount}/${d.includedRows}`,
    `hasBlockedBy=${d.hasBlockedByCount}/${d.includedRows}`,
    '',
    'Distributions:',
    distributionLine('rowTypeDistribution', d.rowTypeDistribution),
    distributionLine('sourceLaneDistribution', d.sourceLaneDistribution),
    distributionLine('idPrefixDistribution', d.idPrefixDistribution),
    '',
    'Excluded:',
    distributionLine('excludedReasonDistribution', d.excludedReasonDistribution),
    '',
    'sampleRows:',
  ];
  for (const row of board.rows.slice(0, 10)) {
    lines.push(`${row.symbol} id=${row.counterfactualId} rowType=${row.rowType} sourceLane=${row.sourceLane} scanId=${row.scanId ?? 'N/A'} sourceSnapshotId=${row.sourceSnapshotId ?? 'N/A'} candidateSetId=${row.candidateSetId ?? 'N/A'} gate1=${row.gate1Score ?? 'N/A'} band=${row.gate1Band} blockedBy=${row.blockedByPrimary ?? row.blockerVector[0] ?? 'N/A'} gate2=${row.gate2Status} gate3=${row.gate3Status} label=${row.outcomeLabel}`);
  }
  if (d.excludedSampleRows.length > 0) {
    lines.push('', 'excludedSampleRows:');
    for (const row of d.excludedSampleRows) {
      lines.push(`${row.symbol ?? 'N/A'} id=${row.counterfactualId} rowType=${row.rowType} sourceLane=${row.sourceLane} scanId=${row.scanId ?? 'N/A'} sourceSnapshotId=${row.sourceSnapshotId ?? 'N/A'} candidateSetId=${row.candidateSetId ?? 'N/A'} gate1=${row.gate1Score ?? 'N/A'} band=${row.gate1Band} gate3=${row.gate3Status} excludedReason=${row.excludedReason}`);
    }
  }
  lines.push(
    '',
    'Safety:',
    'executionImpact=NONE',
    'thresholdAutoChanged=false',
    `livePermissionUnchanged=${board.safety.livePermissionUnchanged}`,
    `shadowLearningContinues=${board.safety.shadowLearningContinues}`,
    `counterfactualReportingNonExecutional=${board.safety.counterfactualReportingNonExecutional}`,
  );
  return lines.join('\n');
}

export type CounterfactualCommandMode =
  | 'summary'
  | 'today'
  | 'gate1'
  | 'gate2'
  | 'gate3'
  | 'missed'
  | 'review'
  | 'debug';

export function resolveCounterfactualCommandMode(command?: string, args: readonly string[] = []): CounterfactualCommandMode {
  const token = (command ?? args[0] ?? '/counterfactual').toLowerCase();
  const arg = (args[0] ?? '').toLowerCase();
  if (token === '/counterfactual_today' || arg === 'today') return 'today';
  if (token === '/counterfactual_gate1' || arg === 'gate1') return 'gate1';
  if (token === '/counterfactual_gate2' || arg === 'gate2') return 'gate2';
  if (token === '/counterfactual_gate3' || arg === 'gate3') return 'gate3';
  if (token === '/counterfactual_missed' || arg === 'missed') return 'missed';
  if (token === '/counterfactual_review' || arg === 'review') return 'review';
  if (token === '/counterfactual_debug' || arg === 'debug') return 'debug';
  return 'summary';
}

export function formatCounterfactualCommandReply(
  board: CounterfactualOutcomeBoard,
  mode: CounterfactualCommandMode,
): string {
  if (mode === 'today') return formatCounterfactualToday(board);
  if (mode === 'gate1') return formatCounterfactualGate1(board);
  if (mode === 'gate2') return formatCounterfactualGate2(board);
  if (mode === 'gate3') return formatCounterfactualGate3(board);
  if (mode === 'missed') return formatCounterfactualMissed(board);
  if (mode === 'review') return formatCounterfactualReview(board);
  if (mode === 'debug') return formatCounterfactualDebug(board);
  return formatCounterfactualBoardSummary(board);
}
