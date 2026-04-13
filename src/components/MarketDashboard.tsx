import React from 'react';
import { MarketOverview } from '../services/stockService';
import { SectorHeatmap } from './SectorHeatmap';
import { AiMarketSummarySection } from './MarketDashboard/AiMarketSummarySection';
import { TriageSummarySection } from './MarketDashboard/TriageSummarySection';
import { DynamicWeightsSection } from './MarketDashboard/DynamicWeightsSection';
import { MarketPhaseSection } from './MarketDashboard/MarketPhaseSection';
import { SectorRotationSection } from './MarketDashboard/SectorRotationSection';
import { IndicesSection } from './MarketDashboard/IndicesSection';
import { GlobalEtfSection } from './MarketDashboard/GlobalEtfSection';
import { SentimentMacroSection } from './MarketDashboard/SentimentMacroSection';
import { GlobalTrendChart } from './MarketDashboard/GlobalTrendChart';

interface MarketDashboardProps {
  data: MarketOverview;
  triageSummary?: {
    gate1: number;
    gate2: number;
    gate3: number;
    total: number;
  };
}

export const MarketDashboard: React.FC<MarketDashboardProps> = ({ data, triageSummary }) => {
  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      {/* AI Market Summary */}
      <AiMarketSummarySection summary={data.summary} lastUpdated={data.lastUpdated} />

      {/* 3-Gate Market Triage Summary */}
      {triageSummary && (
        <TriageSummarySection
          gate1={triageSummary.gate1}
          gate2={triageSummary.gate2}
          gate3={triageSummary.gate3}
          total={triageSummary.total}
        />
      )}

      {/* AI Dynamic Weighting Strategy */}
      <DynamicWeightsSection weights={data.dynamicWeights} />

      {/* Sector Rotation Heatmap */}
      {data.sectorRotation?.topSectors && (
        <SectorHeatmap sectors={data.sectorRotation.topSectors} />
      )}

      {/* Market Phase & Quant Indicators */}
      <MarketPhaseSection
        marketPhase={data.marketPhase}
        activeStrategy={data.activeStrategy}
        euphoriaSignals={data.euphoriaSignals}
        regimeShiftDetector={data.regimeShiftDetector}
      />

      {/* Sector Rotation */}
      {data.sectorRotation?.topSectors && (
        <SectorRotationSection topSectors={data.sectorRotation.topSectors} />
      )}

      {/* Major Indices */}
      <IndicesSection indices={data.indices ?? []} />

      {/* Global ETF Monitoring */}
      {data.globalEtfMonitoring && data.globalEtfMonitoring.length > 0 && (
        <GlobalEtfSection etfs={data.globalEtfMonitoring} />
      )}

      {/* Sentiment & Macro */}
      <SentimentMacroSection
        snsSentiment={data.snsSentiment}
        exchangeRates={data.exchangeRates}
        commodities={data.commodities}
      />

      {/* Global Trend Chart */}
      <GlobalTrendChart indices={data.indices} />
    </div>
  );
};
