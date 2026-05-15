/**
 * @responsibility ADR-0367 preflight blocked scan summary SSOT — buyListLoop 진입 전 차단 진단 영속.
 *
 * buyListLoop 진입 전 preflight abort (HARD_BLOCK / SELL_ONLY / PRE_FLIGHT_BLOCK / NO_BUYLIST_ELIGIBLE)
 * 시점에 candidateSummaryCount / blockedBy / hardBlock 메타를 module-local SSOT 로 영속해
 * /scan_blockers 와 runtimePipelineAudit 가 "진단 데이터 없음" 대신 "Preflight blocked scan" 을 표시.
 *
 * 절대 invariant:
 *   - executionImpact='NONE' / liveExecutionAllowed=false literal 강제 (TypeScript 컴파일 타임)
 *   - buyListLoopEntered=false / gateSamples=0 literal 강제
 *   - ADR-460 not installed / SectorEnergy STALE 는 hardBlockSource 로 승격 금지 (정적 sanitize)
 *   - KIS/KRX/Yahoo/Naver 신규 호출 0건 (순수 in-memory, 외부 import 0)
 *   - persistScanResults 가 _lastScanSummary 를 채우면 clearPreflightBlockedScanSummary 로 stale 제거
 */

export type PreflightBlockedBy =
  | 'HARD_BLOCK'
  | 'SELL_ONLY'
  | 'PRE_FLIGHT_BLOCK'
  | 'NO_BUYLIST_ELIGIBLE';

export interface PreflightBlockedScanSummary {
  scanId: string;
  timestamp: string;
  stage: 'BEFORE_BUYLIST_LOOP';
  blockedBy: PreflightBlockedBy;
  hardBlockSource?: string;
  hardBlockModule?: string;
  hardBlockReason?: string;
  preflightDecision?: string;
  candidateSummaryCount: number;
  universeSnapshotRecorded: boolean;
  counterfactualRecorded: boolean;
  buyListLoopEntered: false;
  gateSamples: 0;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  perSymbolSupplyInjection?: PreflightBlockedPerSymbolSupplyInjectionStats;
}

export interface RecordPreflightBlockedScanSummaryInput {
  blockedBy: PreflightBlockedBy;
  hardBlockSource?: string;
  hardBlockModule?: string;
  hardBlockReason?: string;
  preflightDecision?: string;
  candidateSummaryCount: number;
  universeSnapshotRecorded: boolean;
  counterfactualRecorded: boolean;
  scanId?: string;
  timestamp?: string;
}

export interface PreflightBlockedPerSymbolSupplyInjectionStats {
  totalCandidates: number;
  requestedSymbols: number;
  receivedResults: number;
  injected: number;
  verified: number;
  degraded: number;
  stale: number;
  missing: number;
  unknown: number;
  routerConnected: boolean;
  gateContextConnected: boolean;
}

/**
 * 금지 (사용자 §"금지"):
 *   - ADR-460 not installed 를 hard block source 로 승격 금지 (diagnostic overlay missing ≠ live hard block)
 *   - SectorEnergy STALE 를 hard block source 로 승격 금지 (ADR-0448 — auxiliary signal, never hard block)
 */
const FORBIDDEN_HARD_BLOCK_SOURCE_PATTERNS: RegExp[] = [
  /ADR[-_ ]?460/i,
  /SECTOR[-_ ]?ENERGY/i,
];

function sanitizeHardBlockSource(source: string | undefined): string | undefined {
  if (!source) return undefined;
  for (const pattern of FORBIDDEN_HARD_BLOCK_SOURCE_PATTERNS) {
    if (pattern.test(source)) {
      console.warn(
        `[PreflightBlockedScan] hardBlockSource "${source}" 는 금지 패턴 (diagnostic overlay / sector energy) — 무시 (ADR-0367)`,
      );
      return undefined;
    }
  }
  return source;
}

let _lastPreflightBlockedScanSummary: PreflightBlockedScanSummary | null = null;

/** UUID-lite — `pbs-${YYYYMMDDHHmm}-${rand4}` 형식 (외부 의존성 0). */
function buildScanId(nowIso: string): string {
  const minute = nowIso.replace(/[-:T]/g, '').slice(0, 12);
  const rand = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
  return `pbs-${minute}-${rand}`;
}

/**
 * preflight abort (buyListLoop 진입 전) 시점에 blocked scan summary 영속 진입점.
 *
 * literal 필드 (stage / buyListLoopEntered / gateSamples / executionImpact / liveExecutionAllowed) 는
 * 입력 무시하고 항상 고정값으로 강제 — 호출자가 schema invariant 를 깰 수 없게 한다.
 * hardBlockSource 는 FORBIDDEN 패턴 통과 시 undefined 로 강등.
 */
