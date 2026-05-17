// @responsibility MarketOverviewHeader 레이아웃 컴포넌트
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { StickyMiniHeader } from '../components/common/StickyMiniHeader';
import { StatusBanner } from '../components/common/StatusBanner';
import { MarketDataStaleBadge } from '../components/common/MarketDataStaleBadge';
import { MarketModeBanner } from '../components/market/MarketModeBanner';
import { MarketRegimeBanner } from '../components/market/MarketRegimeBanner';
import { MarketNeutralPanel } from '../components/market/MarketNeutralPanel';
import { MarketTicker } from '../components/market/MarketTicker';
import { SectorRotationHeatmap } from '../components/sector/SectorRotationHeatmap';
import { PublicReportDashboard } from '../components/publicReport/PublicReportDashboard';
import { PublicReportModeToggle } from '../components/publicReport/PublicReportModeToggle';
import { useGlobalIntelStore, useMarketStore, useRecommendationStore, useSettingsStore } from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';

interface MarketOverviewHeaderProps {
  onRefresh: () => void;
}

/**
 * Top-of-page market overview stack: sticky mini-header, status banner,
 * regime/neutral panels, and the live market ticker. Data is read from
 * zustand stores; the refresh action is injected so the owning `useMarketData`
 * effect stays in one place.
 */
export function MarketOverviewHeader({ onRefresh }: MarketOverviewHeaderProps) {
  const { marketOverview, marketContext, loadingMarket } = useMarketStore();
  const recommendations = useRecommendationStore(s => s.recommendations);
  const shadowTrades = useShadowTradeStore(s => s.shadowTrades);
  const { publicReportViewMode, setPublicReportViewMode } = useSettingsStore();

  const bearRegimeResult = useGlobalIntelStore(s => s.bearRegimeResult);
  const vkospiTriggerResult = useGlobalIntelStore(s => s.vkospiTriggerResult);
  const inverseGate1Result = useGlobalIntelStore(s => s.inverseGate1Result);
  const marketNeutralResult = useGlobalIntelStore(s => s.marketNeutralResult);
  const sectorEnergyResult = useGlobalIntelStore(s => s.sectorEnergyResult);

  return (
    <>
      <StickyMiniHeader />
      <StatusBanner />
      <div className="px-4 py-2 flex flex-wrap items-center justify-end gap-2">
        <PublicReportModeToggle
          value={publicReportViewMode}
          onChange={setPublicReportViewMode}
        />
        <MarketDataStaleBadge variant="compact" />
      </div>
      {publicReportViewMode === 'OPERATION_MODE' ? (
        <>
          <MarketModeBanner />
          <MarketRegimeBanner
            bearRegimeResult={bearRegimeResult}
            vkospiTriggerResult={vkospiTriggerResult}
            inverseGate1Result={inverseGate1Result}
          />
          <SectorRotationHeatmap />
          <MarketNeutralPanel marketNeutralResult={marketNeutralResult} />
          <MarketTicker
            data={marketOverview}
            loading={loadingMarket}
            onRefresh={onRefresh}
          />
        </>
      ) : (
        <PublicReportDashboard
          viewMode={publicReportViewMode}
          marketOverview={marketOverview}
          marketContext={marketContext}
          recommendations={recommendations}
          sectorEnergyResult={sectorEnergyResult}
          shadowTrades={shadowTrades}
        />
      )}
    </>
  );
}
