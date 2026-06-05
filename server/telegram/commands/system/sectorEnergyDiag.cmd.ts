// @responsibility sectorEnergyDiag.cmd 텔레그램 모듈
// @responsibility: /sector_energy_diag — sectorEnergy 4-axis 통합 진단. SYS ADMIN read-only.
//
// ADR-0398 (= 사용자 명시 ADR-0373) — 사용자 명시 진단 명령:
//   1. sourceTier (KRX_CODE/STOCK_DAILY/CACHE/YAHOO_ETF/FAILED)
//   2. freshness (FRESH/DEGRADED/EXPIRED)
//   3. coverage (validSectorCount / 12)
//   4. confidence (0~1, sourceWeight × freshnessWeight × coverage)
//   5. dataQuality (OK/PARTIAL/STALE/DEGRADED/FAILED)
//   + high-conviction label diagnostic evidence (ADR-0398 SSOT 호출)
//
// 외부 호출 0건 — read-only macroStateRepo. 부수효과 없음.

import { createHash } from 'node:crypto';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import {
  evaluateSectorEnergyStrongBuyGate,
  isSectorEnergyStrongBuyGateDisabled,
} from '../../../trading/sectorEnergyStrongBuyGate.js';
import {
  computeConfidence,
  type SectorEnergyDataQuality5,
  type SectorEnergySourceTier,
  type SectorEnergyFreshness,
} from '../../../clients/sectorEnergyDataQuality.js';
// ADR-0423: SectorEnergy 데이터 진실성 진단 SSOT — quality reason 분해 + leadershipConfidence.
import { formatSectorEnergyQualityDiagnosticSection } from '../../../clients/sectorEnergyQualityDiagnostic.js';
// ADR-0446: Phase 2 indexCode recovery + sanity violation 진단 섹션 SSOT.
import {
  formatPhase2RecoverySection,
  formatKrxSectorIndexRawDiagnosticSection,
} from '../../../clients/sectorEnergyIndexCodeRecoveryDiagnostic.js';
import { formatSanityDiagnosticSection } from '../../../clients/sectorEnergySanityViolationDiagnostic.js';
import { fetchKisSectorIndexRowsDryRun, formatKisSectorIndexDryRunSection } from '../../../clients/kisSectorEnergyProvider.js';
import {
  buildSectorEnergyCoverageRecoveryReport,
  formatSectorEnergyCoverageRecoverySection,
} from '../../../clients/sectorEnergyCoverageRecoveryAdr0474.js';
import {
  renderSectorEnergyCanonicalOutput,
  sectorEnergyCanonicalOrMissing,
} from '../../../../src/domain/sector-energy/SectorEnergyCanonicalResolver.js';
import { getLastSectorEnergyCanonicalState } from '../../../trading/signalScanner/sectorEnergyCanonicalStateRef.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

interface SectorEnergyConfidenceDisplay {
  value: number;
  confidenceClass: 'VERIFIED' | 'PARTIAL' | 'DEGRADED' | 'MISSING';
  suffix?: string;
  reason?: string;
}

// ─── ADR-0577 Stage 2 — DISPLAY_ONLY: 레거시 basket 진단 모순 collapse ──────────
// canonical resolver 가 VERIFIED/promotionCoveragePass=true 일 때, 하단 레거시 basket
// 진단이 "공식 섹터지수 미가용"으로 오해되는 라인(officialCoverage 0/N · officialIndexCoverage
// % · breakPoint=OFFICIAL_SECTOR_INDEX_UNAVAILABLE · official unavailable 류)을 *부차
// diagnostic-only* 로 재라벨/축약한다. 판단·게이팅 값 0 변경(scan_blockers
// stripStaleSectorEnergyBlockers collapse 패턴 재사용). canonical 이 PASS 가 아닐 때는
// 레거시 라인을 그대로 둬 진짜 basket fallback·저하 가시성을 보존한다(collapse 는 PASS 조건부).

/**
 * canonical PASS 시 "공식 섹터지수 미가용"으로 오독되는 레거시 basket 진단 라인 판별 토큰
 * (정규식, 출력 전용). 라벨 자체가 canonical 11/11 VERIFIED 와 모순으로 읽히므로 percent
 * 값과 무관하게(0.0% 뿐 아니라 77.8% 등) collapse 대상 — basket 은 canonical PASS 시 *부차
 * diagnostic-only* 라서 "official 미가용"으로 읽히면 안 된다.
 */
const ADR0572_OFFICIAL_UNAVAILABLE_DISPLAY_PATTERNS: readonly RegExp[] = [
  /OFFICIAL_SECTOR_INDEX_UNAVAILABLE/,
  /officialCoverage:\s*<b>0\//,
  // officialIndexCoverage / productionOfficialCoverage 라인은 percent 값과 무관하게 collapse
  // (라벨이 canonical VERIFIED 와 모순으로 읽힘). canonical 은 별도 상단 블록에서 11/11 표기.
  /officialIndexCoverage:/i,
  /productionOfficialCoverage:/i,
  /officialIndex:\s*unavailable/i,
];

/**
 * ADR-0577 Stage 2 (DISPLAY_ONLY): canonical PASS 조건부 레거시 basket 진단 collapse.
 *   canonicalPass=true  → "공식 미가용"으로 읽히는 모순 라인 제거 + 축약 표기 1줄로 재라벨.
 *   canonicalPass=false → 입력 라인 그대로 반환(저하 가시성 보존).
 * 게이팅/판단 값 변경 없음 — 출력만 정합화(scan_blockers collapse 패턴 재사용).
 */
