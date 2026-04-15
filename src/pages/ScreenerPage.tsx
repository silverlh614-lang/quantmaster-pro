import React, { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { QuantScreener } from '../components/analysis/QuantScreener';
import { GateWizard } from '../components/analysis/GateWizard';
import { WeightConfigPanel } from '../components/analysis/WeightConfigPanel';
import { UniverseSelector, DEFAULT_UNIVERSE } from '../components/analysis/UniverseSelector';
import { BearScreenerPanel } from '../components/bear/BearScreenerPanel';
import { DartPreNewsPanel } from '../components/signals/DartPreNewsPanel';
import { useRecommendationStore, useAnalysisStore, useGlobalIntelStore } from '../stores';
import { PageHeader } from '../ui/page-header';
import { Card } from '../ui/card';
import { Stack } from '../layout/Stack';
import { ALL_CONDITIONS } from '../services/quant/evolutionEngine';
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

  // ── Factor Weights State ───────────────────────────────────────────────────
  const [factorWeights, setFactorWeights] = useState<Record<number, number>>(() => {
    const defaults: Record<number, number> = {};
    for (let id = 1; id <= 27; id++) defaults[id] = ALL_CONDITIONS[id]?.baseWeight ?? 1;
    return defaults;
  });

  // VKOSPI from global intel store (fallback to 18)
  const vkospiResult = useGlobalIntelStore(s => s.vkospiTriggerResult);
  const currentVkospi = vkospiResult?.vkospi ?? 18;

  // ── Gate Wizard: selected stock for evaluation ─────────────────────────────
  const [wizardStock, setWizardStock] = useState<StockRecommendation | null>(null);

  const handleScreenWithUniverse = useCallback(async (filters: StockFilters) => {
    await onScreen({ ...filters, universe });
  }, [onScreen, universe]);

  const handleBearScreen = async () => {
    await handleScreenWithUniverse({ mode: 'BEAR_SCREEN' });
  };

  const handleStockClickForWizard = useCallback((stock: StockRecommendation) => {
    setSelectedDetailStock(stock);
    setWizardStock(stock);
  }, [setSelectedDetailStock]);

  // Build condition scores from the selected stock's checklist data
  const wizardConditionScores = React.useMemo(() => {
    if (!wizardStock?.checklist) return undefined;
    const scores: Record<number, number> = {};
    wizardStock.checklist.forEach((item: any, idx: number) => {
      const id = idx + 1;
      scores[id] = typeof item.score === 'number' ? item.score : (item.passed ? 7 : 3);
    });
    return scores;
  }, [wizardStock]);

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

        {/* Factor Weight Control Panel — 27조건 가중치 */}
        <WeightConfigPanel
          weights={factorWeights}
          onWeightsChange={setFactorWeights}
          vkospi={currentVkospi}
        />

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
          onStockClick={handleStockClickForWizard}
          bearRegimeResult={bearRegimeResult}
        />

        {/* 3-Gate Wizard Flow — 종목 선택 시 활성화 */}
        <Card padding="lg">
          <div className="flex items-center gap-3 mb-5 sm:mb-6">
            <span className="text-micro">3-Gate 위저드 플로우 — 27조건 피라미드</span>
            {wizardStock && (
              <span className="text-xs font-black text-orange-400">
                {wizardStock.name} ({wizardStock.code})
              </span>
            )}
          </div>
          <GateWizard
            stockName={wizardStock?.name}
            stockCode={wizardStock?.code}
            conditionScores={wizardConditionScores}
          />
        </Card>

        {/* DART Pre-News 스크리너 — 공시 기반 선행 포착 */}
        <DartPreNewsPanel />
      </Stack>
    </motion.div>
  );
}
