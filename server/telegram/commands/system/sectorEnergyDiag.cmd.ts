// @responsibility sectorEnergyDiag.cmd 텔레그램 모듈
// @responsibility: /sector_energy_diag — sectorEnergy 4-axis 통합 진단. SYS ADMIN read-only.
//
// ADR-0398 (= 사용자 명시 ADR-0373) — 사용자 명시 진단 명령:
//   1. sourceTier (KRX_CODE/STOCK_DAILY/CACHE/YAHOO_ETF/FAILED)
//   2. freshness (FRESH/DEGRADED/EXPIRED)
//   3. coverage (validSectorCount / 12)
//   4. confidence (0~1, sourceWeight × freshnessWeight × coverage)
//   5. dataQuality (OK/PARTIAL/STALE/DEGRADED/FAILED)
//   + STRONG_BUY 차단 여부 + 차단 사유 (ADR-0398 SSOT 호출)
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
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

interface SectorEnergyConfidenceDisplay {
  value: number;
  confidenceClass: 'VERIFIED' | 'PARTIAL' | 'DEGRADED' | 'MISSING';
  suffix?: string;
  reason?: string;
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

/**
 * /sector_energy_diag 메시지 빌더 SSOT (단위 테스트 가능).
 *
 * 안전 invariant — read-only, 외부 호출 0건, manual override 트리거 0건.
 */
export function formatSectorEnergyDiagMessage(): string {
  const macro = loadMacroState();
  const lines: string[] = [];
  lines.push('🌐 <b>[Sector Energy 4-axis 진단]</b>');
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
  const qualityEmoji =
    dataQuality === 'OK'
      ? '✅'
      : dataQuality === 'PARTIAL'
        ? '🟡'
        : dataQuality === 'STALE'
          ? '🟠'
          : dataQuality === 'DEGRADED'
            ? '🔶'
            : dataQuality === 'FAILED'
              ? '❌'
              : '⚪';

  lines.push(`${qualityEmoji} dataQuality: <b>${dataQuality ?? '미수집'}</b>`);

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

  if (sourceTier !== undefined) {
    lines.push(`📡 sourceTier: <b>${sourceTier}</b>`);
  } else {
    lines.push(`📡 sourceTier: <i>미수집 (ADR-0396 격상 전 영속 데이터)</i>`);
  }

  if (freshness !== undefined) {
    const freshEmoji =
      freshness === 'FRESH' ? '✅' : freshness === 'DEGRADED' ? '🟡' : '❌';
    lines.push(`⏱️ freshness: ${freshEmoji} <b>${freshness}</b>`);
  } else {
    lines.push(`⏱️ freshness: <i>미수집</i>`);
  }

  if (typeof coverage === 'number' && Number.isFinite(coverage)) {
    lines.push(
      `📊 coverage: <b>${(coverage * 100).toFixed(1)}%</b> (${validCount ?? '?'}/12 섹터)`,
    );
  } else if (typeof validCount === 'number') {
    lines.push(`📊 coverage: <i>미수집</i> (${validCount}/12 섹터)`);
  } else {
    lines.push(`📊 coverage: <i>미수집</i>`);
  }

  const confidenceDisplay = resolveSectorEnergyConfidenceDisplay({
    confidence,
    sourceTier,
    freshness,
    coverage,
    kisBasketCoverage: diag?.coverageBreakdown?.kisBasketCoverage,
  });
  if (confidenceDisplay) {
    const suffix = confidenceDisplay.suffix
      ? `, ${confidenceDisplay.suffix}`
      : '';
    lines.push(
      `🎯 confidence: ${confidenceEmoji(confidenceDisplay.value)} <b>${(confidenceDisplay.value * 100).toFixed(1)}%</b> ` +
        `(${confidenceDisplay.confidenceClass}${suffix})`,
    );
    if (confidenceDisplay.reason) {
      lines.push(`  • reason: <i>${confidenceDisplay.reason}</i>`);
    }
  } else {
    lines.push(`🎯 confidence: <i>미수집</i>`);
  }

  // ADR-0399 (= 사용자 명시 ADR-0374): KRX 원천 복구 진단 메타.
  // sourceTierAttempts / candidateDates / fallbackReason — 운영자 *어느 layer 가 작동했는지* 추적.
  // 사용자 명시 9 핵심 원칙 #9 — fallback 작동 시 UI 와 diagnostics 에 반드시 표시.
  if (diag) {
    lines.push('');
    lines.push('🔍 <b>[KRX 원천 복구 진단 (ADR-0399)]</b>');
    if (diag.candidateDates && diag.candidateDates.length > 0) {
      lines.push(
        `📅 candidateDates: <code>${diag.candidateDates.join(', ')}</code>`,
      );
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
      lines.push(
        `selectedSourceTier: <code>${diag.finalSourceTier ?? sourceTier ?? 'MISSING'}</code>`,
      );
      lines.push(
        `officialCoverage: <b>${c.kisOfficialCount + c.verifiedIndexCodeCount}/${c.totalSectors}</b>`,
      );
      lines.push(
        `basketCoverage: <b>${c.kisBasketCount}/${c.totalSectors}</b>`,
      );
      lines.push('sectorBoostAllowed: <b>false</b>');
      lines.push('strongBuyAllowed: <b>false</b>');
      lines.push(`executionImpact: <code>${diag.executionImpact ?? 'NONE'}</code>`);
      lines.push(
        `  • productionOfficialCoverage: <b>${(Math.max(c.verifiedIndexCodeCoverage, c.kisOfficialCoverage) * 100).toFixed(1)}%</b> (${Math.max(c.verifiedIndexCodeCount, c.kisOfficialCount)}/${c.totalSectors})`,
      );
      lines.push(
        `  • productionBasketCoverage: <b>${(c.kisBasketCoverage * 100).toFixed(1)}%</b> (${c.kisBasketCount}/${c.totalSectors})`,
      );
      lines.push(
        `  • internalProxyCoverage: <b>${(c.internalProxyCoverage * 100).toFixed(1)}%</b> (${c.internalProxyCount}/${c.totalSectors})`,
      );
      lines.push(
        `  • stockDailyFallbackCoverage: <b>${(c.stockDailyFallbackCoverage * 100).toFixed(1)}%</b> (${c.stockDailyFallbackCount}/${c.totalSectors})`,
      );
    }
    if (diag.leadershipConfidence) {
      lines.push(
        `🧭 leadershipConfidence: <b>${diag.leadershipConfidence}</b>`,
      );
    }
    if (diag.selectedSectors && diag.selectedSectors.length > 0) {
      lines.push(
        `🏁 selectedSectors: <code>${diag.selectedSectors.join(', ')}</code>`,
      );
    }
    lines.push(
      `🛡 liveExecutionAllowed: <b>${String(diag.liveExecutionAllowed ?? false)}</b>`,
    );
    lines.push(`🧪 executionImpact: <b>${diag.executionImpact ?? 'NONE'}</b>`);
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
    lines.push('');
    const section = formatSectorEnergyQualityDiagnosticSection(qualityDiag);
    if (section) lines.push(section);

    // ADR-0446 Phase 2: indexCode recovery 분해 (ADR-0424 위에서 row 단위 분해 + sourceTier breakdown).
    if (qualityDiag.sectorIndexRecovery) {
      const phase2 = formatPhase2RecoverySection(
        qualityDiag.sectorIndexRecovery,
      );
      if (phase2) {
        lines.push('');
        lines.push(phase2);
      }
    }

    // KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001: KRX 섹터 indexCode raw 입력 부검.
    // verifiedIndexCodeCoverage=0% 의 정확한 break point 노출 (진단 전용 — 매매 영향 0).
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
  }

  // ADR-0398 STRONG_BUY 게이트 결과
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
    lines.push(adr0474);
    console.log(
      qualityDiag
        ? '[ADR-0474] SectorEnergy coverage recovery diagnostic appended to /sector_energy_diag'
        : '[ADR-0474] SectorEnergy coverage recovery fallback mounted to /sector_energy_diag',
    );
  }

