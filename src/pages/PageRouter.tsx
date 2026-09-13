// @responsibility Route the active research workspace.
import React, { useEffect } from 'react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { resolveWorkspaceView } from '../config/navigation';
import { SectionErrorBoundary } from '../components/common/SectionErrorBoundary';
import { PaperDashboardPage } from './PaperDashboardPage';

export function PageRouter() {
  const view = useSettingsStore(state => state.view);
  const setView = useSettingsStore(state => state.setView);
  const activeView = resolveWorkspaceView(view);
  useEffect(() => { if (view !== activeView) setView(activeView); }, [view, activeView, setView]);
  return <SectionErrorBoundary sectionName={activeView}><PaperDashboardPage page={activeView} /></SectionErrorBoundary>;
}
