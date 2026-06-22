/**
 * @responsibility Pure candidate metric, sector index target, watchlist fallback helpers for scan persistence.
 * ADR-0001 scan diagnostics core split.
 */

import type {
  CandidateSnapshot,
  CandidatePoolInputCandidate,
} from '../persistScanResultsDependencies.js';
import { loadWatchlist } from '../../../../persistence/watchlistRepo.js';
import type { OfficialSectorIndexTarget } from '../../../../sector/SectorIndexCodeMap.js';
import { OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS } from '../../../../../src/domain/sector-energy/SectorEnergyCanonicalResolver.js';

/**
 * ADR-0630 follow-up — provisional/counterfactual shadow lane 의 noEligibleReason regime 게이트 판정.
 *
 * 실제 lane 게이트(provisionalShadowLane.ts:22 / counterfactualShadowLane.ts:22)는
 * `ctx.learningRegime ?? ctx.regime` 로 `=== 'R3_EARLY'` 를 본다. 진단 reason 합성도 반드시
 * 동일 변수로 판정해야, LIVE-clamp 된 `routerInput.regime`(R6 회복 누수 시 R4_NEUTRAL) 단독으로
 * "R3_EARLY 외 차단/비활성" 을 오표시하지 않는다 (운영자 헛다리/오진 방지 — ADR-0630 §2.3).
 * 표시 전용 · 게이트 로직 무접촉 · executionImpact=NONE.
 */