  if (isSectorEnergyStrongBuyGateDisabled()) {
    lines.push(
      '🔓 <b>[STRONG_BUY 게이트 비활성]</b> (ENV `SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true`)',
    );
  } else if (
    sourceTier !== undefined &&
    dataQuality !== undefined &&
    confidenceDisplay !== null
  ) {
    const gate = evaluateSectorEnergyStrongBuyGate({
      confidence: confidenceDisplay.value,
      dataQuality,
      sourceTier,
    });
    if (gate.forbidStrongBuy) {
      lines.push('🚫 <b>[STRONG_BUY 차단]</b> — 4 조건 OR 충족 (ADR-0398)');
      for (const reason of gate.reasons) {
        lines.push(`  • ${reason}`);
      }
      lines.push('');
      lines.push(
        '<i>일반 BUY 는 차단되지 않음 — 섹터에너지는 보조 신호 (사용자 명시 정책).</i>',
      );
    } else {
      lines.push('✅ <b>[STRONG_BUY 승격 허용]</b> — 4 조건 모두 통과');
    }
  } else {
    lines.push(
      '⚠️ <b>[STRONG_BUY 게이트 평가 불가]</b> — 4-axis 데이터 미수집',
    );
  }

  return lines.join('\n');
}


export interface SectorEnergySnapshot {
  topicKey: 'SECTOR_ENERGY';
  date: string;
  selectedProductionSourceTier: string;
  dataQuality: string;
  productionOfficialCoverage: string;
  productionBasketCoverage: string;
  strongBuyAllowed: false;
  sectorBoostAllowed: false;
  executionImpact: 'NONE';
  generalBuyBlocked: false;
  dryRunSucceeded: number;
  dryRunFailedCodes: string;
  promotionStage: string;
  topProblemsHash: string;
  baseMessage: string;
  dryRunSection: string;
}

