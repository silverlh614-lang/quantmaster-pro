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
import {
  resolveGate1ForensicNextAction,
  type Gate1MinimumSignalForensicSummaryAdr0505,
} from '../../../trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.js';

/* ───────── Mode parser SSOT ───────── */

export type ScanBlockersMode = 'compact' | 'full' | 'gate' | 'supply' | 'sector' | 'runtime';

/** Gate sub-mode SSOT — ADR-0507 §"Gate Mode Compact Split". */
export type ScanBlockersGateSubMode = 'compact' | 'full';

export type ScanBlockersSupplySubMode =
  | 'summary'
  | 'full'
  | 'carry'
  | 'semantic'
  | 'fields'
  | 'raw'
  | 'next'
  | 'page';

export type PaginatedMessage = {
  page: number;
  totalPages: number;
  title: string;
  body: string;
};

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
 * /scan_blockers args 를 ScanBlockersMode (+ ADR-0507 gate sub-mode) 로 파싱.
 *
 * - 빈 args / 부재 → 'compact' (default).
 * - unknown mode → 'compact' fallback (호출자가 usage 안내 별도 추가 가능).
 * - case-insensitive.
 * - ADR-0507: `gate full` 또는 `gate compact` 만 sub-token 인식. 그 외 sub-token
 *   은 무시 (silent). `gate` 단독 → compact gate (default).
 */
export function parseScanBlockersMode(args: ReadonlyArray<string> | string | undefined): {
  mode: ScanBlockersMode;
  /** Gate sub-mode (mode='gate' 일 때만 의미 있음, 그 외 항상 undefined). */
  gateSubMode?: ScanBlockersGateSubMode;
  /** Supply sub-mode (mode='supply' 일 때만 의미 있음, 그 외 항상 undefined). */
  supplySubMode?: ScanBlockersSupplySubMode;
  /** `supply page N` 요청 page (1-based). */
  supplyPage?: number;
  isUnknown: boolean;
  rawToken: string | null;
} {
  let tokens: string[] = [];
  if (typeof args === 'string') {
    tokens = args.trim().split(/\s+/u).filter((t) => t.length > 0);
  } else if (Array.isArray(args)) {
    tokens = args.map((t) => t.trim()).filter((t) => t.length > 0);
  }
  const token = tokens[0] ?? null;
  if (!token) return { mode: 'compact', isUnknown: false, rawToken: null };
  const normalized = token.toLowerCase();
  if (SCAN_BLOCKERS_ALLOWED_MODES.has(normalized as ScanBlockersMode)) {
    const mode = normalized as ScanBlockersMode;
    if (mode === 'gate') {
      // ADR-0507 — gate sub-mode (compact default, full 옵셔널).
      const subRaw = tokens[1]?.toLowerCase();
      const gateSubMode: ScanBlockersGateSubMode =
        subRaw === 'full' ? 'full' : 'compact';
      return { mode, gateSubMode, isUnknown: false, rawToken: token };
    }
    if (mode === 'supply') {
      const subRaw = tokens[1]?.toLowerCase();
      if (subRaw === 'full') return { mode, supplySubMode: 'full', isUnknown: false, rawToken: token };
      if (subRaw === 'carry') return { mode, supplySubMode: 'carry', isUnknown: false, rawToken: token };
      if (subRaw === 'semantic') return { mode, supplySubMode: 'semantic', isUnknown: false, rawToken: token };
      if (subRaw === 'fields') return { mode, supplySubMode: 'fields', isUnknown: false, rawToken: token };
      if (subRaw === 'raw') return { mode, supplySubMode: 'raw', isUnknown: false, rawToken: token };
      if (subRaw === 'next') return { mode, supplySubMode: 'next', isUnknown: false, rawToken: token };
      if (subRaw === 'page') {
        const requestedPage = Number.parseInt(tokens[2] ?? '1', 10);
        return {
          mode,
          supplySubMode: 'page',
          supplyPage: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
          isUnknown: false,
          rawToken: token,
        };
      }
      return { mode, supplySubMode: 'summary', isUnknown: false, rawToken: token };
    }
    return { mode, isUnknown: false, rawToken: token };
  }
  return { mode: 'compact', isUnknown: true, rawToken: token };
}

