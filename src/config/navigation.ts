/**
 * Centralized navigation configuration.
 * All sidebar / bottom-nav items and group labels are defined here
 * so that adding, removing or reordering tabs requires only one edit.
 */
import type { ElementType } from 'react';
import {
  Zap, LayoutGrid, Bookmark, Filter, Radar, Calculator,
  History, Shield, Activity, TrendingUp, Layers,
} from 'lucide-react';
import type { View } from '../stores/useSettingsStore';

// ── Types ────────────────────────────────────────────────────────────────

export interface NavItem {
  /** Must match one of the View union members */
  id: View;
  label: string;
  icon: ElementType;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// ── Full navigation structure (Sidebar) ──────────────────────────────────

export const NAV_GROUPS: NavGroup[] = [
  {
    label: '탐색',
    items: [
      { id: 'DISCOVER', label: 'AI 추천', icon: LayoutGrid },
      { id: 'WATCHLIST', label: '관심 목록', icon: Bookmark },
    ],
  },
  {
    label: '분석',
    items: [
      { id: 'SCREENER', label: '스크리너', icon: Filter },
      { id: 'SUBSCRIPTION', label: '섹터 구독', icon: Radar },
      { id: 'MANUAL_INPUT', label: '수동 퀀트', icon: Calculator },
    ],
  },
  {
    label: '전략',
    items: [
      { id: 'BACKTEST', label: '백테스트', icon: History },
      { id: 'PORTFOLIO_EXTRACT', label: '포트폴리오 추출', icon: Layers },
      { id: 'WALK_FORWARD', label: '워크포워드', icon: Shield },
      { id: 'MARKET', label: '시장 대시보드', icon: Activity },
    ],
  },
  {
    label: '매매',
    items: [
      { id: 'TRADE_JOURNAL', label: '매매일지', icon: TrendingUp },
      { id: 'AUTO_TRADE', label: '자동매매', icon: Zap },
    ],
  },
];

// ── Mobile bottom-nav: primary tabs (always visible) ─────────────────────

export const PRIMARY_MOBILE_TABS: NavItem[] = [
  { id: 'DISCOVER', label: '탐색', icon: LayoutGrid },
  { id: 'WATCHLIST', label: '관심', icon: Bookmark },
  { id: 'TRADE_JOURNAL', label: '매매', icon: TrendingUp },
  { id: 'MARKET', label: '시장', icon: Activity },
];

// ── Mobile bottom-nav: "more" menu items ─────────────────────────────────

export const MORE_MOBILE_TABS: NavItem[] = [
  { id: 'SCREENER', label: '스크리너', icon: Filter },
  { id: 'SUBSCRIPTION', label: '섹터 구독', icon: Radar },
  { id: 'MANUAL_INPUT', label: '수동 퀀트', icon: Calculator },
  { id: 'BACKTEST', label: '백테스트', icon: History },
  { id: 'PORTFOLIO_EXTRACT', label: '추출', icon: Layers },
  { id: 'WALK_FORWARD', label: '워크포워드', icon: Shield },
  { id: 'AUTO_TRADE', label: '자동매매', icon: Zap },
];