const SECTOR_ENERGY_TELEGRAM_TOPIC_KEY = 'SECTOR_ENERGY' as const;
const SECTOR_ENERGY_SNAPSHOT_TELEGRAM_DEDUP_TTL_MS = 20 * 60 * 1000;
const SECTOR_ENERGY_TELEGRAM_MAX_CHARS = 4000;
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
  dryRun?: { succeeded: number; rows: Array<{ success: boolean; iscd: string }>; promotionStage?: string };
  now?: Date;
}): SectorEnergySnapshot {
  const macro = loadMacroState() as Record<string, any> | null;
  const coverage = extractCoverageCounts(macro);
  const dryRunFailedCodes = input.dryRun?.rows
    ?.filter((row) => !row.success)
    .map((row) => row.iscd)
    .sort()
    .join(',') || 'none';
  return Object.freeze({
    topicKey: SECTOR_ENERGY_TELEGRAM_TOPIC_KEY,
    date: (input.now ?? new Date()).toISOString().slice(0, 10),
    selectedProductionSourceTier: String(macro?.sectorEnergySourceTier ?? 'UNKNOWN'),
    dataQuality: String(macro?.sectorEnergyDataQuality ?? 'UNKNOWN'),
    productionOfficialCoverage: coverage.official,
    productionBasketCoverage: coverage.basket,
    strongBuyAllowed: false,
    sectorBoostAllowed: false,
    executionImpact: 'NONE',
    generalBuyBlocked: false,
    dryRunSucceeded: input.dryRun?.succeeded ?? 0,
    dryRunFailedCodes,
    promotionStage: input.dryRun?.promotionStage ?? 'OBSERVE',
    topProblemsHash: coverage.topProblemsHash,
    baseMessage: input.baseMessage,
    dryRunSection: input.dryRunSection,
  });
}

