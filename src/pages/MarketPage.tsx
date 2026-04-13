import React, { useEffect, useMemo, Suspense, lazy } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, Activity } from 'lucide-react';
import { MarketDashboard } from '../components/MarketDashboard';
import { EventCalendar } from '../components/EventCalendar';
import { MacroIntelligenceDashboard } from '../components/MacroIntelligenceDashboard';
import { MHSHistoryChart } from '../components/MHSHistoryChart';
import { IntelligenceRadar } from '../components/IntelligenceRadar';
import { SectionErrorBoundary } from '../components/SectionErrorBoundary';
import { useMarketStore, useGlobalIntelStore, useRecommendationStore } from '../stores';
import { evaluateGate0 } from '../services/quant/gateEngine';
import { PageHeader } from '../ui/page-header';
import { Button } from '../ui/button';
import { Section } from '../ui/section';
import { LoadingState } from '../ui/loading-state';
import { EmptyState } from '../ui/empty-state';
import { Badge } from '../ui/badge';
import { Stack } from '../layout/Stack';
import { PageGrid } from '../layout/PageGrid';

const LazySentimentMacroSection = lazy(() =>
  import('../components/MarketDashboard/SentimentMacroSection').then(m => ({ default: m.SentimentMacroSection }))
);
const LazyGlobalTrendChart = lazy(() =>
  import('../components/MarketDashboard/GlobalTrendChart').then(m => ({ default: m.GlobalTrendChart }))
);

interface MarketPageProps {
  onFetchMarketOverview: (force?: boolean) => Promise<void>;
}

