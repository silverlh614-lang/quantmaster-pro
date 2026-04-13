import React, { useMemo } from 'react';
import { MarketOverview } from '../services/stockService';
import { SectionErrorBoundary } from './SectionErrorBoundary';
import { SectorHeatmap } from './SectorHeatmap';
import { AiMarketSummarySection } from './MarketDashboard/AiMarketSummarySection';
import { TriageSummarySection } from './MarketDashboard/TriageSummarySection';
import { DynamicWeightsSection } from './MarketDashboard/DynamicWeightsSection';
import { MarketPhaseSection } from './MarketDashboard/MarketPhaseSection';
import { SectorRotationSection } from './MarketDashboard/SectorRotationSection';
import { IndicesSection } from './MarketDashboard/IndicesSection';
import { GlobalEtfSection } from './MarketDashboard/GlobalEtfSection';

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
  // Defensive: handle sectorRotation being a flat array (legacy/stale persisted data)
  const topSectors = useMemo(() =>
    Array.isArray(data.sectorRotation)
      ? (data.sectorRotation as any[]).map((s: any, i: number) => ({
          name: s.sector || s.name || '',
          rank: s.rank ?? i + 1,
          strength: s.momentum ?? s.strength ?? 0,
          isLeading: s.isLeading ?? (s.flow === 'INFLOW'),
          sectorLeaderNewHigh: s.sectorLeaderNewHigh ?? false,
        }))
      : data.sectorRotation?.topSectors,
    [data.sectorRotation]
  );

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      {/* AI Market Summary */}
      <SectionErrorBoundary sectionName="AI 시장 요약">
        <AiMarketSummarySection summary={data.summary} lastUpdated={data.lastUpdated} />
      </SectionErrorBoundary>

      {/* 3-Gate Market Triage Summary */}
      {triageSummary && (
        <SectionErrorBoundary sectionName="3-Gate 트리아지">
          <TriageSummarySection
            gate1={triageSummary.gate1}
            gate2={triageSummary.gate2}
            gate3={triageSummary.gate3}
            total={triageSummary.total}
          />
        </SectionErrorBoundary>
      )}

      {/* AI Dynamic Weighting Strategy */}
      <SectionErrorBoundary sectionName="동적 가중치">
        <DynamicWeightsSection weights={data.dynamicWeights} />
      </SectionErrorBoundary>

      {/* Sector Rotation Heatmap */}
      {topSectors && topSectors.length > 0 && (
        <SectionErrorBoundary sectionName="섹터 히트맵">
          <SectorHeatmap sectors={topSectors} />
        </SectionErrorBoundary>
      )}

      {/* Market Phase & Quant Indicators */}
      <SectionErrorBoundary sectionName="시장 페이즈">
        <MarketPhaseSection
          marketPhase={data.marketPhase}
          activeStrategy={data.activeStrategy}
          euphoriaSignals={data.euphoriaSignals}
          regimeShiftDetector={data.regimeShiftDetector}
        />
      </SectionErrorBoundary>

      {/* Sector Rotation */}
      {topSectors && topSectors.length > 0 && (
        <SectionErrorBoundary sectionName="섹터 로테이션">
          <SectorRotationSection topSectors={topSectors} />
        </SectionErrorBoundary>
      )}

      {/* Major Indices */}
      <SectionErrorBoundary sectionName="주요 지수">
        <IndicesSection indices={data.indices ?? []} />
      </SectionErrorBoundary>

      {/* Global ETF Monitoring */}
      {data.globalEtfMonitoring && data.globalEtfMonitoring.length > 0 && (
        <SectionErrorBoundary sectionName="글로벌 ETF">
          <GlobalEtfSection etfs={data.globalEtfMonitoring} />
        </SectionErrorBoundary>
      )}
    </div>
  );
};