export function collapseLegacyBasketDiagnosticForDisplay(
  canonicalPass: boolean,
  lines: readonly string[],
): string[] {
  if (canonicalPass !== true) return [...lines];
  const kept: string[] = [];
  let collapsedCount = 0;
  for (const line of lines) {
    if (ADR0572_OFFICIAL_UNAVAILABLE_DISPLAY_PATTERNS.some((re) => re.test(line))) {
      collapsedCount += 1;
      continue;
    }
    kept.push(line);
  }
  if (collapsedCount > 0) {
    kept.push(
      `  • <i>secondaryDiagnosticOnly (ADR-0577): ${collapsedCount} legacy basket-derived "official unavailable" line(s) collapsed — canonical official sector index is VERIFIED/PASS; basket is diagnostic-only and does not drive promotion.</i>`,
    );
  }
  return kept;
}

function classifyConfidenceDisplay(
  value: number,
): SectorEnergyConfidenceDisplay['confidenceClass'] {
  if (value >= 0.85) return 'VERIFIED';
  if (value >= 0.5) return 'PARTIAL';
  if (value > 0) return 'DEGRADED';
  return 'MISSING';
}

function confidenceEmoji(value: number): string {
  return value >= 0.8 ? '✅' : value >= 0.5 ? '🟡' : value >= 0.3 ? '🟠' : '❌';
}

function resolveSectorEnergyConfidenceDisplay(input: {
  confidence: unknown;
  sourceTier?: SectorEnergySourceTier;
  freshness?: SectorEnergyFreshness;
  coverage: unknown;
  kisBasketCoverage?: unknown;
}): SectorEnergyConfidenceDisplay | null {
  const stored =
    typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? Math.max(0, Math.min(1, input.confidence))
      : undefined;
  const coverage =
    typeof input.coverage === 'number' && Number.isFinite(input.coverage)
      ? Math.max(0, Math.min(1, input.coverage))
      : 0;
  const kisBasketCoverage =
    typeof input.kisBasketCoverage === 'number' &&
    Number.isFinite(input.kisBasketCoverage)
      ? Math.max(0, Math.min(1, input.kisBasketCoverage))
      : 0;

  if (input.sourceTier === 'KIS_STOCK_BASKET_DERIVED') {
    const effectiveCoverage = Math.max(coverage, kisBasketCoverage);
    const computed = computeConfidence(
      input.sourceTier,
      input.freshness ?? 'FRESH',
      effectiveCoverage,
    );
    const value = Math.max(stored ?? 0, computed);
    return {
      value,
      confidenceClass: value >= 0.3 ? 'PARTIAL' : 'DEGRADED',
      suffix: 'KIS basket derived',
      reason:
        'KIS basket is derived from official KIS daily prices, not an official sector index. It is usable for shadow/watch ranking but not for strong-buy unlock.',
    };
  }

  if (stored === undefined) return null;
  return {
    value: stored,
    confidenceClass: classifyConfidenceDisplay(stored),
  };
}

/** 5단계 dataQuality → emoji 마커 (ADR-0396 정합). */
function resolveSectorEnergyQualityEmoji(
  dataQuality: SectorEnergyDataQuality5 | undefined,
): string {
  const map: Partial<Record<SectorEnergyDataQuality5, string>> = {
    OK: '✅',
    PARTIAL: '🟡',
    STALE: '🟠',
    DEGRADED: '🔶',
    FAILED: '❌',
  };
  return (dataQuality && map[dataQuality]) || '⚪';
}

/** sourceTier 라인 (ADR-0396 신규 필드 / 미수집 후방호환). */
function buildSectorEnergySourceTierLine(sourceTier: SectorEnergySourceTier | undefined): string {
  if (sourceTier !== undefined) return `📡 legacySourceTierDiagnosticOnly: <b>${sourceTier}</b>`;
  return `📡 legacySourceTierDiagnosticOnly: <i>미수집 (ADR-0396 격상 전 영속 데이터)</i>`;
}

/** freshness 라인 (FRESH/DEGRADED/그외 emoji). */
function buildSectorEnergyFreshnessLine(freshness: SectorEnergyFreshness | undefined): string {
  if (freshness === undefined) return `⏱️ legacyFreshnessDiagnosticOnly: <i>미수집</i>`;
  const freshEmoji = freshness === 'FRESH' ? '✅' : freshness === 'DEGRADED' ? '🟡' : '❌';
  return `⏱️ legacyFreshnessDiagnosticOnly: ${freshEmoji} <b>${freshness}</b>`;
}

/** coverage 라인 (number / validCount-only / 미수집). */
function buildSectorEnergyCoverageLine(coverage: unknown, validCount: unknown): string {
  if (typeof coverage === 'number' && Number.isFinite(coverage)) {
    return `📊 legacyCoverageDiagnosticOnly: <b>${(coverage * 100).toFixed(1)}%</b> (${validCount ?? '?'}/12 섹터)`;
  }
  if (typeof validCount === 'number') {
    return `📊 legacyCoverageDiagnosticOnly: <i>미수집</i> (${validCount}/12 섹터)`;
  }
  return `📊 legacyCoverageDiagnosticOnly: <i>미수집</i>`;
}

