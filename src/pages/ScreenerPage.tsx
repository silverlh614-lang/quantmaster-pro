import React from 'react';
import { QuantScreener } from '../components/QuantScreener';
import { useRecommendationStore, useAnalysisStore } from '../stores';
import type { StockFilters, StockRecommendation } from '../services/stockService';

interface ScreenerPageProps {
  onScreen: (filters: StockFilters) => Promise<void>;
}

export function ScreenerPage({ onScreen }: ScreenerPageProps) {
  const { loading, screenerRecommendations } = useRecommendationStore();
  const { setSelectedDetailStock } = useAnalysisStore();

  return (
    <div
      key="screener-view"
      className="space-y-12"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <div className="flex items-center gap-4 mb-6">
            <div className="w-3 h-10 bg-blue-600 rounded-full shadow-[0_0_20px_rgba(37,99,235,0.5)]" />
            <h2 className="text-4xl font-black text-white tracking-tighter uppercase">Quant Screener + AI Pipeline</h2>
          </div>
          <p className="text-white/40 font-medium max-w-2xl text-lg">
            정량적 필터로 후보군을 압축하고, AI가 질적 분석을 통해 최종 주도주를 선정하는 2단계 파이프라인입니다.
          </p>
        </div>
      </div>
      <QuantScreener
        onScreen={onScreen}
        loading={loading}
        recommendations={screenerRecommendations}
        onStockClick={(stock: StockRecommendation) => setSelectedDetailStock(stock)}
      />
    </div>
  );
}