export function laneRegimeBlockedForReason(
  learningRegime: string | undefined,
  routerInputRegime: string | undefined,
): boolean {
  return (learningRegime ?? routerInputRegime) !== 'R3_EARLY';
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function countFiniteCandidateMetric(
  snapshots: readonly CandidateSnapshot[],
  keys: readonly string[],
): number {
  let count = 0;
  for (const snapshot of snapshots) {
    const root = snapshot as unknown as Record<string, unknown>;
    const quote = snapshot.quote && typeof snapshot.quote === 'object'
      ? snapshot.quote as Record<string, unknown>
      : {};
    const symbolFeatures = snapshot.symbolFeatures && typeof snapshot.symbolFeatures === 'object'
      ? snapshot.symbolFeatures as Record<string, unknown>
      : {};
    const hasMetric = keys.some((key) =>
      finiteNumber(root[key]) !== null ||
      finiteNumber(quote[key]) !== null ||
      finiteNumber(symbolFeatures[key]) !== null,
    );
    if (hasMetric) count += 1;
  }
  return count;
}

export function firstStringValue(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function nestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function collectOfficialSectorIndexTargets(
  snapshots: readonly CandidateSnapshot[],
  diagnostic: unknown,
): OfficialSectorIndexTarget[] {
  const targets = new Map<string, OfficialSectorIndexTarget>();
  const addTarget = (target: OfficialSectorIndexTarget): void => {
    const sectorName = String(target.sectorName ?? '').trim();
    if (!sectorName) return;
    const key = `${sectorName}|${target.sectorKey ?? ''}|${target.candidateIndexCode ?? ''}`;
    if (!targets.has(key)) targets.set(key, target);
  };

  for (const snapshot of snapshots) {
    const root = snapshot as unknown as Record<string, unknown>;
    const featurePack = nestedRecord(root, 'featurePack');
    const quote = nestedRecord(root, 'quote');
    const symbolFeatures = nestedRecord(root, 'symbolFeatures');
    const classification = nestedRecord(root, 'classification') ?? nestedRecord(root, 'sectorClassification');
    const sectorName =
      firstStringValue(root, ['sectorName', 'sector', 'industry', 'theme', 'themeName'])
      ?? (featurePack ? firstStringValue(featurePack, ['sectorName', 'sector', 'industry', 'theme', 'themeName']) : null)
      ?? (classification ? firstStringValue(classification, ['sectorName', 'sector', 'industry', 'theme', 'themeName']) : null);
    const sectorKey =
      firstStringValue(root, ['sectorKey', 'themeKey'])
      ?? (featurePack ? firstStringValue(featurePack, ['sectorKey', 'themeKey']) : null)
      ?? (classification ? firstStringValue(classification, ['sectorKey', 'themeKey']) : null);
    const candidateIndexCode =
      firstStringValue(root, ['indexCode', 'sectorIndexCode', 'officialIndexCode'])
      ?? (featurePack ? firstStringValue(featurePack, ['indexCode', 'sectorIndexCode', 'officialIndexCode']) : null)
      ?? (quote ? firstStringValue(quote, ['sectorIndexCode', 'officialIndexCode']) : null)
      ?? (symbolFeatures ? firstStringValue(symbolFeatures, ['sectorIndexCode', 'officialIndexCode']) : null);
    if (sectorName) addTarget({
      sectorName,
      ...(sectorKey ? { sectorKey } : {}),
      ...(candidateIndexCode ? { candidateIndexCode } : {}),
    });
  }

  const diag = diagnostic && typeof diagnostic === 'object' ? diagnostic as Record<string, unknown> : null;
  const sectorRows = diag ? [
    diag.sectors,
    diag.sectorRows,
    diag.records,
    diag.rows,
  ].find((value): value is unknown[] => Array.isArray(value)) : null;
  if (sectorRows) {
    for (const row of sectorRows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const sectorName = firstStringValue(record, ['sectorName', 'officialIndexName', 'idxName', 'indexName', 'displayName', 'name']);
      if (!sectorName) continue;
      const sectorKey = firstStringValue(record, ['sectorKey', 'themeKey']);
      const candidateIndexCode = firstStringValue(record, ['indexCode', 'sectorIndexCode', 'officialIndexCode', 'idxCode']);
      addTarget({
        sectorName,
        ...(sectorKey ? { sectorKey } : {}),
        ...(candidateIndexCode ? { candidateIndexCode } : {}),
      });
    }
  }
  if (diag) {
    const grouped = nestedRecord(diag, 'groupedSectorEnergy') ?? nestedRecord(diag, 'groupedSectorSnapshot');
    const groupedResults = Array.isArray(grouped?.results) ? grouped.results : [];
    for (const result of groupedResults) {
      if (!result || typeof result !== 'object') continue;
      const record = result as Record<string, unknown>;
      const sectorName = firstStringValue(record, ['sectorName', 'sectorKey']);
      if (!sectorName) continue;
      const sectorKey = firstStringValue(record, ['sectorKey']);
      const candidateIndexCode = firstStringValue(record, ['krxIndexCode', 'indexCode', 'sectorIndexCode', 'officialIndexCode']);
      addTarget({
        sectorName,
        ...(sectorKey ? { sectorKey } : {}),
        ...(candidateIndexCode ? { candidateIndexCode } : {}),
      });
    }
    const topGroupedRaw = diag.topGroupedSectors ?? grouped?.topGroupedSectors;
    const topGroupedSectors = Array.isArray(topGroupedRaw)
      ? topGroupedRaw
      : typeof topGroupedRaw === 'string'
        ? topGroupedRaw.split(',')
        : [];
    for (const sector of topGroupedSectors) {
      const sectorName = typeof sector === 'string' ? sector.trim() : '';
      if (sectorName) addTarget({ sectorName, sectorKey: sectorName });
    }
  }

  // ADR-0534 follow-up: 공식 11개 섹터를 후보 풀과 무관하게 항상 verify 한다 (numerator↔denominator 정합).
  // 기계장비/음식료/방송통신 처럼 후보에 없던 official 섹터가 누락되어 8/11 로 잡히던 문제를 해소한다.
  // KIS 업종지수 조회(observe-mode)만 추가 — executionImpact=NONE. ENV=false 로 즉시 롤백.
  if (process.env.SECTOR_ENERGY_OFFICIAL_BASE_VERIFY_ENABLED !== 'false') {
    const normalizeSectorName = (value: string): string => value.trim().toLowerCase().replace(/[\s/·]/g, '');
    const presentNames = new Set<string>();
    const presentCodes = new Set<string>();
    for (const target of targets.values()) {
      const name = normalizeSectorName(String(target.sectorName ?? ''));
      if (name) presentNames.add(name);
      const code = String(target.candidateIndexCode ?? '').trim();
      if (code) presentCodes.add(code);
    }
    for (const base of OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS) {
      if (presentCodes.has(base.indexCode)) continue;
      if (presentNames.has(normalizeSectorName(base.sectorName))) continue;
      addTarget({ sectorName: base.sectorName, sectorKey: base.key, candidateIndexCode: base.indexCode });
    }
  }

  return Array.from(targets.values()).slice(0, 64);
}

export function watchlistFallbackCandidates(): CandidatePoolInputCandidate[] {
  try {
    return loadWatchlist().map((entry) => ({
      symbol: entry.code,
      code: entry.code,
      name: entry.name,
      market: 'KRX',
      sector: entry.sector,
      sourceTags: ['WATCHLIST'],
      price: entry.symbolFeatures?.price ?? entry.entryPrice,
      currentPrice: entry.symbolFeatures?.price ?? entry.entryPrice,
      volume: entry.symbolFeatures?.volume,
      avgVolume: entry.symbolFeatures?.avgVolume,
      relativeStrengthScore: (entry as any).relativeStrengthScore,
      rsRankPct: (entry as any).rsRankPct,
      breakoutScore: (entry as any).breakoutScore,
      return5d: entry.symbolFeatures?.return5d,
      return20d: entry.symbolFeatures?.return20d,
      quote: entry.symbolFeatures ?? {
        price: entry.entryPrice,
      },
      gateScore: entry.gateScore,
      stage1Score: entry.stage1Score,
      stage2Score: entry.stage2Score,
      totalGateScore: entry.totalGateScore,
    }));
  } catch {
    return [];
  }
}
