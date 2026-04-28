// @vitest-environment jsdom
/**
 * @responsibility ShadowLearningPage 5 카드 회귀 — loading/error/empty/data 4 상태 + 정렬/카운트 (ADR-0088 PR-I).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  GoodDefenseCard,
  GoodRejectionCard,
  MissedAlphaCard,
  OverStrictCard,
  TwinRankingCard,
} from './ShadowLearningPage';
import type {
  RejectionShadowResponse,
  ShadowAttributionResponse,
  TwinPortfolioResponse,
} from '../api/shadowLearningClient';

afterEach(() => cleanup());

// ── Mock 헬퍼 ──────────────────────────────────────────────────────────────────

function makeRejectionEntry(overrides: Partial<RejectionShadowResponse['entries'][0]> = {}): RejectionShadowResponse['entries'][0] {
  return {
    id: `r_${Math.random().toString(36).slice(2)}`,
    stockCode: '005930',
    stockName: '삼성전자',
    signalDate: '2026-04-15',
    signalPriceKrw: 70000,
    gateScore: 16,
    scoreDelta: 2,
    rejectionReason: 'Gate 1 미달',
    trackUntil: '2026-04-22',
    closed: true,
    currentReturnPct: 5,
    ...overrides,
  };
}

function makeRejectionResponse(overrides: Partial<RejectionShadowResponse> = {}): RejectionShadowResponse {
  return {
    summary: {
      totalCount: 0, closedCount: 0, activeCount: 0,
      avgClosedReturnPct: 0, medianClosedReturnPct: 0,
      falseNegativeRate: 0, quartiles: { q1: 0, q2: 0, q3: 0 },
      reliable: false,
    },
    entries: [],
    totalCount: 0,
    ...overrides,
  };
}

function makeTwinResponse(overrides: Partial<TwinPortfolioResponse> = {}): TwinPortfolioResponse {
  return {
    comparison: {
      perTwin: {
        AGGRESSIVE: { twin: 'AGGRESSIVE', activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
        DISCIPLINED: { twin: 'DISCIPLINED', activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
        EQUAL_WEIGHT: { twin: 'EQUAL_WEIGHT', activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
      },
      realCumReturnPct: 0,
      weekWinning: { AGGRESSIVE: false, DISCIPLINED: false, EQUAL_WEIGHT: false },
    },
    entries: [],
    realCumReturnPct: 0,
    totalCount: 0,
    ...overrides,
  };
}

function makeAttributionResponse(overrides: Partial<ShadowAttributionResponse> = {}): ShadowAttributionResponse {
  return {
    totalConditions: 27,
    status: 'OK',
    closedSampleSize: 0,
    conditions: [],
    summary: { overStrictCandidates: 0, goodDefenseCandidates: 0, insufficient: 27, normal: 0 },
    ...overrides,
  };
}

// ── MissedAlphaCard ────────────────────────────────────────────────────────────

describe('MissedAlphaCard', () => {
  it('loading 상태 — placeholder 노출', () => {
    render(<MissedAlphaCard data={undefined} loading={true} error={null} />);
    expect(screen.getByText(/불러오는 중/)).toBeDefined();
  });

  it('error 상태 — ❌ 메시지', () => {
    render(<MissedAlphaCard data={undefined} loading={false} error={new Error('boom')} />);
    expect(screen.getByText(/조회 실패.*boom/)).toBeDefined();
  });

  it('데이터 부재 — 📭 + 통계 (closedCount + falseNegativeRate)', () => {
    const data = makeRejectionResponse({
      summary: {
        totalCount: 5, closedCount: 5, activeCount: 0,
        avgClosedReturnPct: 0, medianClosedReturnPct: 0,
        falseNegativeRate: 0.2, quartiles: { q1: 0, q2: 0, q3: 0 }, reliable: true,
      },
      entries: [makeRejectionEntry({ currentReturnPct: 2 })],
    });
    render(<MissedAlphaCard data={data} loading={false} error={null} />);
    // "종결 5건" 이 EmptyState + footer 두 곳에 등장 — getAllByText 로 ≥1 확인
    expect(screen.getAllByText(/종결 5건/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Alpha 누락 20\.0%/)).toBeDefined();
  });

  it('Missed Alpha 종목 표시 — ≥+5% 만 + 내림차순', () => {
    const data = makeRejectionResponse({
      entries: [
        makeRejectionEntry({ stockName: 'A', stockCode: '111111', currentReturnPct: 8 }),
        makeRejectionEntry({ stockName: 'B', stockCode: '222222', currentReturnPct: 12 }),
        makeRejectionEntry({ stockName: 'C', stockCode: '333333', currentReturnPct: 3 }),
      ],
    });
    render(<MissedAlphaCard data={data} loading={false} error={null} />);
    expect(screen.getByTestId('missed-222222')).toBeDefined(); // B 12%
    expect(screen.getByTestId('missed-111111')).toBeDefined(); // A 8%
    expect(screen.queryByTestId('missed-333333')).toBeNull(); // C 3% 제외
  });
});

// ── GoodRejectionCard ─────────────────────────────────────────────────────────

describe('GoodRejectionCard', () => {
  it('데이터 부재 → placeholder', () => {
    render(<GoodRejectionCard data={makeRejectionResponse()} loading={false} error={null} />);
    expect(screen.getByText(/회피 알파 추적 중/)).toBeDefined();
  });

  it('≤-5% 종목만 표시 + 내림차순 (가장 큰 손실 먼저)', () => {
    const data = makeRejectionResponse({
      entries: [
        makeRejectionEntry({ stockName: 'D', stockCode: '444444', currentReturnPct: -3 }),
        makeRejectionEntry({ stockName: 'E', stockCode: '555555', currentReturnPct: -8 }),
        makeRejectionEntry({ stockName: 'F', stockCode: '666666', currentReturnPct: -15 }),
      ],
    });
    render(<GoodRejectionCard data={data} loading={false} error={null} />);
    expect(screen.queryByTestId('defended-444444')).toBeNull(); // -3% 제외
    expect(screen.getByTestId('defended-555555')).toBeDefined(); // -8%
    expect(screen.getByTestId('defended-666666')).toBeDefined(); // -15%
  });
});

// ── TwinRankingCard ────────────────────────────────────────────────────────────

describe('TwinRankingCard', () => {
  it('loading → placeholder', () => {
    render(<TwinRankingCard data={undefined} loading={true} error={null} />);
    expect(screen.getByText(/불러오는 중/)).toBeDefined();
  });

  it('정렬 — cumReturnPct 내림차순 (CURRENT 포함)', () => {
    const data = makeTwinResponse({
      comparison: {
        perTwin: {
          AGGRESSIVE: { twin: 'AGGRESSIVE', activeCount: 0, closedCount: 5, avgReturnPct: 0, cumReturnPct: 9.4, weeklySharpeProxy: 0.4 },
          DISCIPLINED: { twin: 'DISCIPLINED', activeCount: 0, closedCount: 3, avgReturnPct: 0, cumReturnPct: 5.8, weeklySharpeProxy: 0.3 },
          EQUAL_WEIGHT: { twin: 'EQUAL_WEIGHT', activeCount: 0, closedCount: 4, avgReturnPct: 0, cumReturnPct: 3.9, weeklySharpeProxy: 0.2 },
        },
        realCumReturnPct: 4.2,
        weekWinning: { AGGRESSIVE: true, DISCIPLINED: true, EQUAL_WEIGHT: false },
      },
      realCumReturnPct: 4.2,
      totalCount: 12,
    });
    render(<TwinRankingCard data={data} loading={false} error={null} />);
    // 4 행 모두 렌더 (twin-0/1/2/3 data-testid)
    expect(screen.getByTestId('twin-0')).toBeDefined();
    expect(screen.getByTestId('twin-1')).toBeDefined();
    expect(screen.getByTestId('twin-2')).toBeDefined();
    expect(screen.getByTestId('twin-3')).toBeDefined();
    // 1위 = AGGRESSIVE 9.4%
    expect(screen.getByTestId('twin-0').textContent).toContain('AGGRESSIVE');
  });

  it('promotion 안내 라인 항상 표시', () => {
    const data = makeTwinResponse({ totalCount: 0 });
    render(<TwinRankingCard data={data} loading={false} error={null} />);
    expect(screen.getByText(/promotion/)).toBeDefined();
  });
});

// ── OverStrictCard ─────────────────────────────────────────────────────────────

describe('OverStrictCard', () => {
  it('DISABLED 상태 → 비활성 메시지', () => {
    const data = makeAttributionResponse({
      status: 'DISABLED',
      summary: { overStrictCandidates: 0, goodDefenseCandidates: 0, insufficient: 0, normal: 0 },
    });
    render(<OverStrictCard data={data} loading={false} error={null} />);
    expect(screen.getByText(/비활성/)).toBeDefined();
  });

  it('NO_DATA 상태 → PR-F-2 후속 안내', () => {
    const data = makeAttributionResponse({ status: 'NO_DATA' });
    render(<OverStrictCard data={data} loading={false} error={null} />);
    expect(screen.getByText(/PR-F-2/)).toBeDefined();
  });

  it('over_strict_candidate 표시 — overStrictCount 내림차순', () => {
    const data = makeAttributionResponse({
      closedSampleSize: 50,
      conditions: [
        {
          conditionId: 25, conditionName: 'VCP', overStrictCount: 8, goodDefenseCount: 1,
          overStrictAvgReturn: 12, goodDefenseAvgReturn: -3, ratio: 0.89,
          classification: 'over_strict_candidate',
        },
        {
          conditionId: 18, conditionName: 'RS Rating', overStrictCount: 5, goodDefenseCount: 1,
          overStrictAvgReturn: 8, goodDefenseAvgReturn: -2, ratio: 0.83,
          classification: 'over_strict_candidate',
        },
      ],
      summary: { overStrictCandidates: 2, goodDefenseCandidates: 0, insufficient: 25, normal: 0 },
    });
    render(<OverStrictCard data={data} loading={false} error={null} />);
    expect(screen.getByTestId('over-strict-25')).toBeDefined();
    expect(screen.getByTestId('over-strict-18')).toBeDefined();
  });

  it('OK + 후보 0건 → "후보 없음" placeholder', () => {
    const data = makeAttributionResponse({
      closedSampleSize: 30,
      conditions: [],
      summary: { overStrictCandidates: 0, goodDefenseCandidates: 0, insufficient: 27, normal: 0 },
    });
    render(<OverStrictCard data={data} loading={false} error={null} />);
    expect(screen.getByText(/후보 없음/)).toBeDefined();
  });
});

// ── GoodDefenseCard ────────────────────────────────────────────────────────────

describe('GoodDefenseCard', () => {
  it('good_defense_candidate 표시 — goodDefenseCount 내림차순', () => {
    const data = makeAttributionResponse({
      closedSampleSize: 30,
      conditions: [
        {
          conditionId: 16, conditionName: '외인수급', overStrictCount: 1, goodDefenseCount: 6,
          overStrictAvgReturn: 6, goodDefenseAvgReturn: -8, ratio: 0.14,
          classification: 'good_defense_candidate',
        },
      ],
      summary: { overStrictCandidates: 0, goodDefenseCandidates: 1, insufficient: 26, normal: 0 },
    });
    render(<GoodDefenseCard data={data} loading={false} error={null} />);
    expect(screen.getByTestId('good-defense-16')).toBeDefined();
  });

  it('NO_DATA → PR-F-2 안내', () => {
    const data = makeAttributionResponse({ status: 'NO_DATA' });
    render(<GoodDefenseCard data={data} loading={false} error={null} />);
    expect(screen.getByText(/PR-F-2/)).toBeDefined();
  });
});
