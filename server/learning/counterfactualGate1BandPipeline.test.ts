// @responsibility Gate1 관측 ledger→counterfactual 보드 밴드 파이프라인 점수 스케일 정합 회귀 (2026-06-11 리뷰 §4 처방).
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildGate1DryRunObservationRows,
  resolveGate1ObservationTopNEnv,
} from '../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import type { CandidateSnapshot } from '../trading/signalScanner/entryFilterDecomposition.js';
import { buildCounterfactualOutcomeBoard, formatCounterfactualGate1 } from './counterfactualOutcomeBoard.js';

const NOW = new Date('2026-06-11T03:30:00.000Z');

function snapshot(symbol: string, gateScore: number, passed: boolean): CandidateSnapshot {
  return {
    symbol,
    name: `종목${symbol}`,
    gateScore,
    minSignalRequiredScore: 70,
    gate1Passed: passed,
    minSignalScorePassed: passed,
    price: 10_000,
  } as CandidateSnapshot;
}

function buildContext() {
  return {
    forDate: '2026-06-11',
    scanId: 'scan-eval-20260611-repro',
    sourceSnapshotId: 'snapshot-20260611-repro',
    candidateSetId: 'candidate-set-20260611-repro',
    regime: 'R5_BEAR',
    now: NOW,
  } as const;
}

async function boardFor(rows: Awaited<ReturnType<typeof buildGate1DryRunObservationRows>>) {
  return buildCounterfactualOutcomeBoard({
    now: NOW,
    gate1Rows: rows,
    counterfactualEntries: [],
    legacyEntries: [],
  });
}

function bandCount(board: Awaited<ReturnType<typeof boardFor>>, key: string): number {
  return board.gate1Bands.find((b) => b.key === key)?.count ?? -1;
}

describe('gate1 ledger → counterfactual board band pipeline (점수 스케일 정합)', () => {
  it('snapshot.gateScore 가 최소신호 스케일이면 전 밴드가 채워진다 (기준선)', async () => {
    const rows = buildGate1DryRunObservationRows({
      ...buildContext(),
      candidateSnapshots: [
        snapshot('000072', 72, true),
        snapshot('000066', 66, false),
        snapshot('000062', 62, false),
        snapshot('000057', 57, false),
        snapshot('000050', 50, false),
      ],
    });
    const board = await boardFor(rows);
    for (const key of ['70+', '65~70', '60~65', '55~60', 'below55']) {
      expect(bandCount(board, key), `band ${key}`).toBeGreaterThan(0);
    }
  });

  it('운영 형상(27조건 gateScore 0~10) 재현: map 미주입 시 전 행 below55 고착 (legacy fallback 보존)', async () => {
    const rows = buildGate1DryRunObservationRows({
      ...buildContext(),
      candidateSnapshots: [
        snapshot('000072', 7.2, true),
        snapshot('000066', 6.6, false),
        snapshot('000062', 6.2, false),
        snapshot('000057', 5.7, false),
        snapshot('000050', 5.0, false),
      ],
    });
    // 결함 형상의 문서화: legacy 점수는 below55 로만 귀속되고 NEAR_MISS 가 발화하지 않는다.
    expect(rows.every((row) => row.scoreSource === 'LEGACY_GATE_SCORE')).toBe(true);
    expect(rows.some((row) => row.source === 'GATE1_NEAR_MISS')).toBe(false);
    const board = await boardFor(rows);
    expect(bandCount(board, 'below55')).toBeGreaterThan(0);
    for (const key of ['70+', '65~70', '60~65', '55~60']) {
      expect(bandCount(board, key), `band ${key}`).toBe(0);
    }
  });

  it('수리: minSignalScoreBySymbol 주입 시 canonical 점수로 밴드 충전 + NEAR_MISS 발화 + scoreSource 표기', async () => {
    const rows = buildGate1DryRunObservationRows({
      ...buildContext(),
      candidateSnapshots: [
        snapshot('000072', 7.2, true),
        snapshot('000066', 6.6, false),
        snapshot('000062', 6.2, false),
        snapshot('000057', 5.7, false),
        snapshot('000050', 5.0, false),
      ],
      minSignalScoreBySymbol: {
        '000072': { actualScore: 72, requiredScore: 70 },
        '000066': { actualScore: 66, requiredScore: 70 },
        '000062': { actualScore: 62, requiredScore: 70 },
        '000057': { actualScore: 57, requiredScore: 70 },
        '000050': { actualScore: 50, requiredScore: 70 },
      },
    });
    const v2 = rows.filter((row) => row.source === 'GATE1_SCORE_OBSERVATION_V2');
    expect(v2.every((row) => row.scoreSource === 'MIN_SIGNAL_TRACE')).toBe(true);
    expect(v2.find((row) => row.symbol === '000072')?.dryRunDecision).toBe('WOULD_PASS_DRY_RUN');
    const nearMiss = rows.filter((row) => row.source === 'GATE1_NEAR_MISS');
    expect(nearMiss.map((row) => row.symbol).sort()).toEqual(['000062', '000066']);
    const board = await boardFor(rows);
    for (const key of ['70+', '65~70', '60~65', '55~60', 'below55']) {
      expect(bandCount(board, key), `band ${key}`).toBeGreaterThan(0);
    }
    const text = formatCounterfactualGate1(board);
    expect(text).toContain('unscored=');
    expect(text).toContain('excludedRows=');
  });
});

describe('GATE1_OBSERVATION_TOP_N ENV', () => {
  afterEach(() => {
    delete process.env.GATE1_OBSERVATION_TOP_N;
  });

  it('미설정/무효 시 undefined (default 보존), 유효 정수만 통과', () => {
    expect(resolveGate1ObservationTopNEnv({})).toBeUndefined();
    expect(resolveGate1ObservationTopNEnv({ GATE1_OBSERVATION_TOP_N: '' })).toBeUndefined();
    expect(resolveGate1ObservationTopNEnv({ GATE1_OBSERVATION_TOP_N: 'abc' })).toBeUndefined();
    expect(resolveGate1ObservationTopNEnv({ GATE1_OBSERVATION_TOP_N: '0' })).toBeUndefined();
    expect(resolveGate1ObservationTopNEnv({ GATE1_OBSERVATION_TOP_N: '2.5' })).toBeUndefined();
    expect(resolveGate1ObservationTopNEnv({ GATE1_OBSERVATION_TOP_N: '501' })).toBeUndefined();
    expect(resolveGate1ObservationTopNEnv({ GATE1_OBSERVATION_TOP_N: '50' })).toBe(50);
  });

  it('topN 확대 시 V2 관측이 default 10 을 넘어 전수 기록된다', () => {
    const snapshots = Array.from({ length: 41 }, (_, i) =>
      snapshot(String(100000 + i), 40 + i, false),
    );
    const byDefault = buildGate1DryRunObservationRows({
      ...buildContext(),
      candidateSnapshots: snapshots,
    }).filter((row) => row.source === 'GATE1_SCORE_OBSERVATION_V2');
    expect(byDefault.length).toBe(10);
    const expanded = buildGate1DryRunObservationRows({
      ...buildContext(),
      candidateSnapshots: snapshots,
      topN: 50,
    }).filter((row) => row.source === 'GATE1_SCORE_OBSERVATION_V2');
    expect(expanded.length).toBe(41);
  });
});
