// @vitest-environment jsdom
// @responsibility SectorStocksDrilldown 회귀 테스트 — ADR-0060 §3.2 shadow trade 추가 source
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SectorStocksDrilldown } from './SectorStocksDrilldown';
import { useRecommendationStore } from '../../stores';
import { useShadowTradeStore } from '../../stores/useShadowTradeStore';
import type { StockRecommendation } from '../../services/stockService';
import type { ShadowTrade } from '../../types/quant';

function makeStock(
  code: string,
  name: string,
  relatedSectors: string[],
  type: StockRecommendation['type'] = 'BUY',
): StockRecommendation {
  return {
    code,
    name,
    type,
    currentPrice: 10000,
    targetPrice: 11000,
    stopLoss: 9000,
    relatedSectors,
    checklist: {} as StockRecommendation['checklist'],
    visualReport: { financial: 0, technical: 0, supply: 0, summary: '' },
    historicalAnalogy: { stockName: '', period: '', similarity: 0, reason: '' },
    anomalyDetection: { type: 'NONE', score: 0, description: '' },
    semanticMapping: { theme: '', keywords: [], relevanceScore: 0, description: '' },
  } as unknown as StockRecommendation;
}

function makeShadow(
  code: string,
  name: string,
  sector: string | undefined,
  status: ShadowTrade['status'] = 'ACTIVE',
): ShadowTrade {
  return {
    id: `shadow-${code}-${status}`,
    signalTime: '2026-04-27T00:00:00.000Z',
    stockCode: code,
    stockName: name,
    sector,
    signalPrice: 10000,
    shadowEntryPrice: 10030,
    quantity: 10,
    kellyFraction: 0.05,
    stopLoss: 9000,
    targetPrice: 11000,
    status,
  };
}

describe('SectorStocksDrilldown — shadow trade 매칭 (ADR-0060 §3.2)', () => {
  beforeEach(() => {
    // 각 케이스 격리 — store 초기화
    useRecommendationStore.setState({ recommendations: [], watchlist: [] });
    useShadowTradeStore.setState({ shadowTrades: [] });
  });

  afterEach(() => {
    // jsdom DOM 정리 — render 누적 방지 (multiple elements 차단)
    cleanup();
  });

  it('활성 ACTIVE shadow trade — sector 단일 필드로 매칭되어 카드에 노출', () => {
    useShadowTradeStore.setState({
      shadowTrades: [makeShadow('005930', '삼성전자', '반도체', 'ACTIVE')],
    });
    const { getByText, queryByText } = render(
      <SectorStocksDrilldown sectorName="반도체" score={70} onClose={() => {}} />,
    );
    expect(getByText('삼성전자')).toBeTruthy();
    expect(getByText('005930')).toBeTruthy();
    // 보유 마커 표시
    expect(getByText('보유')).toBeTruthy();
    // placeholder 미노출
    expect(queryByText(/관심·추천·보유 종목 중/)).toBeNull();
  });

  it('closed shadow (HIT_TARGET / HIT_STOP) — 매칭에서 제외', () => {
    useShadowTradeStore.setState({
      shadowTrades: [
        makeShadow('005930', '삼성전자', '반도체', 'HIT_TARGET'),
        makeShadow('000660', 'SK하이닉스', '반도체', 'HIT_STOP'),
      ],
    });
    const { queryByText, getByText } = render(
      <SectorStocksDrilldown sectorName="반도체" score={70} onClose={() => {}} />,
    );
    // 두 closed shadow 모두 미노출
    expect(queryByText('삼성전자')).toBeNull();
    expect(queryByText('SK하이닉스')).toBeNull();
    // 빈 매칭 placeholder
    expect(getByText(/"반도체" 섹터에 속한 종목이 없습니다/)).toBeTruthy();
  });

  it('dedupe — recommendations 와 동일 code 의 shadow trade 는 한 번만 노출', () => {
    // 추천 = 반도체 / shadow = sector 단일 반도체 (동일 code)
    useRecommendationStore.setState({
      recommendations: [makeStock('005930', '삼성전자', ['반도체'], 'STRONG_BUY')],
      watchlist: [],
    });
    useShadowTradeStore.setState({
      shadowTrades: [makeShadow('005930', '삼성전자(보유)', '반도체', 'ACTIVE')],
    });
    const { container } = render(
      <SectorStocksDrilldown sectorName="반도체" score={70} onClose={() => {}} />,
    );
    // dedupe 확인 — code=005930 항목이 정확히 1건만 렌더 (li 갯수)
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(1);
    // 추천이 우선 (먼저 들어온 항목이 dedupe seen 에 먼저 등록) — STRONG_BUY 라벨 노출
    expect(items[0].textContent).toContain('STRONG_BUY');
    // 보유 마커는 미노출 (추천이 우선)
    expect(items[0].textContent).not.toContain('보유');
  });

  it('빈 매칭 — 추천·관심·shadow 모두 미매칭 시 placeholder', () => {
    useRecommendationStore.setState({
      recommendations: [makeStock('005930', '삼성전자', ['반도체'])],
    });
    useShadowTradeStore.setState({
      shadowTrades: [makeShadow('035420', 'NAVER', 'IT 서비스', 'ACTIVE')],
    });
    const { getByText, queryByText } = render(
      <SectorStocksDrilldown sectorName="에너지" score={20} onClose={() => {}} />,
    );
    expect(getByText(/"에너지" 섹터에 속한 종목이 없습니다/)).toBeTruthy();
    // 종목 카드 어느 것도 노출 안 됨
    expect(queryByText('삼성전자')).toBeNull();
    expect(queryByText('NAVER')).toBeNull();
  });
});