/** confidence 라인 (display 있으면 emoji+class+reason, 없으면 미수집). */
function buildSectorEnergyConfidenceLines(confidenceDisplay: SectorEnergyConfidenceDisplay | null): string[] {
  if (!confidenceDisplay) return [`🎯 legacyConfidenceDiagnosticOnly: <i>미수집</i>`];
  const suffix = confidenceDisplay.suffix ? `, ${confidenceDisplay.suffix}` : '';
  const out = [
    `🎯 legacyConfidenceDiagnosticOnly: ${confidenceEmoji(confidenceDisplay.value)} <b>${(confidenceDisplay.value * 100).toFixed(1)}%</b> ` +
      `(${confidenceDisplay.confidenceClass}${suffix})`,
  ];
  if (confidenceDisplay.reason) out.push(`  • reason: <i>${confidenceDisplay.reason}</i>`);
  return out;
}

/** ADR-0399 KRX 원천 복구 진단 섹션 (diag 메타 분해). */
function buildSectorEnergyKrxRecoveryLines(
  diag: NonNullable<MacroSectorEnergyDiag>,
  sourceTier: SectorEnergySourceTier | undefined,
): string[] {
  const lines: string[] = ['', '🔍 <b>[KRX 원천 복구 진단 (ADR-0399)]</b>'];
  if (diag.candidateDates && diag.candidateDates.length > 0) {
    lines.push(`📅 candidateDates: <code>${diag.candidateDates.join(', ')}</code>`);
  }
  if (diag.sourceTierAttempts && diag.sourceTierAttempts.length > 0) {
    lines.push(`🪜 sourceTierAttempts:`);
    for (const a of diag.sourceTierAttempts) {
      const reason = a.reason ? ` — ${a.reason}` : '';
      lines.push(`  • <b>${a.tier}</b>: validCount=${a.validCount}${reason}`);
    }
  }
  if (diag.fallbackReason) {
    lines.push(`⚠️ fallbackReason: <i>${diag.fallbackReason}</i>`);
  }
  if (diag.coverageBreakdown) {
    const c = diag.coverageBreakdown;
    lines.push('');
    lines.push('📊 <b>[Production SectorEnergy]</b>');
    lines.push(`legacySelectedSourceTierDiagnosticOnly: <code>${diag.finalSourceTier ?? sourceTier ?? 'MISSING'}</code>`);
    lines.push(`officialCoverage: <b>${c.kisOfficialCount + c.verifiedIndexCodeCount}/${c.totalSectors}</b>`);
    lines.push(`basketCoverage: <b>${c.kisBasketCount}/${c.totalSectors}</b>`);
    lines.push('legacySectorBoostAllowedDiagnosticOnly: <b>false</b>');
    lines.push('highConvictionLabel: <b>finalScore-only</b>');
    lines.push(`executionImpact: <code>${diag.executionImpact ?? 'NONE'}</code>`);
    lines.push(`  • productionOfficialCoverage: <b>${(Math.max(c.verifiedIndexCodeCoverage, c.kisOfficialCoverage) * 100).toFixed(1)}%</b> (${Math.max(c.verifiedIndexCodeCount, c.kisOfficialCount)}/${c.totalSectors})`);
    lines.push(`  • productionBasketCoverage: <b>${(c.kisBasketCoverage * 100).toFixed(1)}%</b> (${c.kisBasketCount}/${c.totalSectors})`);
    lines.push(`  • internalProxyCoverage: <b>${(c.internalProxyCoverage * 100).toFixed(1)}%</b> (${c.internalProxyCount}/${c.totalSectors})`);
    lines.push(`  • stockDailyFallbackCoverage: <b>${(c.stockDailyFallbackCoverage * 100).toFixed(1)}%</b> (${c.stockDailyFallbackCount}/${c.totalSectors})`);
  }
  if (diag.leadershipConfidence) {
    lines.push(`🧭 legacyLeadershipConfidenceDiagnosticOnly: <b>${diag.leadershipConfidence}</b>`);
  }
  if (diag.selectedSectors && diag.selectedSectors.length > 0) {
    lines.push(`🏁 selectedSectors: <code>${diag.selectedSectors.join(', ')}</code>`);
  }
  lines.push(`🛡 liveExecutionAllowed: <b>${String(diag.liveExecutionAllowed ?? false)}</b>`);
  lines.push(`🧪 executionImpact: <b>${diag.executionImpact ?? 'NONE'}</b>`);
  return lines;
}

/** ADR-0423/0446 — qualityDiag 하위 진단 섹션 (quality/phase2/krxRaw/sanity). */
function buildSectorEnergyQualityDiagLines(
  qualityDiag: NonNullable<MacroSectorEnergyQualityDiag>,
): string[] {
  const lines: string[] = [''];
  const section = formatSectorEnergyQualityDiagnosticSection(qualityDiag);
  if (section) lines.push(section);
  if (qualityDiag.sectorIndexRecovery) {
    const phase2 = formatPhase2RecoverySection(qualityDiag.sectorIndexRecovery);
    if (phase2) {
      lines.push('');
      lines.push(phase2);
    }
  }
  if (qualityDiag.krxSectorIndexRaw) {
    const krxRaw = formatKrxSectorIndexRawDiagnosticSection(qualityDiag.krxSectorIndexRaw);
    if (krxRaw) {
      lines.push('');
      lines.push(krxRaw);
    }
  }
  if (qualityDiag.sanityViolation) {
    const sanity = formatSanityDiagnosticSection(qualityDiag.sanityViolation);
    if (sanity) {
      lines.push('');
      lines.push(sanity);
    }
  }
  return lines;
}

