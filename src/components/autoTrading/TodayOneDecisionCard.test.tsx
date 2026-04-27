// @vitest-environment jsdom
/**
 * @responsibility TodayOneDecisionCard tier·VOID·case 회귀 (ADR-0052 PR-Z4)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/survivalClient', () => ({
  fetchAccountSurvival: vi.fn(),
}));
vi.mock('../../api/decisionClient', () => ({
  fetchDecisionInputs: vi.fn(),
}));

import { fetchAccountSurvival, type SurvivalSnapshot } from '../../api/survivalClient';
import { fetchDecisionInputs, type DecisionInputs } from '../../api/decisionClient';
import { TodayOneDecisionCard } from './TodayOneDecisionCard';
import type { PositionItem } from '../../services/autoTrading/autoTradingTypes';

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderWith(survival: SurvivalSnapshot | Error, inputs: DecisionInputs | Error, positions: PositionItem[] = []) {
  if (survival instanceof Error) {
    vi.mocked(fetchAccountSurvival).mockRejectedValue(survival);
  } else {
    vi.mocked(fetchAccountSurvival).mockResolvedValue(survival);
  }
  if (inputs instanceof Error) {
    vi.mocked(fetchDecisionInputs).mockRejectedValue(inputs);
  } else {
    vi.mocked(fetchDecisionInputs).mockResolvedValue(inputs);
  }
  const qc = makeClient();
  return render(
    <QueryClientProvider client={qc}>
      <TodayOneDecisionCard positions={positions} />
    </QueryClientProvider>,
  );
}

const okSurvival: SurvivalSnapshot = {
  dailyLoss: { currentPct: 1.0, limitPct: 5.0, bufferPct: 80, tier: 'OK' },
  sectorConcentration: { hhi: 2000, topSector: '반도체', topWeight: 0.3, activePositions: 4, tier: 'OK' },
  kellyConcordance: { ratio: 0.9, currentAvgKelly: 0.45, recommendedKelly: 0.5, sampleSize: 30, tier: 'OK' },
  overallTier: 'OK',
  capturedAt: '2026-04-26T13:00:00.000Z',
};

const okInputs: DecisionInputs = {
  emergencyStop: false,
  pendingApprovals: [],
  macroSignals: {},
  capturedAt: '2026-04-26T13:00:00.000Z',
};

describe('TodayOneDecisionCard — ADR-0052', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('정상 → MONITORING case + tier=OK', async () => {
    renderWith(okSurvival, okInputs);
    await waitFor(() => expect(screen.queryByTestId('today-one-decision-card')).toBeTruthy());
    const card = screen.getByTestId('today-one-decision-card');
    expect(card.getAttribute('data-case')).toBe('MONITORING');
    expect(card.getAttribute('data-tier')).toBe('OK');
  });

  it('emergencyStop=true → EMERGENCY_STOP + tier=EMERGENCY', async () => {
    renderWith(okSurvival, { ...okInputs, emergencyStop: true });
    await waitFor(() => expect(screen.queryByTestId('today-one-decision-card')).toBeTruthy());
    const card = screen.getByTestId('today-one-decision-card');
    expect(card.getAttribute('data-case')).toBe('EMERGENCY_STOP');
    expect(card.getAttribute('data-tier')).toBe('EMERGENCY');
  });

  it('pendingApprovals 1건 → PENDING_APPROVALS + 종목명 노출', async () => {
    renderWith(okSurvival, {
      ...okInputs,
      pendingApprovals: [{ stockCode: '005930', stockName: '삼성전자', ageMs: 90_000 }],
    });
    await waitFor(() => expect(screen.queryByTestId('today-one-decision-card')).toBeTruthy());
    const card = screen.getByTestId('today-one-decision-card');
    expect(card.getAttribute('data-case')).toBe('PENDING_APPROVALS');
    expect(card.getAttribute('data-tier')).toBe('WARN');
    expect(screen.getByText(/삼성전자/)).toBeTruthy();
  });

  it('VOID 4 조건 충족 → VoidView + 가운데 메시지', async () => {
    const voidSurvival: SurvivalSnapshot = {
      ...okSurvival,
      sectorConcentration: { hhi: 0, topSector: null, topWeight: 0, activePositions: 0, tier: 'NA' },
    };
    const voidInputs: DecisionInputs = {
      ...okInputs,
      macroSignals: { vixHistory: [15, 16, 17, 18, 28], vix: 28, bearDefenseMode: true },
    };
    renderWith(voidSurvival, voidInputs);
    await waitFor(() => expect(screen.queryByTestId('today-one-decision-card')).toBeTruthy());
    const card = screen.getByTestId('today-one-decision-card');
    expect(card.getAttribute('data-case')).toBe('VOID');
    expect(card.getAttribute('data-tier')).toBe('VOID');
    expect(screen.getByText(/오늘은 진입하지 않는 것이 알파입니다/)).toBeTruthy();
    expect(screen.getByText(/SYSTEMATIC ALPHA HUNTER/)).toBeTruthy();
  });

  it('모든 fetch 실패 → graceful placeholder', async () => {
    renderWith(new Error('survival down'), new Error('inputs down'));
    await waitFor(
      () => expect(screen.getByText(/의사결정 데이터를 불러올 수 없습니다/)).toBeTruthy(),
      { timeout: 5000 },
    );
  });

  it('suggestedAction 텍스트 항상 노출 (정상 case)', async () => {
    renderWith(okSurvival, okInputs);
    await waitFor(() => expect(screen.queryByTestId('today-one-decision-card')).toBeTruthy());
    expect(screen.getByText(/권장 액션:/)).toBeTruthy();
  });
});
