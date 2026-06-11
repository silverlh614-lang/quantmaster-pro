// @responsibility counterfactual 보드 텔레그램 gate2/gate3 뷰에 네이티브 outcome ledger(Gate2 seed·Gate3 evidence) 요약을 덧붙이는 표시 브리지 (읽기 전용).

import { loadGate2OutcomeSeeds } from '../persistence/gate2OutcomeRepo.js';
import { loadGate3OutcomeSeeds } from '../persistence/gate3OutcomeRepo.js';

interface EvidenceRow {
  key: string;
  d1: number | null;
  d5: number | null;
}

interface EvidenceBand {
  key: string;
  n: number;
  matureD1: number;
  avgD1: number | null;
  winD1: number | null;
  matureD5: number;
  avgD5: number | null;
  winD5: number | null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pct(value: number | null): string {
  return value === null ? 'N/A' : `${Math.round(value * 100)}%`;
}

function num(value: number | null): string {
  return value === null ? 'N/A' : `${value.toFixed(2)}%`;
}

function aggregateBands(rows: readonly EvidenceRow[], keyOrder: readonly string[], maxKeys = 8): EvidenceBand[] {
  const byKey = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const list = byKey.get(row.key) ?? [];
    list.push(row);
    byKey.set(row.key, list);
  }
  const orderedKeys = [
    ...keyOrder.filter((key) => byKey.has(key)),
    ...[...byKey.keys()].filter((key) => !keyOrder.includes(key)).sort(),
  ].slice(0, maxKeys);
  const horizon = (list: EvidenceRow[], pick: (row: EvidenceRow) => number | null) => {
    const mature = list.map(pick).filter(finite);
    return {
      mature: mature.length,
      avg: mature.length > 0 ? Number((mature.reduce((sum, value) => sum + value, 0) / mature.length).toFixed(2)) : null,
      win: mature.length > 0 ? Number((mature.filter((value) => value > 0).length / mature.length).toFixed(2)) : null,
    };
  };
  return orderedKeys.map((key) => {
    const list = byKey.get(key) ?? [];
    const d1 = horizon(list, (row) => row.d1);
    const d5 = horizon(list, (row) => row.d5);
    return {
      key, n: list.length,
      matureD1: d1.mature, avgD1: d1.avg, winD1: d1.win,
      matureD5: d5.mature, avgD5: d5.avg, winD5: d5.win,
    };
  });
}

function bandLines(title: string, source: string, bands: EvidenceBand[], total: number): string {
  if (total === 0) {
    return [title, `rows=0 — seed 누적 대기 (source=${source})`, 'executionImpact=NONE'].join('\n');
  }
  return [
    title,
    ...bands.map((band) =>
      `${band.key}: n=${band.n} D1[n=${band.matureD1} avg=${num(band.avgD1)} win=${pct(band.winD1)}] D5[n=${band.matureD5} avg=${num(band.avgD5)} win=${pct(band.winD5)}]`,
    ),
    `rows=${total} source=${source} executionImpact=NONE`,
  ].join('\n');
}

const GATE2_STATUS_ORDER = ['GATE2_PASS_STRONG', 'GATE2_PASS_WEAK', 'GATE2_WATCH', 'GATE2_FAIL', 'DATA_INCOMPLETE'] as const;
const GATE3_READINESS_ORDER = [
  'EXECUTION_READY', 'SHADOW_READY', 'TRIGGER_WAIT', 'SETUP_READY', 'TIMING_FAIL', 'DATA_INCOMPLETE', 'INVALIDATED',
] as const;

/** Gate2 confluence seed ledger(스캔별 영속·forward cron 성숙)를 status 밴드로 요약 — 보드 행과 별개의 네이티브 증거. */
export function buildGate2SeedEvidenceLines(
  seeds: ReadonlyArray<{ gate2Status: string; forwardReturns?: { d1?: number | null; d5?: number | null } | null }> = loadGate2OutcomeSeeds(),
): string {
  const rows: EvidenceRow[] = seeds.map((seed) => ({
    key: String(seed.gate2Status ?? 'UNKNOWN'),
    d1: finite(seed.forwardReturns?.d1) ? (seed.forwardReturns.d1 as number) : null,
    d5: finite(seed.forwardReturns?.d5) ? (seed.forwardReturns.d5 as number) : null,
  }));
  return bandLines('[Gate2 Seed Evidence — native ledger]', 'gate2OutcomeRepo', aggregateBands(rows, GATE2_STATUS_ORDER), rows.length);
}

/** Gate3 outcome seed ledger(threshold evidence 원천)를 readiness 밴드로 요약. */
export function buildGate3EvidenceLines(
  seeds: ReadonlyArray<{ readiness: string; forwardReturns?: { d1?: number | null; d5?: number | null } | null }> = loadGate3OutcomeSeeds(),
): string {
  const rows: EvidenceRow[] = seeds.map((seed) => ({
    key: String(seed.readiness ?? 'UNKNOWN'),
    d1: finite(seed.forwardReturns?.d1) ? (seed.forwardReturns.d1 as number) : null,
    d5: finite(seed.forwardReturns?.d5) ? (seed.forwardReturns.d5 as number) : null,
  }));
  return bandLines('[Gate3 Outcome Evidence — native ledger]', 'gate3OutcomeRepo', aggregateBands(rows, GATE3_READINESS_ORDER), rows.length);
}

/** 명령 핸들러용 — 로드 실패가 보드 출력 자체를 깨지 않도록 격리 (silent 금지: 실패도 1줄 표시). */
export function appendGateEvidenceForMode(mode: string, baseText: string): string {
  try {
    if (mode === 'gate2') return `${baseText}\n${buildGate2SeedEvidenceLines()}`;
    if (mode === 'gate3') return `${baseText}\n${buildGate3EvidenceLines()}`;
    return baseText;
  } catch {
    return `${baseText}\n[GateEvidenceBridge] native ledger load failed — 표시 생략 (executionImpact=NONE)`;
  }
}
