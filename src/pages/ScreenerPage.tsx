import React, { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { QuantScreener } from '../components/analysis/QuantScreener';
import { UniverseSelector, DEFAULT_UNIVERSE } from '../components/analysis/UniverseSelector';
import { BearScreenerPanel } from '../components/bear/BearScreenerPanel';
import { DartPreNewsPanel } from '../components/signals/DartPreNewsPanel';
import { useRecommendationStore, useAnalysisStore, useGlobalIntelStore } from '../stores';
import { PageHeader } from '../ui/page-header';
import { Stack } from '../layout/Stack';
import type { StockFilters, StockRecommendation, UniverseConfig } from '../services/stockService';

interface ScreenerPageProps {
  onScreen: (filters: StockFilters) => Promise<void>;
}

export function ScreenerPage({ onScreen }: ScreenerPageProps) {
  const { loading, screenerRecommendations } = useRecommendationStore();
  const { setSelectedDetailStock } = useAnalysisStore();
  const bearRegimeResult = useGlobalIntelStore(s => s.bearRegimeResult);
  const bearScreenerResult = useGlobalIntelStore(s => s.bearScreenerResult);

  // ── Gate-0: Universe Selection State ───────────────────────────────────────
  const [universe, setUniverse] = useState<UniverseConfig>(DEFAULT_UNIVERSE);

  const handleScreenWithUniverse = useCallback(async (filters: StockFilters) => {
    await onScreen({ ...filters, universe });
  }, [onScreen, universe]);

  const handleBearScreen = async () => {
    await handleScreenWithUniverse({ mode: 'BEAR_SCREEN' });
  };

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

        {/* Gate-0: Universe Selector */}
        <UniverseSelector value={universe} onChange={setUniverse} />

        {/* Bear Screener 패널 — Bear Regime 감지 시 자동 활성화 */}
        <BearScreenerPanel
          bearScreenerResult={bearScreenerResult}
          loading={loading}
          recommendations={bearRegimeResult?.regime === 'BEAR' && screenerRecommendations.length > 0
            ? screenerRecommendations
            : []}
          onBearScreen={handleBearScreen}
          onStockClick={(stock: StockRecommendation) => setSelectedDetailStock(stock)}
        />

        <QuantScreener
          onScreen={handleScreenWithUniverse}
          loading={loading}
          recommendations={screenerRecommendations}
          onStockClick={(stock: StockRecommendation) => setSelectedDetailStock(stock)}
          bearRegimeResult={bearRegimeResult}
        />

        {/* DART Pre-News 스크리너 — 공시 기반 선행 포착 */}
        <DartPreNewsPanel />
      </Stack>
    </motion.div>
  );
}
