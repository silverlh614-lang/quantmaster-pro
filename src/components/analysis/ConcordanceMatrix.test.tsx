// @vitest-environment jsdom
/**
 * @responsibility ConcordanceMatrix 5×5 grid·색상·메타룰·표본부족 회귀 (ADR-0054 PR-Z6)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/concordanceClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/concordanceClient')>();
  return {
    ...actual,
    fetchAttributionConcordance: vi.fn(),
  };
});

import {
  fetchAttributionConcordance,
  ALL_CONCORDANCE_TIERS,
  type ConcordanceMatrix as MatrixData,
  type ConcordanceCell,
} from '../../api/concordanceClient';
import { ConcordanceMatrix } from './ConcordanceMatrix';

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function makeEmptyCells(): ConcordanceCell[] {
  const cells: ConcordanceCell[] = [];
  for (const q of ALL_CONCORDANCE_TIERS) {
    for (const a of ALL_CONCORDANCE_TIERS) {
      cells.push({
        quantTier: q, qualTier: a,
        sampleCount: 0, wins: 0, losses: 0,
        winRate: null, avgReturnPct: null,
      });
    }
  }
  return cells;
}

function setCell(cells: ConcordanceCell[], q: string, a: string, fields: Partial<ConcordanceCell>): void {
  const idx = cells.findIndex((c) => c.quantTier === q && c.qualTier === a);
  if (idx < 0) return;
  cells[idx] = { ...cells[idx], ...fields };
}

function makeMatrix(overrides: Partial<MatrixData> = {}): MatrixData {
  return {
    cells: makeEmptyCells(),
    diagonalStats: { sampleCount: 0, winRate: null, avgReturnPct: null },
    offDiagonalStats: { sampleCount: 0, winRate: null, avgReturnPct: null },
    totalSamples: 0,
    capturedAt: '2026-04-26T13:00:00.000Z',
    ...overrides,
  };
}

function renderWith(matrix: MatrixData | Error) {
  if (matrix instanceof Error) {
    vi.mocked(fetchAttributionConcordance).mockRejectedValue(matrix);
  } else {
    vi.mocked(fetchAttributionConcordance).mockResolvedValue(matrix);
  }
  const qc = makeClient();
  return render(
    <QueryClientProvider client={qc}>
      <ConcordanceMatrix />
    </QueryClientProvider>,
  );
}

describe('ConcordanceMatrix — ADR-0054', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('5×5 = 25 cell 모두 렌더', async () => {
    renderWith(makeMatrix());
    await waitFor(() => expect(screen.queryByTestId('concordance-matrix')).toBeTruthy());
    let count = 0;
    for (const q of ALL_CONCORDANCE_TIERS) {
      for (const a of ALL_CONCORDANCE_TIERS) {
        const cell = screen.queryByTestId(`concordance-cell-${q}-${a}`);
        expect(cell, `${q}-${a}`).toBeTruthy();
        count += 1;
      }
    }
    expect(count).toBe(25);
  });

  it('샘플 충분 + diagonal winRate > offDiagonal → 메타 룰 박스 표시', async () => {
    const cells = makeEmptyCells();
    setCell(cells, 'EXCELLENT', 'EXCELLENT', { sampleCount: 20, wins: 16, losses: 4, winRate: 80, avgReturnPct: 8 });
    setCell(cells, 'NEUTRAL', 'NEUTRAL', { sampleCount: 15, wins: 9, losses: 6, winRate: 60, avgReturnPct: 3 });
    setCell(cells, 'EXCELLENT', 'POOR', { sampleCount: 10, wins: 3, losses: 7, winRate: 30, avgReturnPct: -2 });
    renderWith(makeMatrix({
      cells,
      diagonalStats: { sampleCount: 35, winRate: 71.4, avgReturnPct: 5.5 },
      offDiagonalStats: { sampleCount: 10, winRate: 30, avgReturnPct: -2 },
      totalSamples: 45,
    }));
    await waitFor(() => expect(screen.queryByTestId('concordance-meta-rule')).toBeTruthy());
    expect(screen.getByText(/메타 룰 검증/)).toBeTruthy();
    expect(screen.getByText(/가설 지지/)).toBeTruthy();
  });

  it('표본 < 30 → 표본 부족 경고 (메타 룰 박스 미렌더)', async () => {
    renderWith(makeMatrix({ totalSamples: 10 }));
    await waitFor(() => expect(screen.queryByText(/표본 10건/)).toBeTruthy());
    expect(screen.getByText(/통계적 신뢰도 부족/)).toBeTruthy();
    expect(screen.queryByTestId('concordance-meta-rule')).toBeFalsy();
  });

  it('diagonal 셀 ring 강조 (sample > 0)', async () => {
    const cells = makeEmptyCells();
    setCell(cells, 'EXCELLENT', 'EXCELLENT', { sampleCount: 5, wins: 3, losses: 2, winRate: 60, avgReturnPct: 4 });
    renderWith(makeMatrix({ cells, totalSamples: 5 }));
    await waitFor(() => {
      const cell = screen.getByTestId('concordance-cell-EXCELLENT-EXCELLENT');
      expect(cell.className).toContain('ring-2');
    });
  });

  it('winRate 색상 분기 — ≥60 녹 / ≥40 황 / <40 적 / sample=0 회색', async () => {
    const cells = makeEmptyCells();
    setCell(cells, 'EXCELLENT', 'EXCELLENT', { sampleCount: 10, wins: 7, losses: 3, winRate: 70, avgReturnPct: 5 });   // 녹
    setCell(cells, 'GOOD', 'GOOD', { sampleCount: 10, wins: 5, losses: 5, winRate: 50, avgReturnPct: 1 });             // 황
    setCell(cells, 'WEAK', 'WEAK', { sampleCount: 10, wins: 2, losses: 8, winRate: 20, avgReturnPct: -3 });            // 적
    // POOR-POOR 은 sample=0 → 회색 유지
    renderWith(makeMatrix({ cells, totalSamples: 30 }));
    await waitFor(() => expect(screen.queryByTestId('concordance-matrix')).toBeTruthy());
    expect(screen.getByTestId('concordance-cell-EXCELLENT-EXCELLENT').className).toContain('emerald');
    expect(screen.getByTestId('concordance-cell-GOOD-GOOD').className).toContain('amber');
    expect(screen.getByTestId('concordance-cell-WEAK-WEAK').className).toContain('red');
    expect(screen.getByTestId('concordance-cell-POOR-POOR').className).toContain('zinc');
  });

  it('fetch 실패 → graceful placeholder', async () => {
    renderWith(new Error('boom'));
    await waitFor(
      () => expect(screen.getByText(/합치도 데이터를 불러올 수 없습니다/)).toBeTruthy(),
      { timeout: 5000 },
    );
  });
});
