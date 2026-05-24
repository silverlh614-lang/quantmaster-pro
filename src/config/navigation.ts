// @responsibility navigation 설정 SSOT
/**
 * Centralized navigation configuration.
 * All sidebar / bottom-nav items and group labels are defined here
 * so that adding, removing or reordering tabs requires only one edit.
 */
import type { ElementType } from 'react';
import {
  Zap, Search, Bookmark, Filter, Radar, Calculator,
  History, Shield, Activity, TrendingUp, Layers, Globe, Trophy, Brain,
  FileText, FileOutput, Stethoscope,
} from 'lucide-react';
import type { View } from '../stores/useSettingsStore';

// ── Types ────────────────────────────────────────────────────────────────

export interface NavItem {
  /** Must match one of the View union members */
  id: View;
  label: string;
  icon: ElementType;
  operatorOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  operatorOnly?: boolean;
}

// ── Full navigation structure (Sidebar) ──────────────────────────────────

export const NAV_GROUPS: NavGroup[] = [
  {
    label: '핵심 운영',
    items: [
      { id: 'MARKET', label: 'Market Gate', icon: Activity },
      { id: 'AUTO_TRADE', label: 'Auto Trade', icon: Zap },
      { id: 'SHADOW_LEARNING', label: 'Shadow Learning', icon: Brain },
    ],
  },
  {
    label: '후보 발굴',
    items: [
      { id: 'DISCOVER', label: 'Candidate Discovery', icon: Search },
      { id: 'WATCHLIST', label: '관심 목록', icon: Bookmark },
      { id: 'SCREENER', label: 'Screener', icon: Filter },
      { id: 'SUBSCRIPTION', label: 'Sector Rotation', icon: Radar },
      { id: 'MANUAL_INPUT', label: 'Manual Quant', icon: Calculator },
    ],
  },
  {
    label: '검증/성과',
    items: [
      { id: 'RECOMMENDATION_HISTORY', label: 'Decision History', icon: Trophy },
      { id: 'TRADE_JOURNAL', label: 'Trade Journal', icon: TrendingUp },
      { id: 'WALK_FORWARD', label: 'Walk Forward', icon: Shield },
      { id: 'BACKTEST', label: 'Backtest', icon: History },
      { id: 'PORTFOLIO_EXTRACT', label: '후보 포트폴리오 구성', icon: Layers },
    ],
  },
  {
    label: '리포트',
    items: [
      { id: 'PUBLIC_REPORT', label: 'Public Report', icon: FileText },
      { id: 'BLOG_EXPORT', label: 'Blog Export', icon: FileOutput },
    ],
  },
  {
    label: '운영자',
    operatorOnly: true,
    items: [
      { id: 'MACRO_INTEL', label: 'Macro Intel', icon: Globe },
      { id: 'DIAGNOSTICS', label: 'Diagnostics', icon: Stethoscope },
      { id: 'LEARNING_SANITY', label: 'Learning Sanity', icon: Activity },
    ],
  },
];

export function isOperatorNavigationEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_QMP_OPERATOR_MODE === 'true';
}

export function getVisibleNavGroups(operatorMode = isOperatorNavigationEnabled()): NavGroup[] {
  return NAV_GROUPS
    .filter(group => operatorMode || !group.operatorOnly)
    .map(group => ({
      ...group,
      items: group.items.filter(item => operatorMode || !item.operatorOnly),
    }))
    .filter(group => group.items.length > 0);
}

// ── Mobile bottom-nav: primary tabs (always visible) ─────────────────────

export const PRIMARY_MOBILE_TABS: NavItem[] = [
  { id: 'AUTO_TRADE', label: '운영', icon: Zap },
  { id: 'DISCOVER', label: '후보', icon: Search },
  { id: 'WATCHLIST', label: '관심', icon: Bookmark },
  { id: 'PUBLIC_REPORT', label: '리포트', icon: FileText },
];

// ── Mobile bottom-nav: "more" menu items ─────────────────────────────────

export const MORE_MOBILE_TABS: NavItem[] = [
  { id: 'MARKET', label: 'Gate', icon: Activity },
  { id: 'SHADOW_LEARNING', label: 'Shadow', icon: Brain },
  { id: 'RECOMMENDATION_HISTORY', label: '판정 이력', icon: Trophy },
  { id: 'BLOG_EXPORT', label: 'Blog Export', icon: FileOutput },
  { id: 'SCREENER', label: '스크리너', icon: Filter },
  { id: 'SUBSCRIPTION', label: '섹터', icon: Radar },
  { id: 'MANUAL_INPUT', label: '수동 퀀트', icon: Calculator },
  { id: 'BACKTEST', label: '백테스트', icon: History },
  { id: 'PORTFOLIO_EXTRACT', label: '추출', icon: Layers },
  { id: 'WALK_FORWARD', label: '워크포워드', icon: Shield },
  { id: 'TRADE_JOURNAL', label: '매매일지', icon: TrendingUp },
];
