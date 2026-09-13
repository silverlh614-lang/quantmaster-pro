// @responsibility Render desktop workspace navigation.
import React from 'react';
import { ArrowUpRight, ChartNoAxesCombined, Keyboard } from 'lucide-react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { NAV_GROUPS, resolveWorkspaceView } from '../config/navigation';

export function Sidebar({ asDrawer = false }: { asDrawer?: boolean } = {}) {
  const view = useSettingsStore(state => state.view);
  const setView = useSettingsStore(state => state.setView);
  return <aside className={`workspace-sidebar no-print ${asDrawer ? 'app-sidebar-drawer' : 'app-sidebar'}`}>
    <button type="button" className="workspace-brand" onClick={() => setView('DASHBOARD')} aria-label="운영 현황 홈">
      <span className="workspace-brand-mark"><ChartNoAxesCombined size={21} /></span>
      <span>QuantMaster<small>RESEARCH WORKSPACE</small></span>
    </button>
    <nav aria-label="주 메뉴" className="workspace-menu">
      <p className="workspace-eyebrow">워크스페이스</p>
      {NAV_GROUPS[0].items.map(({ id, label, icon: Icon }, index) => <button type="button" key={id}
        aria-current={resolveWorkspaceView(view) === id ? 'page' : undefined}
        onClick={() => setView(id)}><Icon size={18} /><span>{label}</span><small>0{index + 1}</small></button>)}
    </nav>
    <div className="workspace-sidebar-note"><span className="workspace-eyebrow">관측에서 검증까지</span>
      <p>기록을 쌓고,<br />근거로 전략을 다듬습니다.</p>
      <button type="button" onClick={() => setView('PAPER_RESEARCH')}>연구 결과 보기 <ArrowUpRight size={15} /></button>
    </div>
    <button type="button" className="workspace-shortcut" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}>
      <Keyboard size={16} />단축키<kbd>?</kbd>
    </button>
  </aside>;
}