export function buildSectorEnergySnapshotDedupKey(snapshot: SectorEnergySnapshot): string {
  return [
    'SECTOR_ENERGY_SNAPSHOT',
    snapshot.date,
    snapshot.selectedProductionSourceTier,
    snapshot.dataQuality,
    snapshot.productionOfficialCoverage,
    snapshot.productionBasketCoverage,
    String(snapshot.strongBuyAllowed),
    String(snapshot.dryRunSucceeded),
    snapshot.dryRunFailedCodes,
    snapshot.promotionStage,
    snapshot.topProblemsHash,
  ].join(':');
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
  const key = buildSectorEnergySnapshotDedupKey(snapshot);
  if (lastSectorEnergySnapshotTelegramKey === key && lastSectorEnergySnapshotTelegramExpiresAt > nowMs) {
    sectorEnergySnapshotTelegramSuppressedCount += 1;
    console.log(
      `[SECTOR_ENERGY_TELEGRAM_SUPPRESSED] reason=UNCHANGED_SNAPSHOT suppressedCount=${sectorEnergySnapshotTelegramSuppressedCount} executionImpact=${snapshot.executionImpact}`,
    );
    return true;
  }
  lastSectorEnergySnapshotTelegramKey = key;
  lastSectorEnergySnapshotTelegramExpiresAt = nowMs + SECTOR_ENERGY_SNAPSHOT_TELEGRAM_DEDUP_TTL_MS;
  sectorEnergySnapshotTelegramSuppressedCount = 0;
  console.log(
    `[SECTOR_ENERGY_SNAPSHOT] selectedProductionSourceTier=${snapshot.selectedProductionSourceTier} productionOfficialCoverage=${snapshot.productionOfficialCoverage} productionBasketCoverage=${snapshot.productionBasketCoverage} dryRunCandidateCoverage=${snapshot.dryRunSucceeded}/${snapshot.dryRunFailedCodes === 'none' ? snapshot.dryRunSucceeded : snapshot.dryRunSucceeded + snapshot.dryRunFailedCodes.split(',').length} promotionStage=${snapshot.promotionStage} strongBuyAllowed=${snapshot.strongBuyAllowed} executionImpact=${snapshot.executionImpact}`,
  );
  return false;
}

export function resetSeTelegramSnapshotDedupForTests(): void {
  lastSectorEnergySnapshotTelegramKey = null;
  lastSectorEnergySnapshotTelegramExpiresAt = 0;
  sectorEnergySnapshotTelegramSuppressedCount = 0;
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
    'sourceTier: <code>KIS_SECTOR_INDEX_DAILY_DRYRUN</code>',
    'attempted: <b>0</b>',
    'succeeded: <b>0</b>',
    'failed: <b>0</b>',
    'candidateCoverage: <b>0.0%</b>',
    'officialBenchmark: <b>false</b>',
    'promotionStage: <code>OBSERVE</code>',
    'sectorBoostAllowed: <b>false</b>',
    'strongBuyAllowed: <b>false</b>',
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
  description: 'Sector Energy 4-axis 진단 + STRONG_BUY 차단 사유 (ADR-0398)',
  usage: '/sector_energy_diag',
  async execute({ reply }) {
    try {
      const baseMessage = formatSectorEnergyDiagMessage();
      if (process.env.KIS_SECTOR_INDEX_DAILY_ENABLED !== 'true') {
        const disabledSnapshot = buildSectorEnergyTelegramSnapshot({
          baseMessage,
          dryRunSection: formatDisabledKisSectorIndexDryRunSection(),
        });
        if (shouldSuppressSectorEnergySnapshotTelegram(disabledSnapshot)) return;
        await sendSectorEnergyTelegramMessage(reply, buildSectorEnergyTelegramMessage(disabledSnapshot));
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
      if (shouldSuppressSectorEnergySnapshotTelegram(snapshot)) return;
      await sendSectorEnergyTelegramMessage(reply, buildSectorEnergyTelegramMessage(snapshot));
    } catch (err) {
      console.error('[sectorEnergyDiag.cmd] failed', err);
      await reply('❌ Sector Energy 진단 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(sectorEnergyDiag);

export default sectorEnergyDiag;