/** ADR-0398 high-conviction label diagnostics 섹션. */
function buildSectorEnergyHighConvictionLines(input: {
  sourceTier: SectorEnergySourceTier | undefined;
  dataQuality: SectorEnergyDataQuality5 | undefined;
  confidenceDisplay: SectorEnergyConfidenceDisplay | null;
}): string[] {
  if (isSectorEnergyStrongBuyGateDisabled()) {
    return ['High-conviction label diagnostics disabled by ENV `SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true`.'];
  }
  if (
    input.sourceTier !== undefined &&
    input.dataQuality !== undefined &&
    input.confidenceDisplay !== null
  ) {
    const gate = evaluateSectorEnergyStrongBuyGate({
      confidence: input.confidenceDisplay.value,
      dataQuality: input.dataQuality,
      sourceTier: input.sourceTier,
    });
    const lines = ['<b>[High-conviction label diagnostics]</b> score/diagnostic only; no buy block or downgrade.'];
    if (gate.reasons.length > 0) {
      for (const reason of gate.reasons) lines.push(`  - ${reason}`);
    } else {
      lines.push('  - all SectorEnergy label diagnostics clear');
    }
    return lines;
  }
  return ['<b>[High-conviction label diagnostics]</b> unavailable: 4-axis data missing.'];
}

type MacroSectorEnergyDiag = ReturnType<typeof loadMacroState> extends infer M
  ? M extends { sectorEnergyDiagnostics?: infer D }
    ? D
    : never
  : never;
type MacroSectorEnergyQualityDiag =
  | Parameters<typeof formatSectorEnergyQualityDiagnosticSection>[0]
  | undefined;

/**
 * /sector_energy_diag 메시지 빌더 SSOT (단위 테스트 가능).
 *
 * 안전 invariant — read-only, 외부 호출 0건, manual override 트리거 0건.
 */
export function formatSectorEnergyDiagMessage(): string {
  const macro = loadMacroState();
  const canonical = sectorEnergyCanonicalOrMissing(getLastSectorEnergyCanonicalState());
  const lines: string[] = [];
  lines.push('🌐 <b>[Sector Energy 4-axis 진단]</b>');
  lines.push('');
  lines.push(renderSectorEnergyCanonicalOutput(canonical));
  lines.push('');

  if (!macro) {
    lines.push('⚠️ <i>macroState 부재 — sectorEnergy 미수집</i>');
    const adr0474 = formatSectorEnergyCoverageRecoverySection(
      buildSectorEnergyCoverageRecoveryReport(),
    );
    if (adr0474) {
      lines.push('');
      lines.push(adr0474);
      console.log(
        '[ADR-0474] SectorEnergy coverage recovery fallback mounted to /sector_energy_diag',
      );
    }
    return lines.join('\n');
  }

  // 5단계 dataQuality 마커 SSOT (ADR-0396 정합)
  const dataQuality = macro.sectorEnergyDataQuality as
    | SectorEnergyDataQuality5
    | undefined;
  const qualityEmoji = resolveSectorEnergyQualityEmoji(dataQuality);
  lines.push(`${qualityEmoji} legacyDataQualityDiagnosticOnly: <b>${dataQuality ?? '미수집'}</b>`);

  // 4-axis 개별 표시 (ADR-0396 신규 필드)
  const sourceTier = macro.sectorEnergySourceTier as
    | SectorEnergySourceTier
    | undefined;
  const freshness = macro.sectorEnergyFreshness as
    | SectorEnergyFreshness
    | undefined;
  const coverage = macro.sectorEnergyCoverage;
  const confidence = macro.sectorEnergyConfidence;
  const validCount = macro.sectorEnergyValidSectorCount;
  const diag = macro.sectorEnergyDiagnostics;

  lines.push(buildSectorEnergySourceTierLine(sourceTier));
  lines.push(buildSectorEnergyFreshnessLine(freshness));
  lines.push(buildSectorEnergyCoverageLine(coverage, validCount));

  const confidenceDisplay = resolveSectorEnergyConfidenceDisplay({
    confidence,
    sourceTier,
    freshness,
    coverage,
    kisBasketCoverage: diag?.coverageBreakdown?.kisBasketCoverage,
  });
  lines.push(...buildSectorEnergyConfidenceLines(confidenceDisplay));

  // ADR-0577 Stage 2 (DISPLAY_ONLY): canonical PASS 시 하단 레거시 basket 진단을
  // *부차 diagnostic-only* 로 명시해 "공식 섹터지수 미가용" 오해(0/12 vs 11/11 모순)를 제거한다.
  // canonical NOT-PASS 면 collapse/배너 미적용 → 진짜 basket fallback·저하 가시성 보존.
  const canonicalDisplayPass = canonical.promotionCoveragePass === true;
  if (canonicalDisplayPass) {
    lines.push('');
    lines.push(
      'ℹ️ <i>[secondary diagnostic-only — ADR-0577] canonical official sector index is VERIFIED/PASS. '
        + 'The legacy basket-derived lines below are diagnostic-only and do NOT mean the official sector index is unavailable.</i>',
    );
  }

  // ADR-0399 (= 사용자 명시 ADR-0374): KRX 원천 복구 진단 메타.
  // sourceTierAttempts / candidateDates / fallbackReason — 운영자 *어느 layer 가 작동했는지* 추적.
  // 사용자 명시 9 핵심 원칙 #9 — fallback 작동 시 UI 와 diagnostics 에 반드시 표시.
  if (diag) {
    lines.push(
      ...collapseLegacyBasketDiagnosticForDisplay(
        canonicalDisplayPass,
        buildSectorEnergyKrxRecoveryLines(diag, sourceTier),
      ),
    );
  }

  // ADR-0423 — SectorEnergy 데이터 진실성 진단 (indexCode coverage / symmetry / fallback 분해).
  // quality diagnostic 영속 시 형식화된 세부 정보 노출 — 운영자 *왜 STALE 이 됐는지* 즉시 인지.
  // 부재 시 ADR-0125 기존 기본 표시만 (후방호환).
  // macroState schema 의 reasons:string[] 와 SSOT 의 SectorEnergyQualityReason[] 호환 cast
  // (영속 read-only 경로 — 타입 좁히기 안전).
  const qualityDiag = macro.sectorEnergyQualityDiagnostic as
    | Parameters<typeof formatSectorEnergyQualityDiagnosticSection>[0]
    | undefined;
  if (qualityDiag) {
    lines.push(
      ...collapseLegacyBasketDiagnosticForDisplay(
        canonicalDisplayPass,
        buildSectorEnergyQualityDiagLines(qualityDiag),
      ),
    );
  }

  // ADR-0398 high-conviction label diagnostics
  lines.push('');
  const adr0474 = formatSectorEnergyCoverageRecoverySection(
    qualityDiag
      ? buildSectorEnergyCoverageRecoveryReport({
          qualityDiagnostic: qualityDiag,
        })
      : buildSectorEnergyCoverageRecoveryReport(),
  );
  if (adr0474) {
    lines.push('');
    // ADR-0577 Stage 2 (DISPLAY_ONLY): canonical PASS 시 ADR-0474 recovery 섹션 내
    // "공식 미가용"으로 읽히는 라인도 동일 collapse(섹션은 멀티라인 문자열 → split/join).
    lines.push(
      collapseLegacyBasketDiagnosticForDisplay(
        canonicalDisplayPass,
        adr0474.split('\n'),
      ).join('\n'),
    );
    console.log(
      qualityDiag
        ? '[ADR-0474] SectorEnergy coverage recovery diagnostic appended to /sector_energy_diag'
        : '[ADR-0474] SectorEnergy coverage recovery fallback mounted to /sector_energy_diag',
    );
  }

  lines.push('');
  lines.push(...buildSectorEnergyHighConvictionLines({ sourceTier, dataQuality, confidenceDisplay }));

  return lines.join('\n');
}


