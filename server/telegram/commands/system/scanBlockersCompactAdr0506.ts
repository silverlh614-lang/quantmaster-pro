/**
 * @responsibility ADR-0506 — /scan_blockers compact mode + ADR-0505 emission verification SSOT.
 *
 * 사용자 명시 §"목표" 직접 반영:
 *   1) /scan_blockers 기본 출력은 compact summary (15~25줄).
 *   2) /scan_blockers full 기존 장문 출력 보존.
 *   3) gate / supply / sector / runtime 세부 모드 분리.
 *   4) ADR-0505 미노출 시 NOT_EMITTED 진단 compact 표시.
 *   5) summary 부재 시 SUMMARY_FIELD_MISSING / FORENSIC_INPUTS_MISSING 등 명시.
 *
 * 안전 원칙: diagnostic/display only. live trading / score / threshold / order path
 * 변경 0. executionImpact='NONE', liveExecutionAllowed=false. console.log 직접 추가
 * 금지 (LOG_LEVEL/Noise suppression 정책 정합).
 */

import type { ScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';

/* ───────── Mode parser SSOT ───────── */

export type ScanBlockersMode = 'compact' | 'full' | 'gate' | 'supply' | 'sector' | 'runtime';

/** 6 허용 모드 (절대 변경 금지) */
export const SCAN_BLOCKERS_ALLOWED_MODES: ReadonlySet<ScanBlockersMode> = new Set<ScanBlockersMode>([
  'compact',
  'full',
  'gate',
  'supply',
  'sector',
  'runtime',
]);

/**
 * /scan_blockers args 를 ScanBlockersMode 로 파싱.
 * - 빈 args / 부재 → 'compact' (default).
 * - unknown mode → 'compact' fallback (호출자가 usage 안내 별도 추가 가능).
 * - case-insensitive.
 */
export function parseScanBlockersMode(args: ReadonlyArray<string> | string | undefined): {
  mode: ScanBlockersMode;
  isUnknown: boolean;
  rawToken: string | null;
} {
  let token: string | null = null;
  if (typeof args === 'string') {
    token = args.trim().split(/\s+/u)[0] ?? null;
  } else if (Array.isArray(args)) {
    token = args[0]?.trim() ?? null;
  }
  if (!token) return { mode: 'compact', isUnknown: false, rawToken: null };
  const normalized = token.toLowerCase();
  if (SCAN_BLOCKERS_ALLOWED_MODES.has(normalized as ScanBlockersMode)) {
    return { mode: normalized as ScanBlockersMode, isUnknown: false, rawToken: token };
  }
  return { mode: 'compact', isUnknown: true, rawToken: token };
}

/** Mode 안내 한 줄 SSOT — compact / unknown 시 출력. */
export const SCAN_BLOCKERS_USAGE_HINT =
  '상세: /scan_blockers full | gate | supply | sector | runtime';

/* ───────── ADR-0505 Emission Status SSOT ───────── */

/**
 * ADR-0505 Gate1 Minimum Signal Forensic Audit emission status.
 * 사용자 명시 7-value union (절대 변경 금지).
 *
 * - EMITTED: summary.gate1MinimumSignalForensicAdr0505 존재 + totalCandidates>0.
 * - DISABLED_BY_ENV: process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED='true'.
 * - SUMMARY_FIELD_MISSING: summary 자체 부재 또는 gate1MinimumSignalForensicAdr0505 undefined.
 * - FORENSIC_INPUTS_MISSING: persistScanResults 호출자가 gate1ForensicInputs 미전달.
 * - BUILDER_NOT_CALLED: gate1ForensicInputs 존재하지만 builder 가 호출되지 않음 (논리 결함).
 * - FORMATTER_NOT_WIRED: summary 존재하지만 /scan_blockers formatter 가 미참조 (논리 결함).
 * - PERSIST_SKIPPED: persistScanResults 호출 자체가 skip된 경우 (스캔 미실행 등).
 * - UNKNOWN: 위 분류 불가.
 */
export type Adr0505EmissionStatus =
  | 'EMITTED'
  | 'DISABLED_BY_ENV'
  | 'SUMMARY_FIELD_MISSING'
  | 'FORENSIC_INPUTS_MISSING'
  | 'BUILDER_NOT_CALLED'
  | 'FORMATTER_NOT_WIRED'
  | 'PERSIST_SKIPPED'
  | 'UNKNOWN';

export interface Adr0505EmissionDiagnostic {
  status: Adr0505EmissionStatus;
  hasSummary: boolean;
  hasSummaryField: boolean;
  envDisabled: boolean;
  totalCandidates: number | null;
  recommendedAction: string;
}

/**
 * ADR-0505 emission 진단 SSOT.
 *
 * 사용자 명시 §C 결정 트리 (절대 변경 금지):
 *   1) ENV disabled → DISABLED_BY_ENV.
 *   2) summary 자체 부재 → PERSIST_SKIPPED.
 *   3) summary 존재 + gate1MinimumSignalForensicAdr0505 부재 → SUMMARY_FIELD_MISSING.
 *      (이는 persistScanResults 호출자가 gate1ForensicInputs 미전달과 동일한 증상이라
 *       FORENSIC_INPUTS_MISSING 보다 SUMMARY_FIELD_MISSING 우선; recommendedAction 에서
 *       gate1ForensicInputs wiring 안내 동봉.)
 *   4) summary.gate1MinimumSignalForensicAdr0505 존재 + totalCandidates=0 → BUILDER_NOT_CALLED
 *      (입력은 있었으나 결과 0건 — Phase 1 wiring 결함).
 *   5) summary.gate1MinimumSignalForensicAdr0505 존재 + totalCandidates>0 → EMITTED.
 */
export function deriveAdr0505EmissionStatus(
  summary: ScanSummary | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Adr0505EmissionDiagnostic {
  const envDisabled = env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED === 'true';
  if (envDisabled) {
    return {
      status: 'DISABLED_BY_ENV',
      hasSummary: !!summary,
      hasSummaryField: false,
      envDisabled: true,
      totalCandidates: null,
      recommendedAction:
        'unset GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED env var to re-enable.',
    };
  }
  if (!summary) {
    return {
      status: 'PERSIST_SKIPPED',
      hasSummary: false,
      hasSummaryField: false,
      envDisabled: false,
      totalCandidates: null,
      recommendedAction:
        'no scan summary recorded — wait for next scan or check persistScanResults call site.',
    };
  }
  const forensic = summary.gate1MinimumSignalForensicAdr0505;
  if (!forensic) {
    return {
      status: 'SUMMARY_FIELD_MISSING',
      hasSummary: true,
      hasSummaryField: false,
      envDisabled: false,
      totalCandidates: null,
      recommendedAction:
        'check PersistScanResultsOptions.gate1ForensicInputs wiring at the call site (likely FORENSIC_INPUTS_MISSING upstream).',
    };
  }
  const totalCandidates = forensic.totalCandidates ?? 0;
  if (totalCandidates === 0) {
    return {
      status: 'BUILDER_NOT_CALLED',
      hasSummary: true,
      hasSummaryField: true,
      envDisabled: false,
      totalCandidates: 0,
      recommendedAction:
        'gate1ForensicInputs collector likely empty — verify Phase 1 input wiring.',
    };
  }
  return {
    status: 'EMITTED',
    hasSummary: true,
    hasSummaryField: true,
    envDisabled: false,
    totalCandidates,
    recommendedAction: 'OK — forensic audit emitted normally.',
  };
}

/** ADR-0505 emission compact 라인 SSOT (compact + gate 모드용, ≤3 lines). */
export function formatAdr0505EmissionCompactLine(diag: Adr0505EmissionDiagnostic): string {
  if (diag.status === 'EMITTED') {
    return `🧬 ADR-0505 Gate1 Forensic: EMITTED ✅ (${diag.totalCandidates}건)`;
  }
  const lines: string[] = [];
  lines.push(`🧬 ADR-0505 Gate1 Forensic: ${diag.status} ⚠️`);
  lines.push(`  reason=${diag.status}`);
  lines.push(`  action=${diag.recommendedAction}`);
  lines.push('  impact=NONE');
  return lines.join('\n');
}

/** ADR-0505 emission detail block SSOT (full 모드용). */
export function formatAdr0505EmissionDetailBlock(diag: Adr0505EmissionDiagnostic): string {
  const lines: string[] = [];
  lines.push('🧬 ADR-0505 Gate1 Forensic Emission Diagnostic');
  lines.push(`  • status: ${diag.status}`);
  lines.push(`  • envDisabled: ${diag.envDisabled}`);
  lines.push(`  • hasSummary: ${diag.hasSummary}`);
  lines.push(`  • hasSummaryField: ${diag.hasSummaryField}`);
  lines.push(`  • totalCandidates: ${diag.totalCandidates ?? 'n/a'}`);
  lines.push(`  • recommendedAction: ${diag.recommendedAction}`);
  lines.push('  • impact: NONE (diagnostic only, ADR-0506)');
  return lines.join('\n');
}

/* ───────── Compact Formatter SSOT ───────── */

function fmtKstHm(ts: number | undefined | null): string {
  if (!ts || !Number.isFinite(ts)) return '미실행';
  try {
    return new Date(ts).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '미실행';
  }
}

function fmtPctGap(actual: number | undefined, required: number | undefined): string {
  if (!Number.isFinite(actual) || !Number.isFinite(required)) return 'n/a';
  const a = actual as number;
  const r = required as number;
  return `${a.toFixed(1)} / ${r.toFixed(1)} (gap ${(a - r).toFixed(1)})`;
}

/**
 * Compact summary — 사용자 명시 §B 형식 (15~25줄 이내, ≤2000자 권장).
 * 운영 핵심 판단만 노출.
 *
 * 입력 schema 는 ScanSummary 의 옵셔널 필드 위주로 *모두 안전 fallback*. 누락 시
 * 'n/a' 또는 '미실행' 표기. throw 시 호출자 catch (본 함수는 throw 안 함).
 */
export function formatScanBlockersCompactMessage(
  summary: ScanSummary | null | undefined,
  options: { adr0505?: Adr0505EmissionDiagnostic } = {},
): string {
  const lines: string[] = [];
  const macro = summary?.macroGateState;
  const router = summary?.investorFlowProviderRouter;
  const forensic = summary?.gate1MinimumSignalForensicAdr0505;
  // sectorEnergyQualityDiagnostic 가 더 상세 (ADR-0423) — sectorEnergyQuality 라벨 후방호환.
  const sectorEnergyDiag = summary?.sectorEnergyQualityDiagnostic;
  const sectorEnergyLabel = summary?.sectorEnergyQuality;

  // ScanSummary.time 은 string (ISO) — Date.parse 로 변환 (실패 시 미실행).
  const tsStr = typeof summary?.time === 'string' ? summary.time : null;
  const tsMs = tsStr ? Date.parse(tsStr) : NaN;
  const tsLabel = Number.isFinite(tsMs) ? fmtKstHm(tsMs) : '미실행';
  lines.push(`📊 <b>[매수 차단 요약]</b> ${tsLabel}`);
  lines.push('━━━━━━━━━━━━━━');

  // session / SELL_ONLY
  const sellOnly = macro?.sellOnlyMode ? 'SELL_ONLY ⚠️' : '정규장';
  lines.push(`• session: ${sellOnly}`);

  // candidates / entries
  const candidates = summary?.candidates ?? 0;
  const entries = summary?.entries ?? 0;
  lines.push(`• candidates: ${candidates} / entries: ${entries}`);

  // top empty scan reason
  const emptyScanReason = summary?.emptyScanReason ?? (entries === 0 ? 'EMPTY_SCAN' : 'OK');
  lines.push(`• topReason: ${emptyScanReason}`);

  // Gate1 survivor count — ScanSummary.gatePassDistribution.gate1Pass (옵셔널).
  const gate1Pass = summary?.gatePassDistribution?.gate1Pass ?? Math.max(0, candidates - (summary?.gateMisses ?? 0));
  lines.push(`• Gate1: ${gate1Pass}/${candidates}`);

  // MinSignal requiredAvg / actualAvg / gap (ADR-0466 / 0505)
  if (forensic) {
    const actualAvg = (forensic as { averageActualScore?: number }).averageActualScore;
    const required = (forensic as { requiredScore?: number }).requiredScore;
    lines.push(`• MinScore: ${fmtPctGap(actualAvg, required)}`);
    const dist = (forensic as { dominantFailureDistribution?: Record<string, number> })
      .dominantFailureDistribution;
    if (dist) {
      const top = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
      if (top) lines.push(`• dominant: ${top[0]}`);
    }
  } else {
    lines.push('• MinScore: n/a (forensic missing)');
  }

  // Supply — coverage 는 {available, total, missing, stale, ...} 시그니처.
  if (router) {
    const cov = router.coverage
      ? `${router.coverage.available ?? '?'}/${router.coverage.total ?? '?'}`
      : 'n/a';
    const exec = router.executionImpact ?? 'n/a';
    lines.push(
      `• Supply: ${router.selectedProvider ?? '?'} ${router.status ?? '?'}, ${exec}, coverage ${cov}`,
    );
  } else {
    lines.push('• Supply: n/a');
  }

  // SectorEnergy — diagnostic 우선, fallback to label.
  if (sectorEnergyDiag) {
    const dq = (sectorEnergyDiag as { dataQuality?: string }).dataQuality ?? sectorEnergyLabel ?? 'UNKNOWN';
    const block = (sectorEnergyDiag as { shouldBlockLeadershipConfidence?: boolean })
      .shouldBlockLeadershipConfidence;
    lines.push(`• SectorEnergy: ${dq}${block ? ', leadership BLOCKED' : ''}`);
  } else if (sectorEnergyLabel) {
    lines.push(`• SectorEnergy: ${sectorEnergyLabel}`);
  } else {
    lines.push('• SectorEnergy: n/a');
  }

  // ADR-0505 emission status (1줄 요약)
  if (options.adr0505) {
    const firstLine = formatAdr0505EmissionCompactLine(options.adr0505).split('\n')[0];
    lines.push(`• ${firstLine}`);
  }

  // dominant blocker (waitDistribution top reason)
  const wd = (summary as { waitDistribution?: Record<string, number> })?.waitDistribution;
  if (wd) {
    const top = Object.entries(wd).filter(([, v]) => Number.isFinite(v) && v > 0).sort((a, b) => b[1] - a[1])[0];
    if (top) lines.push(`• blocker: ${top[0]} (${top[1]})`);
  }

  lines.push(SCAN_BLOCKERS_USAGE_HINT);
  return lines.join('\n');
}

/* ───────── Mode → ADR group inclusion SSOT ───────── */

/**
 * 사용자 명시 §E-H ADR 그룹 매트릭스 (절대 변경 금지).
 * Mode 별 포함 ADR 번호 — 호출자 측 section 필터링 시 활용.
 */
export const MODE_ADR_INCLUSION: Readonly<Record<Exclude<ScanBlockersMode, 'full' | 'compact'>, ReadonlyArray<string>>> = Object.freeze({
  gate: ['0465', '0466', '0467', '0468', '0469', '0470', '0471', '0472', '0475', '0476', '0505'],
  supply: ['0473', '0477', '0481', '0482', '0483', '0484', '0485', '0486', '0487', '0491', '0498'],
  sector: ['0423', '0446', '0448', '0474', '0488'],
  runtime: ['0425', '0426', '0430', '0433', '0451', '0461', '0464', '0500', '0501'],
});

/**
 * Section 의 ADR 마커 (예: "ADR-0505", "🛡️ ... ADR-0451") 를 추출.
 * 어떤 mode 에 포함되는지 판정하는 데 사용.
 */
export function extractAdrMarkersFromSection(section: string): string[] {
  const matches = section.match(/ADR-(\d{4})/g) ?? [];
  return Array.from(new Set(matches.map((m) => m.replace('ADR-', ''))));
}

/**
 * 주어진 section 이 특정 mode 에 속하는지 판정 SSOT.
 * - section 안에 mode 포함 ADR 번호가 1개라도 매칭되면 true.
 * - mode='full' 또는 'compact' 호출자가 직접 결정 (본 함수는 분류 mode 만).
 */
export function sectionMatchesMode(section: string | null | undefined, mode: ScanBlockersMode): boolean {
  if (!section) return false;
  if (mode === 'full' || mode === 'compact') return true;
  const markers = extractAdrMarkersFromSection(section);
  const allowed = MODE_ADR_INCLUSION[mode];
  return markers.some((m) => allowed.includes(m));
}

/* ───────── Message length guard SSOT ───────── */

/**
 * 사용자 명시 §K 메시지 길이 가드 (절대 변경 금지).
 * compact: 2000자 / full: 4096자 (Telegram 한도) / gate/supply/sector/runtime: 4000자.
 */
export const SCAN_BLOCKERS_LENGTH_BUDGET: Readonly<Record<ScanBlockersMode, number>> = Object.freeze({
  compact: 2000,
  full: 4096,
  gate: 4000,
  supply: 4000,
  sector: 4000,
  runtime: 4000,
});

/**
 * 메시지가 budget 을 초과하면 truncate + 안내 추가. budget 이하면 그대로 반환.
 */
export function applyScanBlockersLengthGuard(message: string, mode: ScanBlockersMode): string {
  const budget = SCAN_BLOCKERS_LENGTH_BUDGET[mode];
  if (message.length <= budget) return message;
  const suffix = `\n…\n(truncated — /scan_blockers full 로 전체 출력 확인)`;
  const sliceLen = Math.max(0, budget - suffix.length);
  return message.slice(0, sliceLen) + suffix;
}
