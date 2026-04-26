// @vitest-environment jsdom
/**
 * @responsibility GateMiniIndicator dot/색상/tooltip 회귀 (ADR-0055 PR-Z7)
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { GateMiniIndicator } from './GateMiniIndicator';
import type { StockRecommendation } from '../../services/stockService';
import { GATE1_IDS, GATE2_IDS, GATE3_IDS } from '../../constants/gateConfig';
import { CONDITION_ID_TO_CHECKLIST_KEY } from '../../types/core';

function emptyChecklist(): StockRecommendation['checklist'] {
  return {
    cycleVerified: 0, momentumRanking: 0, roeType3: 0, supplyInflow: 0, riskOnEnvironment: 0,
    ichimokuBreakout: 0, mechanicalStop: 0, economicMoatVerified: 0, notPreviousLeader: 0,
    technicalGoldenCross: 0, volumeSurgeVerified: 0, institutionalBuying: 0, consensusTarget: 0,
    earningsSurprise: 0, performanceReality: 0, policyAlignment: 0, psychologicalObjectivity: 0,
    turtleBreakout: 0, fibonacciLevel: 0, elliottWaveVerified: 0, ocfQuality: 0,
    marginAcceleration: 0, interestCoverage: 0, relativeStrength: 0, vcpPattern: 0,
    divergenceCheck: 0, catalystAnalysis: 0,
  };
}

function makeStock(overrides: Partial<StockRecommendation> = {}): StockRecommendation {
  return {
    code: '005930',
    name: '삼성전자',
    type: 'BUY',
    confidence: '8/10',
    reasons: [],
    riskFactor: '',
    actionPlan: '',
    entryPrice: 70_000,
    targetPrice: 77_000,
    stopLoss: 66_500,
    confidenceScore: 80,
    relatedSectors: [],
    relatedNews: [],
    isLeading: false,
    sectorMomentum: 50,
    relativeStrength: 50,
    capitalScore: 50,
    institutionScore: 50,
    techScore: 50,
    aiSentimentScore: 50,
    chartFitScore: 50,
    riskScore: 50,
    fundamentalScore: 50,
    impactScore: 50,
    catalystScore: 50,
    sectorScore: 50,
    overallTier: 'A',
    isLastTrigger: false,
    momentumTrigger: false,
    economicMoat: false,
    cycleStage: 'EARLY',
    relatedThemes: [],
    catalysts: [],
    riskFlags: [],
    checklist: emptyChecklist(),
    visualReport: { financial: 50, technical: 50, supply: 50, summary: '' },
    ...overrides,
  } as unknown as StockRecommendation;
}

function setScores(checklist: StockRecommendation['checklist'], ids: readonly number[], score: number): void {
  for (const id of ids) {
    const key = CONDITION_ID_TO_CHECKLIST_KEY[id];
    if (key) {
      (checklist as unknown as Record<string, number>)[key] = score;
    }
  }
}

describe('GateMiniIndicator — ADR-0055', () => {
  afterEach(() => {
    cleanup();
  });

  it('4 dot 모두 렌더 + data-testid 부여', () => {
    render(<GateMiniIndicator stock={makeStock()} />);
    expect(screen.getByTestId('gate-mini-indicator')).toBeTruthy();
    for (let i = 0; i <= 3; i++) {
      expect(screen.getByTestId(`gate-mini-dot-${i}`)).toBeTruthy();
    }
  });

  it('빈 checklist + gateEvaluation 부재 → Gate 0 NA + Gate 1/2/3 FAIL', () => {
    render(<GateMiniIndicator stock={makeStock()} />);
    expect(screen.getByTestId('gate-mini-dot-0').getAttribute('data-gate-state')).toBe('NA');
    expect(screen.getByTestId('gate-mini-dot-1').getAttribute('data-gate-state')).toBe('FAIL');
    expect(screen.getByTestId('gate-mini-dot-2').getAttribute('data-gate-state')).toBe('FAIL');
    expect(screen.getByTestId('gate-mini-dot-3').getAttribute('data-gate-state')).toBe('FAIL');
  });

  it('전체 PASS — pass-count=4 + emerald 텍스트 색상', () => {
    const checklist = emptyChecklist();
    setScores(checklist, GATE1_IDS, 8);
    setScores(checklist, GATE2_IDS, 8);
    setScores(checklist, GATE3_IDS, 8);
    const stock = makeStock({
      gateEvaluation: { gate1Passed: true } as never,
      checklist,
    });
    render(<GateMiniIndicator stock={stock} />);
    const root = screen.getByTestId('gate-mini-indicator');
    expect(root.getAttribute('data-pass-count')).toBe('4');
    expect(screen.getByText('4/4').className).toContain('emerald');
  });

  it('NA dot — bg-transparent + border (stroke-only)', () => {
    render(<GateMiniIndicator stock={makeStock()} />);
    const naDot = screen.getByTestId('gate-mini-dot-0');
    expect(naDot.className).toContain('bg-transparent');
    expect(naDot.className).toContain('border');
  });

  it('PASS dot — emerald 색상', () => {
    const checklist = emptyChecklist();
    setScores(checklist, GATE1_IDS, 8);
    render(<GateMiniIndicator stock={makeStock({ checklist })} />);
    const dot = screen.getByTestId('gate-mini-dot-1');
    expect(dot.getAttribute('data-gate-state')).toBe('PASS');
    expect(dot.className).toContain('emerald');
  });

  it('tooltip — title 속성에 통과 카운트 노출', () => {
    const checklist = emptyChecklist();
    setScores(checklist, GATE1_IDS, 8);
    render(<GateMiniIndicator stock={makeStock({ checklist })} />);
    const dot = screen.getByTestId('gate-mini-dot-1');
    expect(dot.getAttribute('title')).toContain('Gate 1');
    expect(dot.getAttribute('title')).toContain(`${GATE1_IDS.length}/${GATE1_IDS.length}`);
    expect(dot.getAttribute('title')).toContain('통과');
  });
});
