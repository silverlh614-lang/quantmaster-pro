// @responsibility Render mobile workspace navigation.
import React from 'react';
import { PRIMARY_MOBILE_TABS, resolveWorkspaceView } from '../config/navigation';
import { useSettingsStore } from '../stores/useSettingsStore';

export function BottomNav() {
  const view = useSettingsStore(state => state.view);
  const setView = useSettingsStore(state => state.setView);
  return <nav className="workspace-bottom-nav lg:hidden no-print" aria-label="모바일 메뉴">
    {PRIMARY_MOBILE_TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button"
      aria-label={label} aria-current={resolveWorkspaceView(view) === id ? 'page' : undefined}
      onClick={() => setView(id)}><Icon size={19} /><span>{label}</span></button>)}
  </nav>;
}
