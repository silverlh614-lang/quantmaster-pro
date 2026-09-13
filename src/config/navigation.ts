// @responsibility Define workspace navigation.
import type { ElementType } from 'react';
import { LayoutDashboard, Radar, Route, FlaskConical, Settings2 } from 'lucide-react';
import type { View } from '../stores/useSettingsStore';

export interface NavItem { id: View; label: string; icon: ElementType; operatorOnly?: boolean }
export interface NavGroup { label: string; items: NavItem[]; operatorOnly?: boolean }
export const NAV_GROUPS: NavGroup[] = [{
  label: 'Shadow 워크스페이스',
  items: [
    { id: 'DASHBOARD', label: '운영 현황', icon: LayoutDashboard },
    { id: 'PAPER_OBSERVATIONS', label: '기본 관측', icon: Radar },
    { id: 'PAPER_STRATEGY', label: '전략 판단', icon: Route },
    { id: 'PAPER_RESEARCH', label: '저장 자료 연구', icon: FlaskConical },
    { id: 'OPERATIONS', label: '운영 설정', icon: Settings2 },
  ],
}];
export function getVisibleNavGroups(_operatorMode = false): NavGroup[] { return NAV_GROUPS; }
export const PRIMARY_MOBILE_TABS = NAV_GROUPS[0].items;
export const MORE_MOBILE_TABS: NavItem[] = [];

/** Old browser history has a destination without mounting retired page effects. */
export function resolveWorkspaceView(view: View): View {
  if (PRIMARY_MOBILE_TABS.some(item => item.id === view)) return view;
  if (view === 'AUTO_TRADE' || view === 'TRADE_JOURNAL') return 'PAPER_STRATEGY';
  if (view === 'SHADOW_LEARNING' || view === 'BACKTEST' || view === 'WALK_FORWARD') return 'PAPER_RESEARCH';
  return 'DASHBOARD';
}