export interface SectorEnergySnapshot {
  topicKey: 'SECTOR_ENERGY';
  date: string;
  selectedProductionSourceTier: string;
  dataQuality: string;
  productionOfficialCoverage: string;
  productionBasketCoverage: string;
  strongBuyAllowed: boolean;
  sectorBoostAllowed: boolean;
  executionImpact: 'NONE';
  generalBuyBlocked: false;
  dryRunCandidateSourceTier: string;
  dryRunAttempted: number;
  dryRunSucceeded: number;
  dryRunFailedCodes: string;
  promotionStage: string;
  topProblemsStableHash: string;
  /** Backward-compatible alias for older tests/log readers. */
  topProblemsHash: string;
  baseMessage: string;
  dryRunSection: string;
}

const SECTOR_ENERGY_TELEGRAM_TOPIC_KEY = 'SECTOR_ENERGY' as const;
const SECTOR_ENERGY_SNAPSHOT_TELEGRAM_DEDUP_TTL_MS = 20 * 60 * 1000;
const SECTOR_ENERGY_TELEGRAM_MAX_CHARS = 4000;
interface SectorEnergyStableSnapshotFields {
  date: string;
  selectedProductionSourceTier: string;
  dataQuality: string;
  productionOfficialCoverage: string;
  productionBasketCoverage: string;
  sectorBoostAllowed: boolean;
  strongBuyAllowed: boolean;
  executionImpact: string;
  dryRunCandidateSourceTier: string;
  dryRunAttempted: number;
  dryRunSucceeded: number;
  dryRunFailedCodes: string;
  promotionStage: string;
  topProblemsStableHash: string;
}

interface SectorEnergyDedupCacheEntry {
  key: string;
  stableFields: SectorEnergyStableSnapshotFields;
  expiresAt: number;
  suppressedCount: number;
}

const sectorEnergySnapshotDedupCache = new Map<string, SectorEnergyDedupCacheEntry>();
let lastSectorEnergySnapshotTelegramKey: string | null = null;
let lastSectorEnergySnapshotTelegramExpiresAt = 0;
let sectorEnergySnapshotTelegramSuppressedCount = 0;
const sectorEnergyTopicQueues = new Map<string, Promise<void>>();

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);
}

function ratioString(count: unknown, total: unknown): string {
  const c = typeof count === 'number' && Number.isFinite(count) ? count : 0;
  const t = typeof total === 'number' && Number.isFinite(total) ? total : 12;
  return `${c}/${t}`;
}

