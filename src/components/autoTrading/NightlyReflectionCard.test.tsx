// @vitest-environment jsdom
/**
 * @responsibility NightlyReflectionCard verdict·placeholder·편향·실험·누락 회귀 (ADR-0047 PR-Z5)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/learningClient', () => ({
  fetchLearningStatus: vi.fn(),
}));

import { fetchLearningStatus, type LearningStatusSnapshot } from '../../api/learningClient';
import { NightlyReflectionCard } from './NightlyReflectionCard';

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderWith(snapshot: LearningStatusSnapshot | Error) {
  if (snapshot instanceof Error) {
    vi.mocked(fetchLearningStatus).mockRejectedValue(snapshot);
  } else {
    vi.mocked(fetchLearningStatus).mockResolvedValue(snapshot);
  }
  const qc = makeClient();
  return render(
    <QueryClientProvider client={qc}>
      <NightlyReflectionCard />
    </QueryClientProvider>,
  );
}

const baseSnapshot: LearningStatusSnapshot = {
  lastReflection: {
    date: '2026-04-25',
    generatedAt: '2026-04-25T10:00:00Z',
    mode: 'FULL',
    dailyVerdict: 'GOOD_DAY',
    narrativeLength: 250,
    narrativePreview: '오늘은 강한 손절 규율로 손실을 -5% 이내 억제했다.',
    keyLessonsCount: 3,
    questionableDecisionsCount: 1,
    tomorrowAdjustmentsCount: 2,
    fiveWhyCount: 1,
    personaReviewStressed: true,
    integrityRemovedCount: 0,
    integrityParseFailed: false,
  },
  consecutiveMissingDays: 0,
  reflectionBudget: { mode: 'FULL' },
  biasHeatmapToday: null,
  biasHeatmap7dAvg: [
    { bias: 'OVERCONFIDENCE', avg: 0.45 },
    { bias: 'LOSS_AVERSION', avg: 0.55 },
    { bias: 'ANCHORING', avg: 0.30 },
  ],
  experimentProposalsActive: [],
  experimentProposalsCompletedRecent: [],
  tomorrowPriming: null,
  ghostPortfolioOpenCount: 0,
  suggestAlerts7d: { counterfactual: 0, ledger: 0, kellySurface: 0, regimeCoverage: 0, total: 0 },
  diagnostics: { healthy: true, warnings: [] },
};

describe('NightlyReflectionCard — ADR-0047', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('GOOD_DAY → 🟢 + 좋은 하루 라벨 + data-verdict=GOOD_DAY', async () => {
    renderWith(baseSnapshot);
    await waitFor(() => expect(screen.queryByTestId('nightly-reflection-card')).toBeTruthy());
    const card = screen.getByTestId('nightly-reflection-card');
    expect(card.getAttribute('data-verdict')).toBe('GOOD_DAY');
    expect(screen.getByText(/좋은 하루/)).toBeTruthy();
  });

  it('BAD_DAY → 🔴 + 안 좋은 하루 라벨', async () => {
    renderWith({
      ...baseSnapshot,
      lastReflection: { ...baseSnapshot.lastReflection!, dailyVerdict: 'BAD_DAY' },
    });
    await waitFor(() => expect(screen.queryByTestId('nightly-reflection-card')).toBeTruthy());
    const card = screen.getByTestId('nightly-reflection-card');
    expect(card.getAttribute('data-verdict')).toBe('BAD_DAY');
    expect(screen.getByText(/안 좋은 하루/)).toBeTruthy();
  });

  it('MIXED + SILENT verdict 라벨', async () => {
    renderWith({
      ...baseSnapshot,
      lastReflection: { ...baseSnapshot.lastReflection!, dailyVerdict: 'MIXED' },
    });
    await waitFor(() => expect(screen.queryByText(/혼재/)).toBeTruthy());
  });

  it('narrativePreview 표시 + narrativeLength > preview 면 … 표시', async () => {
    renderWith({
      ...baseSnapshot,
      lastReflection: {
        ...baseSnapshot.lastReflection!,
        narrativePreview: '강한 손절 규율',
        narrativeLength: 300,
      },
    });
    await waitFor(() => expect(screen.getByText(/강한 손절 규율…/)).toBeTruthy());
  });

  it('keyLessons / tomorrowAdjustments / fiveWhy / 활성 실험 카운트 4개 표시', async () => {
    renderWith({
      ...baseSnapshot,
      experimentProposalsActive: [
        { id: 'exp1', state: 'AWAIT_APPROVAL' },
        { id: 'exp2', state: 'RUNNING' },
      ],
    });
    await waitFor(() => expect(screen.getByText('배운 점')).toBeTruthy());
    expect(screen.getByText('내일 조정')).toBeTruthy();
    expect(screen.getByText('5-Why')).toBeTruthy();
    expect(screen.getByText('활성 실험')).toBeTruthy();
    // 활성 실험 violet 박스 노출
    expect(screen.getByText(/활성 실험 제안 2건/)).toBeTruthy();
  });

  it('biasHeatmap7dAvg Top 3 노출 + 점수 색상 분기', async () => {
    renderWith({
      ...baseSnapshot,
      biasHeatmap7dAvg: [
        { bias: 'OVERCONFIDENCE', avg: 0.75 },     // 🔴
        { bias: 'LOSS_AVERSION', avg: 0.55 },       // 🟡
        { bias: 'ANCHORING', avg: 0.30 },           // 정상
        { bias: 'SUNK_COST', avg: 0.20 },           // 4번째 — 미노출
      ],
    });
    await waitFor(() => expect(screen.getByText('OVERCONFIDENCE')).toBeTruthy());
    expect(screen.getByText('LOSS_AVERSION')).toBeTruthy();
    expect(screen.getByText('ANCHORING')).toBeTruthy();
    expect(screen.queryByText('SUNK_COST')).toBeFalsy();
  });

  it('consecutiveMissingDays ≥ 3 → ⚠️ 누락 경고 박스', async () => {
    renderWith({ ...baseSnapshot, consecutiveMissingDays: 5 });
    await waitFor(() => expect(screen.getByText(/Reflection 5일 연속 누락/)).toBeTruthy());
  });

  it('lastReflection=null → ReflectionAbsent placeholder', async () => {
    renderWith({
      ...baseSnapshot,
      lastReflection: null,
      consecutiveMissingDays: 5,
      reflectionBudget: { mode: 'TEMPLATE_ONLY' },
    });
    await waitFor(() => expect(screen.getByTestId('nightly-reflection-card')).toBeTruthy());
    const card = screen.getByTestId('nightly-reflection-card');
    expect(card.getAttribute('data-verdict')).toBe('ABSENT');
    expect(screen.getByText(/직전 30일 내 reflection 기록이 없습니다/)).toBeTruthy();
    expect(screen.getByText(/TEMPLATE_ONLY/)).toBeTruthy();
  });

  it('diagnostics.warnings 노출 (Reflection 부재 시 Top 3)', async () => {
    renderWith({
      ...baseSnapshot,
      lastReflection: null,
      diagnostics: {
        healthy: false,
        warnings: ['Gemini 예산 95% 도달', '템플릿 폴백 모드', '연속 5일 누락'],
      },
    });
    await waitFor(() => expect(screen.getByText(/Gemini 예산 95% 도달/)).toBeTruthy());
  });

  it('fetch 실패 → graceful placeholder', async () => {
    renderWith(new Error('learning down'));
    await waitFor(
      () => expect(screen.getByText(/학습 데이터를 불러올 수 없습니다/)).toBeTruthy(),
      { timeout: 5000 },
    );
  });

  it('mode 표시 (FULL/REDUCED_EOD/TEMPLATE_ONLY 등)', async () => {
    renderWith({
      ...baseSnapshot,
      lastReflection: { ...baseSnapshot.lastReflection!, mode: 'REDUCED_EOD' },
    });
    await waitFor(() => expect(screen.getByText(/모드 REDUCED_EOD/)).toBeTruthy());
  });
});
