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
import { useGlobalIntelStore, useMarketStore } from '../stores';

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
  const { marketOverview, marketContext, loadingMarket, staleFields } = useMarketStore();

  const bearRegimeResult = useGlobalIntelStore(s => s.bearRegimeResult);
  const vkospiTriggerResult = useGlobalIntelStore(s => s.vkospiTriggerResult);
  const inverseGate1Result = useGlobalIntelStore(s => s.inverseGate1Result);
  const marketNeutralResult = useGlobalIntelStore(s => s.marketNeutralResult);
  return (
    <>
      <StickyMiniHeader />
      <StatusBanner />
      <div className="px-4 py-2 flex flex-wrap items-center justify-end gap-2 no-print">
        <MarketDataStaleBadge variant="compact" />
      </div>
      <MarketModeBanner />
      <MarketRegimeBanner
        bearRegimeResult={bearRegimeResult}
        vkospiTriggerResult={vkospiTriggerResult}
        inverseGate1Result={inverseGate1Result}
        marketContext={marketContext}
        staleFields={staleFields}
      />
      <SectorRotationHeatmap />
      <MarketNeutralPanel marketNeutralResult={marketNeutralResult} />
      <MarketTicker
        data={marketOverview}
        loading={loadingMarket}
        onRefresh={onRefresh}
      />
    </>
  );
}
