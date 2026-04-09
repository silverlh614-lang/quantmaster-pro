import React from 'react';
import { motion } from 'motion/react';
import { QuantScreener } from '../components/QuantScreener';
import { useRecommendationStore, useAnalysisStore } from '../stores';
import { PageHeader } from '../ui/page-header';
import { Stack } from '../layout/Stack';
import type { StockFilters, StockRecommendation } from '../services/stockService';

interface ScreenerPageProps {
  onScreen: (filters: StockFilters) => Promise<void>;
}

export function ScreenerPage({ onScreen }: ScreenerPageProps) {
  const { loading, screenerRecommendations } = useRecommendationStore();
  const { setSelectedDetailStock } = useAnalysisStore();

  return (
    <motion.div
      key="screener-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Stack gap="xl">
        <PageHeader
          title="Quant Screener + AI Pipeline"
          subtitle="정량 필터 → AI 질적 분석"
          accentColor="bg-blue-600"
        >
          정량적 필터로 후보군을 압축하고, AI가 질적 분석을 통해 최종 주도주를 선정하는 2단계 파이프라인입니다.
        </PageHeader>

        <QuantScreener
          onScreen={onScreen}
          loading={loading}
          recommendations={screenerRecommendations}
          onStockClick={(stock: StockRecommendation) => setSelectedDetailStock(stock)}
        />
      </Stack>
    </motion.div>
  );
}
