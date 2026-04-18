/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Toaster } from 'sonner';
import { PageRouter } from './pages/PageRouter';
import { GlobalModals } from './components/common/GlobalModals';
import { Sidebar } from './layout/Sidebar';
import { BottomNav } from './layout/BottomNav';
import { PageContainer } from './layout/PageContainer';
import { AppFooter } from './layout/AppFooter';
import { MarketOverviewHeader } from './layout/MarketOverviewHeader';
import { SectorRotationSidePanel } from './layout/SectorRotationSidePanel';

import { useMarketData } from './hooks/useMarketData';
import { useAllGlobalIntel } from './hooks';
import { useDebugWatchers } from './hooks/useDebugWatchers';
import { useAppEffects } from './hooks/useAppEffects';

export default function App() {
  const { handleFetchMarketOverview } = useMarketData();

  useDebugWatchers();
  useAllGlobalIntel();
  useAppEffects();

  return (
    <div className="min-h-screen bg-theme-bg text-theme-text font-sans selection:bg-blue-500/30 selection:text-white antialiased overflow-x-hidden bg-gradient-mesh bg-dot-grid">
      <Toaster position="top-center" expand={false} richColors theme="dark" />

      <GlobalModals />
      <Sidebar />
      <BottomNav />

      <div className="app-main">
        <MarketOverviewHeader onRefresh={() => handleFetchMarketOverview(true)} />

        <div className="flex">
          <div className="flex-1 min-w-0">
            <PageContainer size="full" className="no-print">
              <PageRouter onFetchMarketOverview={handleFetchMarketOverview} />
              <AppFooter />
            </PageContainer>
          </div>

          <SectorRotationSidePanel />
        </div>
      </div>
    </div>
  );
}
