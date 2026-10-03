// @responsibility Render desktop workspace navigation.
import React from 'react';
import { ArrowUpRight, Keyboard, PanelsTopLeft } from 'lucide-react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { NAV_GROUPS, resolveWorkspaceView } from '../config/navigation';

export function Sidebar({ asDrawer = false }: { asDrawer?: boolean } = {}) {
  const view = useSettingsStore(state => state.view);
  const setView = useSettingsStore(state => state.setView);
  return <aside className={`workspace-sidebar no-print ${asDrawer ? 'app-sidebar-drawer' : 'app-sidebar'}`}>
    <button type="button" className="workspace-brand" onClick={() => setView('DASHBOARD')} aria-label="운영 현황 홈">
      <span className="workspace-brand-mark" aria-hidden="true"><PanelsTopLeft size={21} strokeWidth={1.7} /></span>
      <span>QuantMaster<small>자율 투자 연구실</small></span>
    </button>
    <nav aria-label="주 메뉴" className="workspace-menu">
      <p className="workspace-eyebrow">워크스페이스</p>
      {NAV_GROUPS[0].items.map(({ id, label, icon: Icon }, index) => <button type="button" key={id}
        aria-current={resolveWorkspaceView(view) === id ? 'page' : undefined}
        onClick={() => setView(id)}><Icon size={18} strokeWidth={1.6} aria-hidden="true" /><span>{label}</span><small aria-hidden="true">0{index + 1}</small></button>)}
    </nav>
    <div className="workspace-sidebar-note"><span className="workspace-eyebrow">매일 스스로 연구</span>
      <p>지표를 만들고, 성과를 관측해<br />다음 판단의 근거를 쌓습니다.</p>
      <button type="button" onClick={() => setView('PAPER_RESEARCH')}>연구 기록 살펴보기 <ArrowUpRight size={14} aria-hidden="true" /></button>
    </div>
    <button type="button" className="workspace-shortcut" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}>
      <Keyboard size={16} aria-hidden="true" />키보드 단축키<kbd>?</kbd>
    </button>
  </aside>;
}
