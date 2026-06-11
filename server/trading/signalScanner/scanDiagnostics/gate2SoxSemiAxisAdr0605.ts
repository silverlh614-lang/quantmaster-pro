// @responsibility ADR-0605 — Gate2 반도체 후보의 sectorCycle 잔존 결손을 SOX(글로벌 반도체) 20일 수익 proxy 로 보충 (default OFF, BULLISH 민팅 금지).
/**
 * gate2SoxSemiAxisAdr0605.ts — ADR-0604 잔여 이행 "SOXX→Gate2 반도체 섹터축".
 *
 * ADR-0601(국내 업종지수 hydration) **이후에도** sectorCycle 이 결손인 반도체 후보에 한해
 * macroState 의 SOX 20일 수익(refreshSpxSection 일 1회 수집, 본 모듈 KIS fetch 0)을
 * proxy 섹터 사이클로 주입한다. `stockVsSectorReturn20d` 만 채워 buildSectorAxis 의
 * 최대 점수가 62(stockLeader 급)로 자연 캡 — sectorRelativeReturn20d 미주입으로
 * currentLeader(72/95) 민팅이 구조적으로 불가능하다 (ADR-0600 동종군 fallback 과 동일 보수).
 */

import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { getSectorByCode } from '../../../screener/sectorMap.js';

export interface Gate2SoxSemiAxisReportAdr0605 {
  enabled: boolean;
  soxAvailable: boolean;
  candidates: number;
  semiconductorCandidates: number;
  hydrated: number;
  executionImpact: 'NONE';
}

/** ADR-0605 스위치 — 정확 비교(=== 'true'), default OFF (관측 데이터 누적 후 운영자 활성화). */
export function isGate2SoxSectorAxisEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GATE2_SOX_SECTOR_AXIS_ENABLED === 'true';
}

interface HydratableSnapshot {
  symbol?: string;
  sector?: string;
  return20d?: number;
  symbolFeatures?: { return20d?: number };
  gate2ExternalDataCoverage?: Record<string, unknown>;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function hasSectorCoverage(snapshot: HydratableSnapshot): boolean {
  const cycle = snapshot.gate2ExternalDataCoverage?.sectorCycle as Record<string, unknown> | undefined;
  if (!cycle) return false;
  const status = String(cycle.status ?? '').toUpperCase();
  return status === 'VERIFIED' || status === 'PARTIAL' || cycle.available === true;
}

function isSemiconductorSector(snapshot: HydratableSnapshot): boolean {
  const sector = snapshot.sector ?? getSectorByCode(snapshot.symbol);
  return /반도체/.test(sector ?? '');
}

/**
 * 반도체 후보의 잔존 sectorCycle 결손을 SOX proxy(PARTIAL)로 보충. KIS fetch 0 —
 * macroState 에 sox20dReturn 이 없으면 전체 no-op (결손 ≠ 신호, 불변식 #6).
 */
export function hydrateGate2SoxSemiAxisAdr0605(input: {
  candidateSnapshots: readonly HydratableSnapshot[];
  sox20dReturn?: number | null;
  env?: NodeJS.ProcessEnv;
}): Gate2SoxSemiAxisReportAdr0605 {
  const env = input.env ?? process.env;
  const report: Gate2SoxSemiAxisReportAdr0605 = {
    enabled: isGate2SoxSectorAxisEnabled(env),
    soxAvailable: false,
    candidates: input.candidateSnapshots.length,
    semiconductorCandidates: 0,
    hydrated: 0,
    executionImpact: 'NONE',
  };
  if (!report.enabled) return report;

  const sox20d = input.sox20dReturn !== undefined
    ? input.sox20dReturn
    : loadMacroState()?.sox20dReturn ?? null;
  if (!finite(sox20d)) return report;
  report.soxAvailable = true;

  for (const snapshot of input.candidateSnapshots) {
    if (!snapshot.symbol || !isSemiconductorSector(snapshot)) continue;
    report.semiconductorCandidates += 1;
    if (hasSectorCoverage(snapshot)) continue;
    const stockReturn20d = finite(snapshot.symbolFeatures?.return20d)
      ? snapshot.symbolFeatures.return20d
      : finite(snapshot.return20d) ? snapshot.return20d : null;
    if (stockReturn20d == null) continue;

    snapshot.gate2ExternalDataCoverage = {
      ...(snapshot.gate2ExternalDataCoverage ?? {}),
      sectorCycle: {
        status: 'PARTIAL',
        available: true,
        // stockVsSectorReturn20d 만 주입 — buildSectorAxis 최대 62(stockLeader) 자연 캡.
        values: {
          sectorReturn20d: round1(sox20d),
          stockVsSectorReturn20d: round1(stockReturn20d - sox20d),
        },
        hydratedBy: 'ADR_0605_SOX_GLOBAL_SEMI_PROXY',
      },
    };
    report.hydrated += 1;
  }

  if (report.hydrated > 0) {
    console.info(
      `[ADR-0605] Gate2 SOX semi-proxy hydration — hydrated=${report.hydrated}/` +
        `${report.semiconductorCandidates} (sox20d=${round1(sox20d)}) executionImpact=NONE`,
    );
  }
  return report;
}