/** Mode 안내 한 줄 SSOT — compact / unknown 시 출력. */
export const SCAN_BLOCKERS_USAGE_HINT =
  '상세: /scan_blockers full | gate | gate full | supply | supply full | supply page 1 | sector | runtime';


/* ───────── Supply full pagination SSOT ───────── */

const SCAN_BLOCKERS_SUPPLY_FULL_FOOTER = [
  '전체 확인:',
  '- /scan_blockers supply page 1',
  '- /scan_blockers supply page 2',
  '- /scan_blockers supply carry',
  '- /scan_blockers supply semantic',
  '- /scan_blockers supply fields',
  '- /scan_blockers supply next',
].join('\n');

function buildScanBlockersPageHeader(title: string, page: number, totalPages: number): string {
  return `${title}\nPage ${page}/${totalPages}\n━━━━━━━━━━━━━━━━`;
}

function splitOversizedSectionByLine(section: string, maxBodyChars: number): string[] {
  if (section.length <= maxBodyChars) return [section];
  const chunks: string[] = [];
  let current = '';
  for (const rawLine of section.split('\n')) {
    const linePieces: string[] = [];
    if (rawLine.length <= maxBodyChars) {
      linePieces.push(rawLine);
    } else {
      for (let i = 0; i < rawLine.length; i += maxBodyChars) {
        linePieces.push(rawLine.slice(i, i + maxBodyChars));
      }
    }
    for (const line of linePieces) {
      const candidate = current ? `${current}\n${line}` : line;
      if (candidate.length > maxBodyChars && current) {
        chunks.push(current);
        current = line;
      } else {
        current = candidate;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [''];
}

export function paginateScanBlockersMessage(
  title: string,
  sections: string[],
  maxChars = 3500,
  // Patch-SUPPLY-DIAG-ACCURACY: 옵셔널 footer (default = 기존 SUPPLY_FULL_FOOTER, 후방호환).
  // `full` 모드 페이지네이션은 supply-specific footer 가 부적합 → 빈 문자열 전달로 footer 생략.
  footer: string = SCAN_BLOCKERS_SUPPLY_FULL_FOOTER,
): PaginatedMessage[] {
  const nonEmptySections = sections.filter((section) => section.trim().length > 0);
  const headerReserve = buildScanBlockersPageHeader(title, 999, 999).length + 2;
  const footerReserve = footer.length > 0 ? footer.length + 4 : 0;
  const bodyLimit = Math.max(500, maxChars - headerReserve - footerReserve);
  const normalizedSections = nonEmptySections.flatMap((section) => splitOversizedSectionByLine(section, bodyLimit));
  const pages: string[] = [];
  let current = '';
  for (const section of normalizedSections.length > 0 ? normalizedSections : ['진단 섹션 없음']) {
    const candidate = current ? `${current}\n\n${section}` : section;
    if (candidate.length > bodyLimit && current) {
      pages.push(current);
      current = section;
    } else {
      current = candidate;
    }
  }
  if (current) pages.push(current);

  // footer 가 빈 문자열이면 footer 로직 자체 skip (full 모드용 — supply-specific 안내 부적합).
  if (footer.length > 0) {
    const last = pages[pages.length - 1] ?? '';
    if (`${last}\n\n${footer}`.length <= bodyLimit) {
      pages[pages.length - 1] = `${last}\n\n${footer}`;
    } else {
      pages.push(footer);
    }
  }

  const totalPages = pages.length;
  return pages.map((pageBody, index) => {
    const page = index + 1;
    return {
      page,
      totalPages,
      title,
      body: `${buildScanBlockersPageHeader(title, page, totalPages)}\n${pageBody}`,
    };
  });
}

function fmtCount(value: number | undefined, total: number): string {
  return `${value ?? 0}/${total}`;
}

function fmtTop(distribution: Record<string, number> | undefined, limit = 8): string {
  return Object.entries(distribution ?? {})
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limit)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ') || 'none';
}

function resolveSupplyUnwrapNextActionForScanBlockers(summary: Gate1MinimumSignalForensicSummaryAdr0505): string {
  const breakPoint = Object.entries(summary.semanticRowBreakPointDistribution ?? {})
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  if (breakPoint === 'ADAPTER_DID_NOT_ATTACH_ACTUAL_ROW' || breakPoint === 'ACTUAL_ROW_CARRIED_BUT_EMPTY') return 'WIRE_ADAPTER_ACTUAL_ROW';
  if (breakPoint === 'ROUTER_SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW') return 'WIRE_ROUTER_SELECTED_CANDIDATE_ACTUAL_ROW';
  if (breakPoint === 'FORENSIC_COLLECTOR_DROPPED_ACTUAL_ROW') return 'WIRE_FORENSIC_COLLECTOR_ACTUAL_ROW';
  if (breakPoint === 'ACTUAL_ROW_CARRIED_ALIAS_NOT_MAPPED' || breakPoint === 'NUMERIC_FIELDS_FOUND_BUT_NOT_RECOGNIZED' || breakPoint === 'NESTED_ROW_UNWRAPPED_BUT_ALIAS_NOT_MAPPED') return 'ADD_ALIAS_FOR_ACTUAL_NUMERIC_KEYS';
  if (breakPoint === 'ROW_ARRAY_FOUND_BUT_INVESTOR_TYPE_NOT_MAPPED') return 'MAP_INVESTOR_TYPE_ROWS';
  if (breakPoint === 'ONLY_WRAPPER_METADATA' || breakPoint === 'NO_ROW_FOUND') return 'WIRE_SELECTED_CANDIDATE_ACTUAL_ROW';
  if ((summary.zeroButMaterializedCount ?? 0) > 0) return 'OBSERVE_ZERO_NEUTRAL_SUPPLY';
  return resolveGate1ForensicNextAction(summary);
}

export function buildScanBlockersSupplyForensicSections(
  summary: ScanSummary | null | undefined,
): Record<Exclude<ScanBlockersSupplySubMode, 'page'>, string[]> {
  const forensic = summary?.gate1MinimumSignalForensicAdr0505;
  if (!forensic || forensic.totalCandidates === 0) {
    const unavailable = [
      '요약',
      '- supply forensic unavailable',
      `- candidates=${summary?.candidates ?? 0}`,
      '- gate1MinimumSignalForensicAdr0505=NOT_EMITTED',
      '- nextAction=/scan_blockers gate full',
      '- executionImpact=NONE live=false',
    ].join('\n');
    return { summary: [unavailable], full: [unavailable], carry: [unavailable], semantic: [unavailable], fields: [unavailable], raw: [unavailable], next: [unavailable] };
  }
  const total = forensic.totalCandidates;
  const nextAction = resolveGate1ForensicNextAction(forensic);
  const unwrapNextAction = resolveSupplyUnwrapNextActionForScanBlockers(forensic);
  const dominant = Object.entries(forensic.dominantFailureDistribution ?? {})
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';

  const summarySection = [
    '요약',
    `- candidates=${total}`,
    `- rawInvestorRowAvailable=${fmtCount(forensic.rawInvestorRowAvailableCount, total)}`,
    `- semanticAvailable=${fmtCount(forensic.supplySemanticAvailable, total)}`,
    `- semanticRowAvailable=${fmtCount(forensic.semanticRowAvailableCount, total)}`,
    `- foreignNetBuy=${fmtCount(forensic.foreignNetBuyAvailable, total)}`,
    `- institutionalNetBuy=${fmtCount(forensic.institutionalNetBuyAvailable, total)}`,
    `- dominant=${dominant}`,
    `- semanticReasonDistribution=${fmtTop(forensic.semanticReasonDistribution, 6)}`,
    `- nextAction=${nextAction}`,
    '- executionImpact=NONE live=false',
  ].join('\n');

  const carrySection = [
    'Supply Actual Row Carry',
    `- adapterCarriesActualRow=${fmtCount(forensic.rawInvestorRowAvailableCount, total)}`,
    `- routerCarriesActualRow=${fmtCount(forensic.selectedCandidateCarriesActualRowCount, total)}`,
    `- adapterRowsForwardedAcrossProviders=${fmtCount(forensic.adapterRowsForwardedAcrossProvidersCount, total)}`,
    `- diagnosticActualInvestorRowCarried=${fmtCount(forensic.diagnosticActualInvestorRowCarriedCount, total)}`,
    `- selectedProviderActualRow=${fmtCount(forensic.selectedProviderActualRowCount, total)}`,
    `- diagnosticOnlyActualRow=${fmtCount(forensic.diagnosticOnlyActualRowCount, total)}`,
    `- forensicCarriesActualRow=${fmtCount(forensic.forensicInputCarriesActualInvestorRowsCount, total)}`,
    `- actualInvestorRowProvider=${fmtTop(forensic.actualInvestorRowProviderDistribution)}`,
    `- actualInvestorRowUseScope=${fmtTop(forensic.actualInvestorRowUseScopeDistribution)}`,
    `- actualInvestorRowPath=${fmtTop(forensic.actualInvestorRowPathDistribution)}`,
    `- breakPointTop=${fmtTop(forensic.semanticRowBreakPointDistribution)}`,
    `- nextAction=${unwrapNextAction}`,
  ].join('\n');

  const semanticSection = [
    'Supply Semantic / Semantic Unwrap',
    `- selectedCandidateCarriesSemanticRow=${fmtCount(forensic.selectedCandidateCarriesSemanticRowCount, total)}`,
    `- forensicInputCarriesSemanticRow=${fmtCount(forensic.forensicInputCarriesSemanticRowCount, total)}`,
    `- semanticRowAvailable=${fmtCount(forensic.semanticRowAvailableCount, total)}`,
    `- semanticRowMetadataOnly=${fmtCount(forensic.semanticRowMetadataOnlyCount, total)}`,
    `- supplySemanticAvailable=${fmtCount(forensic.supplySemanticAvailable, total)}`,
    `- supplyDiagnosticAvailable=${fmtCount(forensic.supplyDiagnosticAvailable, total)}`,
    `- zeroButMaterialized=${forensic.zeroButMaterializedCount ?? 0}`,
    `- semanticReasonDistribution=${fmtTop(forensic.semanticReasonDistribution, 10)}`,
    `- semanticRowBreakPointDistribution=${fmtTop(forensic.semanticRowBreakPointDistribution, 10)}`,
    `- wrapperOnly=${fmtCount(forensic.wrapperOnlyCount, total)}`,
    `- rowCandidateCount=${forensic.rowCandidateCount ?? 0}`,
    `- numericCandidateCount=${forensic.numericCandidateCount ?? 0}`,
    `- aliasCandidateCount=${forensic.aliasCandidateCount ?? 0}`,
    `- selectedPathTop=${fmtTop(forensic.selectedPathTop)}`,
    `- rejectedWrapperPathsTop=${fmtTop(forensic.rejectedWrapperPathsTop)}`,
    `- nextAction=${unwrapNextAction}`,
  ].join('\n');

  const fieldsSection = [
    'fieldKeysTop / numericKeysTop / mappedFieldDistribution',
    `- kisRawFieldKeysTop=${fmtTop(forensic.kisRawFieldKeysTop, 12)}`,
    `- actualRawFieldKeysTop=${fmtTop(forensic.actualRawFieldKeysTop, 12)}`,
    `- actualNumericStringFieldKeysTop=${fmtTop(forensic.actualNumericStringFieldKeysTop, 12)}`,
    `- actualNumberFieldKeysTop=${fmtTop(forensic.actualNumberFieldKeysTop, 12)}`,
    `- actualInvestorRowFieldKeysTop=${fmtTop(forensic.actualInvestorRowFieldKeysTop, 12)}`,
    `- actualInvestorNumericStringKeysTop=${fmtTop(forensic.actualInvestorNumericStringKeysTop, 12)}`,
    `- actualInvestorNumberKeysTop=${fmtTop(forensic.actualInvestorNumberKeysTop, 12)}`,
    `- selectedActualRawFieldKeysTop=${fmtTop(forensic.selectedActualRawFieldKeysTop, 12)}`,
    `- selectedNumericStringFieldKeysTop=${fmtTop(forensic.selectedNumericStringFieldKeysTop, 12)}`,
    `- candidateNetBuyFieldKeysTop=${fmtTop(forensic.candidateNetBuyFieldKeysTop, 12)}`,
    `- kisNormalizedFieldKeysTop=${fmtTop(forensic.kisNormalizedFieldKeysTop, 12)}`,
    `- kisSemanticFieldKeysTop=${fmtTop(forensic.kisSemanticFieldKeysTop, 12)}`,
    `- mappedFieldDistribution.foreign=${fmtTop(forensic.mappedFieldDistribution?.foreign, 8)}`,
    `- mappedFieldDistribution.institution=${fmtTop(forensic.mappedFieldDistribution?.institution, 8)}`,
    `- mappedFieldDistribution.individual=${fmtTop(forensic.mappedFieldDistribution?.individual, 8)}`,
  ].join('\n');

  const rawSection = [
    'raw / materialized / normalized / breakPoint',
    `- rawInvestorRowAvailable=${fmtCount(forensic.rawInvestorRowAvailableCount, total)}`,
    `- materialized.foreignNetBuy=${fmtCount(forensic.foreignNetBuyAvailable, total)}`,
    `- materialized.institutionalNetBuy=${fmtCount(forensic.institutionalNetBuyAvailable, total)}`,
    `- zeroButMaterialized=${forensic.zeroButMaterializedCount ?? 0}`,
    `- sampleValueKinds=${fmtTop(forensic.sampleValueKindDistribution, 10)}`,
    `- providerScopeDistribution=${fmtTop(forensic.providerScopeDistribution, 8)}`,
    `- scoreUsageDistribution=${fmtTop(forensic.scoreUsageDistribution, 8)}`,
    `- supplyUnknownRootCause=${fmtTop(forensic.supplyUnknownRootCauseDistribution, 8)}`,
    `- selectedRowScoreAvg=${Number.isFinite(forensic.selectedRowScoreAvg) ? forensic.selectedRowScoreAvg : 'n/a'}`,
    `- breakPointTop=${fmtTop(forensic.semanticRowBreakPointDistribution, 10)}`,
    `- supplyRouterForensicConflict=${forensic.supplyRouterForensicConflict === true}`,
    `- routerStatus=${forensic.routerStatus ?? 'UNKNOWN'} routerSignal=${forensic.routerSignal ?? 'UNKNOWN'} conflictReason=${forensic.routerForensicConflictReason ?? 'NONE'}`,
    `- nextAction=${unwrapNextAction}`,
  ].join('\n');

  const nextSection = [
    'nextAction / breakPointTop / recommended patch target',
    `- dominant=${dominant}`,
    `- semanticReasonTop=${fmtTop(forensic.semanticReasonDistribution, 6)}`,
    `- breakPointTop=${fmtTop(forensic.semanticRowBreakPointDistribution, 8)}`,
    `- gateNextAction=${nextAction}`,
    `- supplyUnwrapNextAction=${unwrapNextAction}`,
    `- recommendedPatchTarget=${unwrapNextAction}`,
    '- KIS/KRX/Yahoo/Naver new calls=0',
    '- executionImpact=NONE live=false',
  ].join('\n');

  return {
    summary: [summarySection],
    full: [summarySection, carrySection, semanticSection, fieldsSection, rawSection, nextSection],
    carry: [carrySection],
    semantic: [semanticSection],
    fields: [fieldsSection],
    raw: [rawSection],
    next: [nextSection],
  };
}

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

function fmtDistribution(distribution: Record<string, number> | undefined, limit = 3): string {
  const entries = Object.entries(distribution ?? {})
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  return entries.length > 0 ? entries.map(([key, value]) => `${key} ${value}`).join(', ') : 'none';
}

function isGate1NotEvaluatedState(state: string | undefined): boolean {
  return state === 'PARTIAL_TRACE_ONLY' || Boolean(state?.startsWith('NOT_EVALUATED_'));
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

  // MinSignal requiredAvg / actualAvg / gap (ADR-0466 / 0505 / 0507)
  if (forensic) {
    // ADR-0505 schema 정합 — actualScoreAvg / requiredScoreAvg.
    const actualAvg = forensic.actualScoreAvg;
    const required = forensic.requiredScoreAvg;
    if (isGate1NotEvaluatedState(forensic.evaluationState)) {
      lines.push(`• MinScore: n/a (${forensic.evaluationState}, diagnostic fallback ${actualAvg.toFixed(1)})`);
    } else {
      lines.push(`• MinScore: ${fmtPctGap(actualAvg, required)}`);
    }
    const dist = forensic.dominantFailureDistribution;
    if (dist) {
      const top = Object.entries(dist)
        .filter(([, v]) => Number.isFinite(v) && v > 0)
        .sort((a, b) => b[1] - a[1])[0];
      if (top) lines.push(`• dominant: ${top[0]} (${top[1]})`);
    }
    // ADR-0507 §B — missing positive top + penalty top (compact 한 줄씩, 옵셔널).
    const missing = forensic.missingPositiveSourceCounts;
    if (missing) {
      const topMissing = Object.entries(missing)
        .filter(([, v]) => Number.isFinite(v) && v > 0)
        .sort((a, b) => b[1] - a[1])[0];
      if (topMissing) lines.push(`• missing+: ${topMissing[0]} (${topMissing[1]})`);
    }
    const penalty = forensic.penaltyCounts;
    if (penalty) {
      const topPen = Object.entries(penalty)
        .filter(([, v]) => Number.isFinite(v) && v > 0)
        .sort((a, b) => b[1] - a[1])[0];
      if (topPen) lines.push(`• penalty: ${topPen[0]} (${topPen[1]})`);
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
    const audit = (sectorEnergyDiag as { representativeBasketAudit?: { breakPoint?: string; representativeBasketActualRows?: number; representativeBasketExpectedRows?: number; nextAction?: string } }).representativeBasketAudit;
    if (audit) {
      lines.push(`• SectorAudit: rows=${audit.representativeBasketActualRows ?? '?'}/${audit.representativeBasketExpectedRows ?? '?'} breakPoint=${audit.breakPoint ?? 'UNKNOWN'}`);
    }
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

/* ───────── ADR-0507 — Gate compact formatter SSOT ───────── */

/**
 * Gate compact 30~40줄 — `/scan_blockers gate` 기본 출력.
 *
 * 사용자 명시 §B 직접 반영:
 *   - ADR-0505 emission 상태 (EMITTED / NOT_EMITTED 분류)
 *   - Gate1 survivor count + candidate 비율
 *   - requiredScoreAvg / actualScoreAvg / avgScoreGap (3 줄)
 *   - dominantFailure 분포 Top 3
 *   - missing positive Top 3
 *   - penalty Top 3
 *   - supply scope warnings (있을 때만)
 *   - usage hint pointing to `/scan_blockers gate full`
 *
 * 안전 — diagnostic/display only. throw 안 함 (모든 옵셔널 필드 safe fallback).
 * executionImpact='NONE', liveExecutionAllowed=false.
 */
export function formatScanBlockersGateCompactMessage(
  summary: ScanSummary | null | undefined,
  options: { adr0505?: Adr0505EmissionDiagnostic } = {},
): string {
  const lines: string[] = [];
  const forensic = summary?.gate1MinimumSignalForensicAdr0505;
  const adr0505 = options.adr0505;

  // 헤더
  const tsStr = typeof summary?.time === 'string' ? summary.time : null;
  const tsMs = tsStr ? Date.parse(tsStr) : NaN;
  const tsLabel = Number.isFinite(tsMs) ? fmtKstHm(tsMs) : '미실행';
  lines.push(`🚪 <b>Gate1 Minimum Signal: ${forensic?.evaluationState ?? '미실행'}</b> ${tsLabel}`);
  lines.push('━━━━━━━━━━━━━━');

  // ADR-0505 emission (1줄 요약)
  if (adr0505) {
    const firstLine = formatAdr0505EmissionCompactLine(adr0505).split('\n')[0];
    lines.push(firstLine);
  }

  // candidates / survivors
  const candidates = summary?.candidates ?? 0;
  const gate1Pass = summary?.gatePassDistribution?.gate1Pass ?? Math.max(0, candidates - (summary?.gateMisses ?? 0));
  const gate2Pass = summary?.gatePassDistribution?.gate2Pass ?? 0;
  lines.push(`• Gate1 pass: ${gate1Pass}/${candidates}`);
  lines.push(`• Gate2 pass: ${gate2Pass}/${gate1Pass}`);
  const leadership = summary?.freshGate2Attribution?.leadershipAttribution;
  const sectorDiag = summary?.sectorEnergyQualityDiagnostic;
  if (leadership) {
    lines.push('Gate2 Leadership:');
    lines.push(`- gate1Pass=${leadership.gate1Pass}`);
    lines.push(`- gate2Pass=${leadership.gate2Pass}`);
    lines.push(`- dominant=${leadership.dominantReason}`);
    if (sectorDiag) lines.push(`- sectorValid=${sectorDiag.validSectorCount}/${sectorDiag.expectedSectorCount}`);
    lines.push('- nextAction=/scan_blockers sector');
  }

  if (!forensic || forensic.totalCandidates === 0) {
    lines.push('• forensic: n/a (ADR-0505 NOT_EMITTED — /scan_blockers full 참조)');
    lines.push(SCAN_BLOCKERS_GATE_FULL_HINT);
    return lines.join('\n');
  }

  const notEvaluated = isGate1NotEvaluatedState(forensic.evaluationState);
  if (notEvaluated) {
    const reasonParts = [
      forensic.evaluationState,
      forensic.buyListLoopEntered ? null : 'buyListLoop not reached',
    ].filter(Boolean);
    lines.push(`• reason: ${reasonParts.join(' / ')}`);
    lines.push(`• candidates: ${forensic.totalCandidates}`);
    lines.push(`• evaluated: ${forensic.evaluatedCandidateCount ?? 0}`);
    lines.push(`• traceOnly: ${forensic.traceOnlyCandidateCount ?? forensic.totalCandidates}`);
    lines.push(`• minScore: n/a (diagnostic fallback ${forensic.actualScoreAvg.toFixed(1)})`);
    lines.push('• live failure 판단 아님');
    lines.push('• 안내: SELL_ONLY/장외 trace는 diagnostic snapshot입니다. BUY_ALLOWED 정규장 fresh scan에서 Gate1/MinSignal을 재검증하십시오.');
  } else {
    // 점수 분포 (실제 평가 실행 시에만 주요 판정값으로 표시)
    lines.push(`• requiredAvg: ${forensic.requiredScoreAvg.toFixed(1)}`);
    lines.push(`• actualAvg:   ${forensic.actualScoreAvg.toFixed(1)}`);
    lines.push(`• gap:         ${forensic.avgScoreGap.toFixed(1)}`);
    lines.push(`• failed: ${forensic.failedCandidates} / total: ${forensic.totalCandidates}`);
  }

  if (!notEvaluated) {
  // dominant failure Top 3
  const dist = forensic.dominantFailureDistribution;
  const dominantEntries = Object.entries(dist)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (dominantEntries.length > 0) {
    lines.push('— dominant failure Top 3 —');
    for (const [reason, count] of dominantEntries) {
      lines.push(`  ${reason}: ${count}`);
    }
  }

  // missing positive Top 3
  const missing = forensic.missingPositiveSourceCounts;
  const missingEntries = Object.entries(missing)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (missingEntries.length > 0) {
    lines.push('— missing positive Top 3 —');
    for (const [src, count] of missingEntries) {
      lines.push(`  ${src}: ${count}`);
    }
  }

  // penalty Top 3
  const penalty = forensic.penaltyCounts;
  const penaltyEntries = Object.entries(penalty)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (penaltyEntries.length > 0) {
    lines.push('— penalty Top 3 —');
    for (const [src, count] of penaltyEntries) {
      lines.push(`  ${src}: ${count}`);
    }
  }

  // supply scope warnings (있을 때만)
  const supplyWarnings = forensic.supplyScopeWarnings;
  const supplyEntries = Object.entries(supplyWarnings)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (supplyEntries.length > 0) {
    lines.push('— supply scope warnings —');
    for (const [w, count] of supplyEntries.slice(0, 3)) {
      lines.push(`  ${w}: ${count}`);
    }
  }

  }

  lines.push(`• watchlistImported: ${forensic.watchlistScoreImportedCount ?? 0}/${forensic.totalCandidates}`);
  lines.push(`• rsTraceAvailable: ${forensic.rsTraceAvailableCount ?? forensic.rsHydrationAvailableCount ?? 0}/${forensic.totalCandidates}`);
  lines.push(`• rsScoreUsable: ${forensic.rsScoreUsableCount ?? 0}/${forensic.totalCandidates}`);
  lines.push(`• breakoutTraceAvailable: ${forensic.breakoutTraceAvailableCount ?? forensic.breakoutHydrationAvailableCount ?? 0}/${forensic.totalCandidates}`);
  lines.push(`• breakoutScoreUsable: ${forensic.breakoutScoreUsableCount ?? 0}/${forensic.totalCandidates}`);
  lines.push(`• traceCompleteness: quote ${forensic.traceWithQuoteCount ?? forensic.candidateTraceHasQuote ?? 0}/${forensic.totalCandidates}, symbolFeatures ${forensic.traceWithSymbolFeaturesCount ?? forensic.candidateTraceHasSymbolFeatures ?? 0}/${forensic.totalCandidates}, conditionResults ${forensic.traceWithConditionResultsCount ?? forensic.candidateTraceHasConditionResults ?? 0}/${forensic.totalCandidates}`);
  lines.push(`• sourcePath: ${fmtDistribution(forensic.sourcePathDistribution)}`);
  lines.push(`• watchlistBreakPoint: ${fmtDistribution(forensic.watchlistBreakPointDistribution, 2)}`);
  lines.push(`• quoteHydrationBreakPoint: ${fmtDistribution(forensic.quoteHydrationBreakPointDistribution, 2)}`);
  lines.push(`• conditionResultsBreakPoint: ${fmtDistribution(forensic.conditionResultsBreakPointDistribution, 2)}`);
  lines.push(`• supplySymbolMatched: ${forensic.supplySymbolMatchedCount ?? forensic.symbolMatchedCount ?? 0}/${forensic.totalCandidates}`);
  const topMissingFields = forensic.topHydrationMissingFields ?? [];
  if (topMissingFields.length > 0) {
    lines.push(`• topMissingFields: ${topMissingFields.slice(0, 4).join(', ')}`);
  }

  lines.push(`• SectorEnergy: boost=0 strongBuyBlocked=${forensic.sectorEnergyStrongBuyBlockedCount}`);

  lines.push(`• nextAction: ${notEvaluated ? 'RUN_BUY_ALLOWED_FRESH_SCAN or WIRE_WATCHLIST_UPSTREAM_SCORE' : resolveGate1ForensicNextAction(forensic)}`);

  // 안전 invariant (절대 변경 금지 — 정적 grep 가드 회귀 테스트 검증)
  lines.push(`• executionImpact=${forensic.executionImpact} impact: ${forensic.executionImpact} liveExecutionAllowed=${forensic.liveExecutionAllowed}`);

  lines.push(SCAN_BLOCKERS_GATE_FULL_HINT);
  return lines.join('\n');
}

/** Gate compact 모드 안내 한 줄 — full 호출 안내 SSOT. */
export const SCAN_BLOCKERS_GATE_FULL_HINT =
  '상세 ADR 섹션: /scan_blockers gate full | /scan_blockers full';

/* ───────── Mode → ADR group inclusion SSOT ───────── */

/**
 * 사용자 명시 §E-H ADR 그룹 매트릭스 (절대 변경 금지).
 * Mode 별 포함 ADR 번호 — 호출자 측 section 필터링 시 활용.
 */
export const MODE_ADR_INCLUSION: Readonly<Record<Exclude<ScanBlockersMode, 'full' | 'compact'>, ReadonlyArray<string>>> = Object.freeze({
  gate: ['0465', '0466', '0467', '0468', '0469', '0470', '0471', '0472', '0475', '0476', '0505'],
  supply: ['0473', '0477', '0481', '0482', '0483', '0484', '0485', '0486', '0487', '0491', '0498', '0518'],
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
 * - Patch-SHADOW-APPROVAL-DEDUP-001 — `[PATCH-RUNTIME]` 태그를 포함한 section 은
 *   ADR 발급 없이 runtime 모드 출력에 포함 (MODE_ADR_INCLUSION 본체 변경 없이 확장).
 */
export function sectionMatchesMode(section: string | null | undefined, mode: ScanBlockersMode): boolean {
  if (!section) return false;
  if (mode === 'full' || mode === 'compact') return true;
  if (mode === 'runtime' && section.includes('[PATCH-RUNTIME]')) return true;
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
  return applyScanBlockersLengthBudget(message, budget);
}

export function applyScanBlockersLengthBudget(message: string, budget: number): string {
  if (message.length <= budget) return message;
  const suffix = `\n…\n(truncated — /scan_blockers full 로 전체 출력 확인)`;
  const sliceLen = Math.max(0, budget - suffix.length);
  return message.slice(0, sliceLen) + suffix;
}

export const SCAN_BLOCKERS_GATE_COMPACT_LENGTH_BUDGET = 2500;