export function recordPreflightBlockedScanSummary(
  input: RecordPreflightBlockedScanSummaryInput,
): PreflightBlockedScanSummary {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const rawCount = Number(input.candidateSummaryCount);
  const summary: PreflightBlockedScanSummary = {
    scanId: input.scanId ?? buildScanId(timestamp),
    timestamp,
    stage: 'BEFORE_BUYLIST_LOOP',
    blockedBy: input.blockedBy,
    hardBlockSource: sanitizeHardBlockSource(input.hardBlockSource),
    hardBlockModule: input.hardBlockModule,
    hardBlockReason: input.hardBlockReason,
    preflightDecision: input.preflightDecision,
    candidateSummaryCount: Number.isFinite(rawCount) ? Math.max(0, Math.floor(rawCount)) : 0,
    universeSnapshotRecorded: input.universeSnapshotRecorded === true,
    counterfactualRecorded: input.counterfactualRecorded === true,
    buyListLoopEntered: false,
    gateSamples: 0,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
  };
  _lastPreflightBlockedScanSummary = summary;
  return summary;
}

export function getLastPreflightBlockedScanSummary(): PreflightBlockedScanSummary | null {
  return _lastPreflightBlockedScanSummary;
}

/**
 * persistScanResults 가 정상 ScanSummary 를 영속하면 호출 — preflight blocked summary 는
 * "직전 스캔이 preflight 차단" 을 의미하므로 정상 스캔 1회가 그 의미를 무효화한다.
 */
export function clearPreflightBlockedScanSummary(): void {
  _lastPreflightBlockedScanSummary = null;
}

export function attachPreflightBlockedPerSymbolSupplyInjection(
  stats: PreflightBlockedPerSymbolSupplyInjectionStats,
): void {
  if (!_lastPreflightBlockedScanSummary) return;
  _lastPreflightBlockedScanSummary = {
    ..._lastPreflightBlockedScanSummary,
    perSymbolSupplyInjection: stats,
  };
}

/** /scan_blockers baseMessage 용 plain key=value 섹션 (사용자 §"기대 출력" 정합). */
export function formatPreflightBlockedScanSection(summary: PreflightBlockedScanSummary): string {
  const lines: string[] = [];
  lines.push('📊 <b>[매수 차단 사유]</b>');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('Preflight blocked scan detected');
  lines.push(`latestStage=${summary.stage}`);
  lines.push(`blockedBy=${summary.blockedBy}`);
  if (summary.hardBlockSource) lines.push(`hardBlockSource=${summary.hardBlockSource}`);
  if (summary.hardBlockModule) lines.push(`hardBlockModule=${summary.hardBlockModule}`);
  if (summary.hardBlockReason) lines.push(`hardBlockReason=${summary.hardBlockReason}`);
  if (summary.preflightDecision) lines.push(`preflightDecision=${summary.preflightDecision}`);
  lines.push(`candidateSummaryCount=${summary.candidateSummaryCount}`);
  lines.push(`universeSnapshotRecorded=${summary.universeSnapshotRecorded}`);
  lines.push(`counterfactualRecorded=${summary.counterfactualRecorded}`);
  lines.push(`buyListLoopEntered=${summary.buyListLoopEntered}`);
  lines.push(`executionImpact=${summary.executionImpact}`);
  lines.push('');
  lines.push('📊 <b>Per-Symbol Supply Injection</b>');
  const supplyInjection = summary.perSymbolSupplyInjection;
  lines.push(`  status: ${supplyInjection ? 'DIAGNOSTIC_COLLECTED_PRE_FLIGHT_BLOCK' : 'SKIPPED_PRE_FLIGHT_BLOCK'}`);
  lines.push(`  reason: ${formatPerSymbolSupplyInjectionSkipReason(summary)}`);
  lines.push(`  candidateSummaryCount: ${summary.candidateSummaryCount}`);
  lines.push(`  candidates: ${supplyInjection?.totalCandidates ?? 0}`);
  lines.push(`  requested: ${supplyInjection?.requestedSymbols ?? 0}`);
  lines.push(`  receivedResults: ${supplyInjection?.receivedResults ?? 0}`);
  lines.push(`  injected: ${supplyInjection?.injected ?? 0}`);
  lines.push(`  verified: ${supplyInjection?.verified ?? 0}`);
  lines.push(`  degraded: ${supplyInjection?.degraded ?? 0}`);
  lines.push(`  stale: ${supplyInjection?.stale ?? 0}`);
  lines.push(`  missing: ${supplyInjection?.missing ?? 0}`);
  lines.push(`  unknown: ${supplyInjection?.unknown ?? 0}`);
  lines.push(`  routerConnected: ${supplyInjection?.routerConnected ?? false}`);
  lines.push(`  gateContextConnected: ${supplyInjection?.gateContextConnected ?? false}`);
  return lines.join('\n');
}

function formatPerSymbolSupplyInjectionSkipReason(summary: PreflightBlockedScanSummary): string {
  const decision = summary.preflightDecision ?? summary.blockedBy;
  return `buyListLoopEntered=false / ${decision}`;
}

export function __resetPreflightBlockedScanSummaryForTests(): void {
  _lastPreflightBlockedScanSummary = null;
}
