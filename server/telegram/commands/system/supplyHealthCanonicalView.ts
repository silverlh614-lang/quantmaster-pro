/**
 * @responsibility 스캔 정본 수급 뷰를 getLastScanSummary 영속 필드에서 순수 추출(재fetch·재계산 0)한다.
 *
 * /supply_health 가산 섹션 전용. SourceSnapshot 정본(scanEvaluation.scanId)·router·per-candidate
 * 수급 샘플을 read-only 로 투영하여 운영자가 "스캔 실제 사용분" vs "현재 채널 상태(live probe)"를
 * 구분하게 한다. provider 직접 호출 금지(단일 통로). executionImpact=NONE, LIVE 매매 본체 0줄.
 */

import type { ScanSummary } from '../../../trading/signalScanner/scanDiagnostics/scanSummaryTypes.js';

const CANONICAL_PER_CANDIDATE_TOP_N = 8;

export interface CanonicalSupplyPerCandidateView {
  symbol: string;
  source: string;
  foreignNetBuy: number | null;
  institutionalNetBuy: number | null;
  supplyProviderHealth: string;
}

export interface CanonicalSupplyView {
  available: boolean;
  /** scan-eval-YYYYMMDDHHMMSS — /scan_blockers·debug_raw·position-policy 로그와 동일 정본 id. */
  sourceSnapshotId: string | null;
  scanAsOf: string | null;
  candidateCount: number;
  /** router coverage — 스캔이 실제 사용한 investor-flow 수급 usable / total. */
  coverage: { available: number; total: number } | null;
  routerSelectedProvider: string | null;
  routerSignal: string | null;
  routerStatus: string | null;
  perCandidate: CanonicalSupplyPerCandidateView[];
  /** summary/필드 부재 시 운영자 안내 사유 (silent drop 금지 — SDS). */
  unavailableReason: string | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatCanonicalEokwon(value: number | null): string {
  if (value === null) return 'N/A';
  if (Math.abs(value) < 0.5) return '0';
  return `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR')}`;
}

/**
 * getLastScanSummary 의 영속 필드에서 정본 수급 뷰를 순수 추출한다.
 * 어떤 provider 호출·재계산도 수행하지 않으며 summary 만 읽는다.
 */
export function buildCanonicalSupplyView(summary: ScanSummary | null): CanonicalSupplyView {
  if (!summary) {
    return {
      available: false,
      sourceSnapshotId: null,
      scanAsOf: null,
      candidateCount: 0,
      coverage: null,
      routerSelectedProvider: null,
      routerSignal: null,
      routerStatus: null,
      perCandidate: [],
      unavailableReason: '정본 없음 (스캔 미실행 또는 미persist)',
    };
  }

  const sourceSnapshotId = summary.scanEvaluation?.scanId ?? null;
  const scanAsOf = summary.scanEvaluation?.asOf ?? null;
  const router = summary.investorFlowProviderRouter ?? null;
  const samples = summary.investorFlowSampleAdr0489?.samples ?? [];

  const coverage = router
    ? { available: router.coverage.available, total: router.coverage.total }
    : null;

  const perCandidate: CanonicalSupplyPerCandidateView[] = samples
    .slice(0, CANONICAL_PER_CANDIDATE_TOP_N)
    .map((sample) => ({
      symbol: sample.symbol,
      source: sample.provider,
      foreignNetBuy: isFiniteNumber(sample.foreignNetBuy) ? sample.foreignNetBuy : null,
      institutionalNetBuy: isFiniteNumber(sample.institutionNetBuy) ? sample.institutionNetBuy : null,
      supplyProviderHealth: sample.status,
    }));

  const candidateCount =
    summary.candidatePool?.candidateSnapshots?.length ??
    summary.investorFlowSampleAdr0489?.samples.length ??
    0;

  // 정본 id 자체가 없으면 carry 가 끊긴 영속본 — silent 통과 금지.
  const unavailableReason =
    sourceSnapshotId === null
      ? '정본 sourceSnapshotId 부재 (scanEvaluation 미persist — 정본 carry 끊김)'
      : router === null && samples.length === 0
        ? '정본 수급 미persist (router/sample 부재 — 스캔이 수급 주입 전이거나 미실행)'
        : null;

  return {
    available: sourceSnapshotId !== null,
    sourceSnapshotId,
    scanAsOf,
    candidateCount,
    coverage,
    routerSelectedProvider: router?.selectedProvider ?? null,
    routerSignal: router?.signal ?? null,
    routerStatus: router?.status ?? null,
    perCandidate,
    unavailableReason,
  };
}

/**
 * 정본 수급 뷰를 /supply_health 메시지 섹션 라인으로 렌더링한다.
 * 빌더와 동일하게 순수 투영 — 재fetch·재계산 0.
 */
export function formatCanonicalSupplyViewLines(view: CanonicalSupplyView): string[] {
  const header = `📋 스캔 정본 수급 (이 사이클 실제 사용 · sourceSnapshotId=${view.sourceSnapshotId ?? 'NONE'})`;
  if (!view.available) {
    return [
      header,
      `  status: ${view.unavailableReason ?? '정본 없음 (스캔 미실행 또는 미persist)'}`,
      '  executionImpact=NONE',
      '  note: 아래 live-probe 섹션은 현재 채널 상태만 반영 — 스캔 정본과 다를 수 있음',
    ];
  }
  const lines: string[] = [
    header,
    `  scanAsOf: ${view.scanAsOf ?? 'N/A'}`,
    `  candidates: ${view.candidateCount}`,
    `  supplyCoverage: ${view.coverage ? `${view.coverage.available}/${view.coverage.total}` : 'N/A (router 미persist)'}`,
    `  selectedProvider: ${view.routerSelectedProvider ?? 'N/A'}`,
    `  signal: ${view.routerSignal ?? 'N/A'} (status=${view.routerStatus ?? 'N/A'})`,
    '  executionImpact=NONE',
    '  source: scanSummary read-only (재fetch 없음 — 스캔 주입 수급 정본)',
  ];
  if (view.perCandidate.length > 0) {
    lines.push('  perCandidate (top-N · 스캔 실사용 수급):');
    for (const candidate of view.perCandidate) {
      lines.push(
        `    ${candidate.symbol} foreignNetBuy=${formatCanonicalEokwon(candidate.foreignNetBuy)} ` +
          `institutionalNetBuy=${formatCanonicalEokwon(candidate.institutionalNetBuy)} ` +
          `source=${candidate.source} health=${candidate.supplyProviderHealth}`,
      );
    }
  } else if (view.unavailableReason) {
    lines.push(`  perCandidate: ${view.unavailableReason}`);
  } else {
    lines.push('  perCandidate: 없음 (스캔이 per-symbol 수급 샘플을 주입하지 않음)');
  }
  return lines;
}
