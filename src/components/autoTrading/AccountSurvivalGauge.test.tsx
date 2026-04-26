// @vitest-environment jsdom
/**
 * @responsibility AccountSurvivalGauge tier 색상·placeholder·CALIBRATING 회귀 (ADR-0044 PR-Z2)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/survivalClient', () => ({
  fetchAccountSurvival: vi.fn(),
}));

import { fetchAccountSurvival, type SurvivalSnapshot } from '../../api/survivalClient';
import { AccountSurvivalGauge } from './AccountSurvivalGauge';

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderWith(snapshot: SurvivalSnapshot | Error) {
  if (snapshot instanceof Error) {
    vi.mocked(fetchAccountSurvival).mockRejectedValue(snapshot);
  } else {
    vi.mocked(fetchAccountSurvival).mockResolvedValue(snapshot);
  }
  const qc = makeClient();
  return render(
    <QueryClientProvider client={qc}>
      <AccountSurvivalGauge />
    </QueryClientProvider>,
  );
}

const baseSnapshot: SurvivalSnapshot = {
  dailyLoss: { currentPct: 1.5, limitPct: 5, bufferPct: 70, tier: 'OK' },
  sectorConcentration: { hhi: 2000, topSector: '반도체', topWeight: 0.3, activePositions: 4, tier: 'OK' },
  kellyConcordance: { ratio: 0.9, currentAvgKelly: 0.45, recommendedKelly: 0.5, sampleSize: 30, tier: 'OK' },
  overallTier: 'OK',
  capturedAt: '2026-04-26T13:00:00.000Z',
};

describe('AccountSurvivalGauge — ADR-0044', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('OK tier 시 안전 헤드라인 + 3 게이지 카드 모두 노출', async () => {
    renderWith(baseSnapshot);
    await waitFor(() => expect(screen.queryByTestId('survival-gauge-일일 손실 여유')).toBeTruthy());
    expect(screen.getByTestId('survival-gauge-일일 손실 여유').getAttribute('data-tier')).toBe('OK');
    expect(screen.getByTestId('survival-gauge-섹터 집중도')).toBeTruthy();
    expect(screen.getByTestId('survival-gauge-Kelly 정합도')).toBeTruthy();
  });

  it('overallTier=EMERGENCY 시 비상정지 권고 안내 표시', async () => {
    renderWith({
      ...baseSnapshot,
      dailyLoss: { currentPct: 5.5, limitPct: 5, bufferPct: -10, tier: 'EMERGENCY' },
      overallTier: 'EMERGENCY',
    });
    await waitFor(() => expect(screen.queryByTestId('survival-gauge-일일 손실 여유')).toBeTruthy());
    // 헤드라인 + 하단 경고 박스 둘 다 비상정지 텍스트 포함
    const matches = screen.getAllByText(/비상정지/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // 하단 경고 박스 (일일 손실 한도 도달) 별도 검증
    expect(screen.getByText(/일일 손실 한도 도달/)).toBeTruthy();
  });

  it('sectorConcentration tier=NA 시 활성 포지션 없음 안내', async () => {
    renderWith({
      ...baseSnapshot,
      sectorConcentration: { hhi: 0, topSector: null, topWeight: 0, activePositions: 0, tier: 'NA' },
    });
    await waitFor(() => expect(screen.getByText('N/A')).toBeTruthy());
    expect(screen.getByText(/활성 포지션 없음/)).toBeTruthy();
  });

  it('kellyConcordance tier=CALIBRATING 시 학습 중 라벨', async () => {
    renderWith({
      ...baseSnapshot,
      kellyConcordance: { ratio: null, currentAvgKelly: 0, recommendedKelly: 0, sampleSize: 2, tier: 'CALIBRATING' },
    });
    await waitFor(() => expect(screen.queryByTestId('survival-gauge-Kelly 정합도')).toBeTruthy());
    // primary text "학습 중" + tier label "학습 중" 둘 다 노출 가능
    const matches = screen.getAllByText('학습 중');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/표본 2건/)).toBeTruthy();
  });

  it('Kelly tier=CRITICAL 시 ratio 표시 + 위험 라벨', async () => {
    renderWith({
      ...baseSnapshot,
      kellyConcordance: { ratio: 2.0, currentAvgKelly: 1.0, recommendedKelly: 0.5, sampleSize: 50, tier: 'CRITICAL' },
      overallTier: 'CRITICAL',
    });
    await waitFor(() => expect(screen.getByText('2.00x')).toBeTruthy());
    const card = screen.getByTestId('survival-gauge-Kelly 정합도');
    expect(card.getAttribute('data-tier')).toBe('CRITICAL');
  });

  it('Sector tier=CRITICAL 시 HHI + 최대 섹터 표시', async () => {
    renderWith({
      ...baseSnapshot,
      sectorConcentration: { hhi: 5500, topSector: '반도체', topWeight: 0.6, activePositions: 3, tier: 'CRITICAL' },
      overallTier: 'CRITICAL',
    });
    await waitFor(() => expect(screen.getByText('HHI 5500')).toBeTruthy());
    expect(screen.getByText(/반도체 60%/)).toBeTruthy();
  });

  it('Daily loss tier=WARN 시 버퍼 % + 한도 표시', async () => {
    renderWith({
      ...baseSnapshot,
      dailyLoss: { currentPct: 2.5, limitPct: 5, bufferPct: 50, tier: 'WARN' },
      overallTier: 'WARN',
    });
    await waitFor(() => expect(screen.getByText(/50% 여유/)).toBeTruthy());
    expect(screen.getByText(/2.5% 손실/)).toBeTruthy();
  });

  it('fetch 실패 시 graceful placeholder', async () => {
    renderWith(new Error('boom'));
    // retry: 2 + 기본 backoff(>1s 누적) 라 timeout 길게 설정
    await waitFor(
      () => expect(screen.getByText(/데이터를 불러올 수 없습니다/)).toBeTruthy(),
      { timeout: 5000 },
    );
  });

  it('data-tier 속성으로 e2e/시각 회귀 가능', async () => {
    renderWith({
      ...baseSnapshot,
      overallTier: 'WARN',
      dailyLoss: { currentPct: 3, limitPct: 5, bufferPct: 40, tier: 'WARN' },
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('survival-gauge-일일 손실 여유').getAttribute('data-tier'),
      ).toBe('WARN');
    });
  });
});
