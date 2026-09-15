// @responsibility Route the active research workspace.
import React, { useEffect } from 'react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { PRIMARY_MOBILE_TABS, resolveWorkspaceView } from '../config/navigation';
import { SectionErrorBoundary } from '../components/common/SectionErrorBoundary';
import { PaperDashboardPage } from './PaperDashboardPage';

export function PageRouter() {
  const view = useSettingsStore(state => state.view);
  const setView = useSettingsStore(state => state.setView);
  const activeView = resolveWorkspaceView(view);
  useEffect(() => { if (view !== activeView) setView(activeView); }, [view, activeView, setView]);
  const label = PRIMARY_MOBILE_TABS.find(item => item.id === activeView)?.label ?? '화면';
  return <SectionErrorBoundary key={activeView} sectionName={label}><PaperDashboardPage page={activeView} /></SectionErrorBoundary>;
}
