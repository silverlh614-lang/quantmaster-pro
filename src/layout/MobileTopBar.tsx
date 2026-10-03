// @responsibility Render the mobile research workspace header.
import React from 'react';
import { PanelsTopLeft } from 'lucide-react';
import { AppMenuButton } from './AppMenuButton';
import { useSettingsStore } from '../stores/useSettingsStore';

export function MobileTopBar() {
  const setView = useSettingsStore((s) => s.setView);

  return (
    <div className="workspace-mobile-topbar">
      <AppMenuButton className="workspace-menu-trigger" />
      <button
        type="button"
        onClick={() => setView('DASHBOARD')}
        className="workspace-brand workspace-brand-mobile"
        aria-label="운영 현황 홈"
      >
        <span className="workspace-brand-mark" aria-hidden="true"><PanelsTopLeft size={19} strokeWidth={1.7} /></span>
        <span>QuantMaster<small>자율 투자 연구실</small></span>
      </button>
    </div>
  );
}