function extractCoverageCounts(macro: Record<string, any> | null | undefined): {
  official: string;
  basket: string;
  topProblemsHash: string;
} {
  const diag = macro?.sectorEnergyDiagnostics as any;
  const quality = macro?.sectorEnergyQualityDiagnostic as any;
  const coverageBreakdown = diag?.coverageBreakdown;
  const total = coverageBreakdown?.totalSectors ?? quality?.expectedSectorCount ?? macro?.sectorEnergyValidSectorCount ?? 12;
  const officialCount = coverageBreakdown?.kisOfficialCount ?? coverageBreakdown?.verifiedIndexCodeCount ?? 0;
  const basketCount = coverageBreakdown?.kisBasketCount ?? macro?.sectorEnergyValidSectorCount ?? 0;
  const topProblems = (quality?.coverageBreakdown?.sectorRows ?? [])
    .filter((row: any) => row?.reason && row.reason !== 'OK')
    .slice(0, 3)
    .map((row: any) => ({
      layer: 'PRODUCTION_BASKET',
      sector: row.sectorName,
      problemType: row.reason,
      priceRowsMissing: row.priceRowsMissing,
      freshness: row.freshness,
    }));
  return {
    official: ratioString(officialCount, total),
    basket: ratioString(basketCount, total),
    topProblemsHash: stableHash(topProblems),
  };
}

export function buildSectorEnergyTelegramSnapshot(input: {
  baseMessage: string;
  dryRunSection: string;
  dryRun?: { attempted?: number; succeeded: number; rows: Array<{ success: boolean; iscd: string }>; sourceTier?: string; promotionStage?: string };
  now?: Date;
}): SectorEnergySnapshot {
  const macro = loadMacroState() as Record<string, any> | null;
  const canonical = sectorEnergyCanonicalOrMissing(getLastSectorEnergyCanonicalState());
  const coverage = extractCoverageCounts(macro);
  const dryRunFailedCodes = input.dryRun?.rows
    ?.filter((row) => !row.success)
    .map((row) => row.iscd)
    .sort()
    .join(',') || 'none';
  return Object.freeze({
    topicKey: SECTOR_ENERGY_TELEGRAM_TOPIC_KEY,
    date: (input.now ?? new Date()).toISOString().slice(0, 10),
    selectedProductionSourceTier: canonical.selectedSourceTier,
    dataQuality: canonical.dataQuality,
    productionOfficialCoverage: `${canonical.verifiedOfficialSectorCount}/${canonical.officialSectorCount}`,
    productionBasketCoverage: coverage.basket,
    strongBuyAllowed: canonical.strongBuyAllowed,
    sectorBoostAllowed: canonical.sectorBoostAllowed,
    executionImpact: 'NONE',
    generalBuyBlocked: false,
    dryRunCandidateSourceTier: String((input.dryRun as any)?.sourceTier ?? 'KIS_SECTOR_INDEX_DAILY_DRYRUN'),
    dryRunAttempted: Number.isFinite((input.dryRun as any)?.attempted) ? Number((input.dryRun as any).attempted) : (input.dryRun?.rows?.length ?? 0),
    dryRunSucceeded: input.dryRun?.succeeded ?? 0,
    dryRunFailedCodes,
    promotionStage: input.dryRun?.promotionStage ?? 'OBSERVE',
    topProblemsStableHash: coverage.topProblemsHash,
    topProblemsHash: coverage.topProblemsHash,
    baseMessage: input.baseMessage,
    dryRunSection: input.dryRunSection,
  });
}

function buildSectorEnergyStableSnapshotFields(snapshot: SectorEnergySnapshot): SectorEnergyStableSnapshotFields {
  return {
    date: snapshot.date,
    selectedProductionSourceTier: snapshot.selectedProductionSourceTier,
    dataQuality: snapshot.dataQuality,
    productionOfficialCoverage: snapshot.productionOfficialCoverage,
    productionBasketCoverage: snapshot.productionBasketCoverage,
    sectorBoostAllowed: snapshot.sectorBoostAllowed,
    strongBuyAllowed: snapshot.strongBuyAllowed,
    executionImpact: snapshot.executionImpact,
    dryRunCandidateSourceTier: snapshot.dryRunCandidateSourceTier,
    dryRunAttempted: snapshot.dryRunAttempted,
    dryRunSucceeded: snapshot.dryRunSucceeded,
    dryRunFailedCodes: snapshot.dryRunFailedCodes,
    promotionStage: snapshot.promotionStage,
    topProblemsStableHash: snapshot.topProblemsStableHash,
  };
}

export function buildSectorEnergyStableSnapshotKey(snapshot: SectorEnergySnapshot): string {
  return `SECTOR_ENERGY_SNAPSHOT:${stableHash(buildSectorEnergyStableSnapshotFields(snapshot))}`;
}

export function buildSectorEnergySnapshotDedupKey(snapshot: SectorEnergySnapshot): string {
  return [
    'SECTOR_ENERGY_SNAPSHOT',
    snapshot.date,
    snapshot.selectedProductionSourceTier,
    snapshot.dataQuality,
    snapshot.productionOfficialCoverage,
    snapshot.productionBasketCoverage,
    String(snapshot.sectorBoostAllowed),
    String(snapshot.strongBuyAllowed),
    snapshot.executionImpact,
    snapshot.dryRunCandidateSourceTier,
    String(snapshot.dryRunAttempted),
    String(snapshot.dryRunSucceeded),
    snapshot.dryRunFailedCodes,
    snapshot.promotionStage,
    snapshot.topProblemsStableHash,
  ].join(':');
}

