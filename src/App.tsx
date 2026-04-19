/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * @responsibility 앱의 최상위 레이아웃을 조립하고 전역 effect 훅을 초기화한다.
 */

import React from 'react';
import { Toaster } from 'sonner';
import { PageRouter } from './pages/PageRouter';
import { GlobalModals } from './components/common/GlobalModals';
import { KeyboardShortcutsModal } from './components/common/KeyboardShortcutsModal';
import { Sidebar } from './layout/Sidebar';
import { SidebarDrawer } from './layout/SidebarDrawer';
import { MobileTopBar } from './layout/MobileTopBar';
import { BottomNav } from './layout/BottomNav';
import { PageContainer } from './layout/PageContainer';
import { AppFooter } from './layout/AppFooter';
import { MarketOverviewHeader } from './layout/MarketOverviewHeader';
import { SectorRotationSidePanel } from './layout/SectorRotationSidePanel';
import { SkipLink } from './layout/SkipLink';

import { useMarketData } from './hooks/useMarketData';
import { useAllGlobalIntel } from './hooks';
import { useDebugWatchers } from './hooks/useDebugWatchers';
import { useAppEffects } from './hooks/useAppEffects';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';

export default function App() {
  const { handleFetchMarketOverview } = useMarketData();

  useDebugWatchers();
  useAllGlobalIntel();
  useAppEffects();
  const { shortcutsOpen, closeShortcuts } = useGlobalShortcuts();

  return (
    <div className="min-h-screen bg-theme-bg text-theme-text font-sans selection:bg-blue-500/30 selection:text-white antialiased overflow-x-hidden bg-gradient-mesh bg-dot-grid">
      <SkipLink />
      <Toaster position="top-center" expand={false} richColors theme="dark" />

      <GlobalModals />
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={closeShortcuts} />
      <Sidebar />
      <SidebarDrawer />
      <BottomNav />

      <div className="app-main">
        <MobileTopBar />
        <MarketOverviewHeader onRefresh={() => handleFetchMarketOverview(true)} />

        <div className="flex">
          <main id="main-content" className="flex-1 min-w-0">
            <PageContainer size="full" className="no-print">
              <PageRouter onFetchMarketOverview={handleFetchMarketOverview} />
              <AppFooter />
            </PageContainer>
          </main>

          <SectorRotationSidePanel />
        </div>
      </div>
    </div>
  );
}