export function MarketPage({ onFetchMarketOverview }: MarketPageProps) {
  const { marketOverview, marketContext, loadingMarket } = useMarketStore();
  const globalIntelStore = useGlobalIntelStore();
  const { recommendations } = useRecommendationStore();

  // Auto-fetch market data on page load when no data is available
  useEffect(() => {
    if (!marketOverview && !loadingMarket) {
      onFetchMarketOverview();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const macroEnv = globalIntelStore.macroEnv;
  const currentRoeType = globalIntelStore.currentRoeType;
  const economicRegimeData = globalIntelStore.economicRegimeData;
  const extendedRegimeData = globalIntelStore.extendedRegimeData;
  const smartMoneyData = globalIntelStore.smartMoneyData;
  const exportMomentumData = globalIntelStore.exportMomentumData;
  const geoRiskData = globalIntelStore.geoRiskData;
  const creditSpreadData = globalIntelStore.creditSpreadData;
  const globalCorrelation = globalIntelStore.globalCorrelation;
  const supplyChainData = globalIntelStore.supplyChainData;
  const sectorOrderData = globalIntelStore.sectorOrderData;
  const financialStressData = globalIntelStore.financialStressData;
  const fomcSentimentData = globalIntelStore.fomcSentimentData;
  const mhsHistory = globalIntelStore.mhsHistory;

  const gate0Result = useMemo(() => macroEnv ? evaluateGate0(macroEnv) : undefined, [macroEnv]);

  const triageSummary = useMemo(() => {
    const summary = { gate1: 0, gate2: 0, gate3: 0, total: (recommendations || []).length };
    (recommendations || []).forEach(rec => {
      if (rec.gate === 1) summary.gate1++;
      else if (rec.gate === 2) summary.gate2++;
      else if (rec.gate === 3) summary.gate3++;
    });
    return summary;
  }, [recommendations]);

  return (
    <motion.div
      key="market-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Stack gap="xl">
        {/* Page Header */}
        <PageHeader
          title="시장 대시보드"
          subtitle="Global Market Overview"
          accentColor="bg-indigo-500"
          actions={
            <Button
              variant="secondary"
              size="md"
              icon={<RefreshCw className={loadingMarket ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />}
              onClick={() => onFetchMarketOverview(true)}
              disabled={loadingMarket}
            >
              데이터 갱신
            </Button>
          }
        />

        {/* Market Dashboard */}
        {loadingMarket && !marketOverview ? (
          <LoadingState message="AI가 실시간 시장 데이터를 분석 중입니다..." />
        ) : marketOverview ? (
          <>
            <PageGrid columns="2-1" gap="md">
              <MarketDashboard data={marketOverview} triageSummary={triageSummary} />
              <EventCalendar events={marketOverview?.upcomingEvents || marketContext?.upcomingEvents || []} />
            </PageGrid>

            {/* Distributed heavy sections - moved out of MarketDashboard for load balancing */}
            <SectionErrorBoundary sectionName="센티먼트 & 매크로">
              <Suspense fallback={<LoadingState message="센티먼트 데이터 로딩 중..." />}>
                <LazySentimentMacroSection
                  snsSentiment={marketOverview.snsSentiment}
                  exchangeRates={marketOverview.exchangeRates}
                  commodities={marketOverview.commodities}
                />
              </Suspense>
            </SectionErrorBoundary>

            <SectionErrorBoundary sectionName="글로벌 추이 차트">
              <Suspense fallback={<LoadingState message="차트 로딩 중..." />}>
                <LazyGlobalTrendChart indices={marketOverview.indices} />
              </Suspense>
            </SectionErrorBoundary>
          </>
        ) : (
          <EmptyState
            icon={<Activity className="w-8 h-8" />}
            title="시장 데이터를 불러올 수 없습니다"
            description="새로고침 버튼을 눌러 다시 시도해 주세요."
          />
        )}

        {/* Macro Intelligence */}
        <SectionErrorBoundary sectionName="거시 인텔리전스">
          <Section
            title="거시 인텔리전스"
            subtitle="Gate 0 · Macro Intelligence Dashboard"
            actions={
              macroEnv && gate0Result ? (
                <Badge variant={gate0Result.buyingHalted ? 'danger' : gate0Result.mhsLevel === 'HIGH' ? 'success' : 'warning'}>
                  MHS {gate0Result.macroHealthScore} · {gate0Result.mhsLevel === 'HIGH' ? '정상 매수' : gate0Result.mhsLevel === 'MEDIUM' ? 'Kelly 축소' : '매수 중단'}
                </Badge>
              ) : !macroEnv ? (
                <span className="text-micro text-amber-400/70 animate-pulse">데이터 수집 중...</span>
              ) : null
            }
          >
            <MacroIntelligenceDashboard
              gate0Result={gate0Result}
              currentRoeType={currentRoeType}
              externalRegime={extendedRegimeData ?? economicRegimeData ?? undefined}
              marketOverview={marketOverview ? {
                sectorRotation: (marketOverview.sectorRotation?.topSectors || []).map((s: any) => ({
                  sector: s.sector || s.name || '',
                  momentum: s.strength ?? s.momentum ?? 0,
                  flow: s.flow || 'NEUTRAL',
                })),
                globalEtfMonitoring: (marketOverview.globalEtfMonitoring || []).map((e: any) => ({
                  name: e.name || e.ticker || '',
                  flow: e.flow || 'NEUTRAL',
                  change: e.priceChange ?? e.change ?? 0,
                })),
                exchangeRates: (marketOverview.exchangeRates || []).map((r: any) => ({
                  name: r.name || r.currency || '',
                  value: r.value ?? r.rate ?? 0,
                  change: r.change ?? 0,
                })),
              } : undefined}
              externalSupplyChain={supplyChainData ?? undefined}
              externalSectorOrders={sectorOrderData ?? undefined}
              externalFsi={financialStressData ?? undefined}
              externalFomcSentiment={fomcSentimentData ?? undefined}
            />
          </Section>
        </SectionErrorBoundary>

        {/* MHS History */}
        <SectionErrorBoundary sectionName="MHS 히스토리">
          <MHSHistoryChart records={mhsHistory} height={280} />
        </SectionErrorBoundary>

        {/* Intelligence Radar */}
        <SectionErrorBoundary sectionName="글로벌 인텔리전스 레이더">
          <IntelligenceRadar
            gate0={gate0Result}
            smartMoney={smartMoneyData}
            exportMomentum={exportMomentumData}
            geoRisk={geoRiskData}
            creditSpread={creditSpreadData}
            correlation={globalCorrelation}
            supplyChain={supplyChainData}
            sectorOrders={sectorOrderData}
            fsi={financialStressData}
            fomcSentiment={fomcSentimentData}
          />
        </SectionErrorBoundary>
      </Stack>
    </motion.div>
  );
}
