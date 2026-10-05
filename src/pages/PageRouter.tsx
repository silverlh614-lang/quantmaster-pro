// @responsibility Route the active research workspace.
import React, { lazy, Suspense, useEffect } from 'react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { NAV_GROUPS, resolveWorkspaceView } from '../config/navigation';
import { SectionErrorBoundary } from '../components/common/SectionErrorBoundary';
import { PaperDashboardPage } from './PaperDashboardPage';
const Manual = lazy(() => import('./PaperManualPage').then(module => ({ default: module.PaperManualPage })));

export function PageRouter() {
  const view = useSettingsStore(state => state.view);
  const setView = useSettingsStore(state => state.setView);
  const activeView = resolveWorkspaceView(view);
  useEffect(() => { if (view !== activeView) setView(activeView); }, [view, activeView, setView]);
  const label = NAV_GROUPS.flatMap(group => group.items).find(item => item.id === activeView)?.label ?? '화면';
  return <SectionErrorBoundary key={activeView} sectionName={label}>{activeView === 'MANUAL'
    ? <Suspense fallback={<p role="status">설명서를 불러오는 중입니다…</p>}><Manual /></Suspense>
    : <PaperDashboardPage page={activeView} />}</SectionErrorBoundary>;
}