function changedStableFields(previous: SectorEnergyStableSnapshotFields | null, current: SectorEnergyStableSnapshotFields): string[] {
  if (!previous) return Object.keys(current);
  return (Object.keys(current) as Array<keyof SectorEnergyStableSnapshotFields>)
    .filter((field) => previous[field] !== current[field]);
}

function sectorEnergyLastSnapshotCacheKey(date: string): string {
  return `SECTOR_ENERGY_LAST_SNAPSHOT:${date}`;
}

function sectorEnergySameDayDedupExpiresAt(date: string, nowMs: number): number {
  const endOfSnapshotDayMs = Date.parse(`${date}T23:59:59.999Z`);
  const ttlFloorMs = nowMs + SECTOR_ENERGY_SNAPSHOT_TELEGRAM_DEDUP_TTL_MS;
  return Number.isFinite(endOfSnapshotDayMs) ? Math.max(ttlFloorMs, endOfSnapshotDayMs) : ttlFloorMs;
}

export function buildSectorEnergyTelegramMessage(snapshot: SectorEnergySnapshot): string {
  return `${snapshot.baseMessage}\n\n${snapshot.dryRunSection}`;
}

export function splitSectorEnergyTelegramMessageByLine(message: string, maxChars = SECTOR_ENERGY_TELEGRAM_MAX_CHARS): string[] {
  if (message.length <= maxChars) return [message];
  const chunks: string[] = [];
  let current = '';
  for (const line of message.split('\n')) {
    if (line.length > maxChars) {
      throw new Error(`SectorEnergy line exceeds Telegram chunk budget: ${line.slice(0, 80)}`);
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function shouldSuppressSectorEnergySnapshotTelegram(snapshot: SectorEnergySnapshot, nowMs = Date.now()): boolean {
  const snapshotKey = buildSectorEnergyStableSnapshotKey(snapshot);
  const stableFields = buildSectorEnergyStableSnapshotFields(snapshot);
  const cacheKey = sectorEnergyLastSnapshotCacheKey(snapshot.date);
  const previous = sectorEnergySnapshotDedupCache.get(cacheKey);
  const previousValid = previous && previous.expiresAt > nowMs ? previous : undefined;
  const previousKey = previousValid?.key ?? null;
  const changedFields = changedStableFields(previousValid?.stableFields ?? null, stableFields);
  const isDuplicate = previousKey === snapshotKey || changedFields.length === 0;
  const decision = isDuplicate ? 'SUPPRESS' : 'SEND';
  const ttlRemainingSec = previousValid ? Math.max(0, Math.ceil((previousValid.expiresAt - nowMs) / 1000)) : 0;

  console.log(
    `[SECTOR_ENERGY_DEDUP_CHECK] snapshotKey=${snapshotKey} previousKey=${previousKey ?? 'none'} isDuplicate=${isDuplicate} ttlRemainingSec=${ttlRemainingSec} decision=${decision} changedFields=${JSON.stringify(isDuplicate ? [] : changedFields)} executionImpact=${snapshot.executionImpact} cacheKey=${cacheKey} cacheBackend=PROCESS_MEMORY restartMayResend=true`,
  );

  if (isDuplicate && previousValid) {
    const suppressedCount = previousValid.suppressedCount + 1;
    sectorEnergySnapshotDedupCache.set(cacheKey, { ...previousValid, suppressedCount });
    lastSectorEnergySnapshotTelegramKey = snapshotKey;
    lastSectorEnergySnapshotTelegramExpiresAt = previousValid.expiresAt;
    sectorEnergySnapshotTelegramSuppressedCount = suppressedCount;
    console.log(
      `[SECTOR_ENERGY_TELEGRAM_SUPPRESSED] reason=UNCHANGED_SNAPSHOT snapshotKey=${snapshotKey} suppressedCount=${suppressedCount} executionImpact=${snapshot.executionImpact}`,
    );
    return true;
  }

  const expiresAt = sectorEnergySameDayDedupExpiresAt(snapshot.date, nowMs);
  sectorEnergySnapshotDedupCache.set(cacheKey, {
    key: snapshotKey,
    stableFields,
    expiresAt,
    suppressedCount: 0,
  });
  lastSectorEnergySnapshotTelegramKey = snapshotKey;
  lastSectorEnergySnapshotTelegramExpiresAt = expiresAt;
  sectorEnergySnapshotTelegramSuppressedCount = 0;
  console.log(
    `[SECTOR_ENERGY_SNAPSHOT] selectedProductionSourceTier=${snapshot.selectedProductionSourceTier} productionOfficialCoverage=${snapshot.productionOfficialCoverage} productionBasketCoverage=${snapshot.productionBasketCoverage} dryRunCandidateCoverage=${snapshot.dryRunSucceeded}/${snapshot.dryRunAttempted} promotionStage=${snapshot.promotionStage} highConvictionLabel=finalScore-only executionImpact=${snapshot.executionImpact}`,
  );
  return false;
}

export async function sendSectorEnergySnapshot(snapshot: SectorEnergySnapshot, reply: (message: string) => unknown | Promise<unknown>): Promise<void> {
  if (shouldSuppressSectorEnergySnapshotTelegram(snapshot)) return;
  await sendSectorEnergyTelegramMessage(reply, buildSectorEnergyTelegramMessage(snapshot));
}

export function resetSeTelegramSnapshotDedupForTests(): void {
  lastSectorEnergySnapshotTelegramKey = null;
  lastSectorEnergySnapshotTelegramExpiresAt = 0;
  sectorEnergySnapshotTelegramSuppressedCount = 0;
  sectorEnergySnapshotDedupCache.clear();
  sectorEnergyTopicQueues.clear();
}

async function sendSectorEnergyTelegramMessage(reply: (message: string) => unknown | Promise<unknown>, message: string): Promise<void> {
  const chunks = splitSectorEnergyTelegramMessageByLine(message);
  const previous = sectorEnergyTopicQueues.get(SECTOR_ENERGY_TELEGRAM_TOPIC_KEY) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    for (const chunk of chunks) {
      await reply(chunk);
    }
  });
  sectorEnergyTopicQueues.set(SECTOR_ENERGY_TELEGRAM_TOPIC_KEY, next.then(() => undefined, () => undefined));
  await next;
}

function formatDisabledKisSectorIndexDryRunSection(): string {
  return [
    '<b>[KIS Sector Index Candidate Dry Run]</b>',
    'legacySourceTierDiagnosticOnly: <code>KIS_SECTOR_INDEX_DAILY_DRYRUN</code>',
    'attempted: <b>0</b>',
    'succeeded: <b>0</b>',
    'failed: <b>0</b>',
    'candidateCoverage: <b>0.0%</b>',
    'officialBenchmark: <b>false</b>',
    'promotionStage: <code>OBSERVE</code>',
    'legacySectorBoostAllowedDiagnosticOnly: <b>false</b>',
    'highConvictionLabel: <b>finalScore-only</b>',
    'executionImpact: <code>NONE</code>',
    'nextAction: <code>VERIFY_FAILED_ISCD_2005_2006_WITH_IDXCODE_MST_BEFORE_L4_WIRING</code>',
  ].join('\n');
}


const SECTOR_INDEX_DRYRUN_TELEGRAM_DEDUP_TTL_MS = 20 * 60 * 1000;
let lastSectorIndexDryRunTelegramKey: string | null = null;
let lastSectorIndexDryRunTelegramExpiresAt = 0;
let sectorIndexDryRunTelegramSuppressedCount = 0;

function buildSectorIndexDryRunTelegramDedupKey(report: {
  attempted: number;
  succeeded: number;
  rows: Array<{ success: boolean; iscd: string }>;
}): string {
  const date = new Date().toISOString().slice(0, 10);
  const failedCodes = report.rows
    .filter((row) => !row.success)
    .map((row) => row.iscd)
    .sort()
    .join(',') || 'none';
  return `SECTOR_INDEX_DRYRUN:${date}:${report.attempted}:${report.succeeded}:${failedCodes}`;
}

function shouldSuppressSectorIndexDryRunTelegram(report: {
  attempted: number;
  succeeded: number;
  rows: Array<{ success: boolean; iscd: string }>;
}, nowMs = Date.now()): boolean {
  const key = buildSectorIndexDryRunTelegramDedupKey(report);
  if (lastSectorIndexDryRunTelegramKey === key && lastSectorIndexDryRunTelegramExpiresAt > nowMs) {
    sectorIndexDryRunTelegramSuppressedCount += 1;
    console.log(`[SECTOR_INDEX_DRYRUN_TELEGRAM_SUPPRESSED] key=${key} suppressedCount=${sectorIndexDryRunTelegramSuppressedCount}`);
    return true;
  }
  lastSectorIndexDryRunTelegramKey = key;
  lastSectorIndexDryRunTelegramExpiresAt = nowMs + SECTOR_INDEX_DRYRUN_TELEGRAM_DEDUP_TTL_MS;
  sectorIndexDryRunTelegramSuppressedCount = 0;
  return false;
}

const sectorEnergyDiag: TelegramCommand = {
  name: '/sector_energy_diag',
  aliases: ['/se', '/sed', '/sector_diag'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Sector Energy 4-axis 진단 + high-conviction label evidence (ADR-0398)',
  usage: '/sector_energy_diag',
  async execute({ reply }) {
    try {
      const baseMessage = formatSectorEnergyDiagMessage();
      if (process.env.KIS_SECTOR_INDEX_DAILY_ENABLED !== 'true') {
        const disabledSnapshot = buildSectorEnergyTelegramSnapshot({
          baseMessage,
          dryRunSection: formatDisabledKisSectorIndexDryRunSection(),
        });
        await sendSectorEnergySnapshot(disabledSnapshot, reply);
        return;
      }
      const dryRun = await fetchKisSectorIndexRowsDryRun();
      // Keep Railway-only dry-run detail dedup for diagnostics; full snapshot dedup owns user-visible output.
      shouldSuppressSectorIndexDryRunTelegram(dryRun);
      const snapshot = buildSectorEnergyTelegramSnapshot({
        baseMessage,
        dryRunSection: formatKisSectorIndexDryRunSection(dryRun),
        dryRun,
      });
      await sendSectorEnergySnapshot(snapshot, reply);
    } catch (err) {
      console.error('[sectorEnergyDiag.cmd] failed', err);
      await reply('❌ Sector Energy 진단 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(sectorEnergyDiag);

export default sectorEnergyDiag;
