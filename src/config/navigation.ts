// @responsibility Navigation SSOT for sidebar/mobile tabs.

import type { ElementType } from 'react';
import {
  Activity,
  BadgeDollarSign,
  Brain,
  Calculator,
  Database,
  FileOutput,
  FileText,
  Filter,
  Globe,
  History,
  Layers,
  Radar,
  ScrollText,
  Search,
  Send,
  Server,
  Shield,
  Stethoscope,
  TrendingUp,
  Trophy,
  Zap,
  Bookmark,
} from 'lucide-react';
import type { View } from '../stores/useSettingsStore';

export interface NavItem {
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

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Core Operations',
    items: [
      { id: 'MARKET', label: 'Market Gate', icon: Activity },
      { id: 'AUTO_TRADE', label: 'Auto Trade', icon: Zap },
      { id: 'SHADOW_LEARNING', label: 'Shadow Learning', icon: Brain },
    ],
  },
  {
    label: 'Candidate Discovery',
    items: [
      { id: 'DISCOVER', label: 'Candidate Discovery', icon: Search },
      { id: 'WATCHLIST', label: 'Watchlist', icon: Bookmark },
      { id: 'SCREENER', label: 'Screener', icon: Filter },
      { id: 'SUBSCRIPTION', label: 'Sector Rotation', icon: Radar },
      { id: 'MANUAL_INPUT', label: 'Manual Quant', icon: Calculator },
    ],
  },
  {
    label: 'Validation',
    items: [
      { id: 'RECOMMENDATION_HISTORY', label: 'Decision History', icon: Trophy },
      { id: 'TRADE_JOURNAL', label: 'Trade Journal', icon: TrendingUp },
      { id: 'WALK_FORWARD', label: 'Walk Forward', icon: Shield },
      { id: 'BACKTEST', label: 'Backtest', icon: History },
      { id: 'PORTFOLIO_EXTRACT', label: 'Candidate Portfolio', icon: Layers },
    ],
  },
  {
    label: 'Report',
    items: [
      { id: 'PUBLIC_REPORT', label: 'Public Report', icon: FileText },
      { id: 'BLOG_EXPORT', label: 'Blog Export', icon: FileOutput },
      { id: 'TELEGRAM_SUMMARY', label: 'Telegram Summary', icon: Send },
      { id: 'PAID_PREVIEW', label: 'Paid Preview', icon: BadgeDollarSign },
    ],
  },
  {
    label: 'Operator',
    operatorOnly: true,
    items: [
      { id: 'MACRO_INTEL', label: 'Macro Intel', icon: Globe },
      { id: 'DIAGNOSTICS', label: 'Diagnostics', icon: Stethoscope },
      { id: 'PROVIDER_HEALTH', label: 'Provider Health', icon: Server },
      { id: 'EXECUTION_TRACE', label: 'Execution Trace', icon: ScrollText },
      { id: 'LEARNING_SANITY', label: 'Learning Diagnostics', icon: Activity },
      { id: 'RAW_SNAPSHOT', label: 'Raw Snapshot', icon: Database },
    ],
  },
];

export function isOperatorNavigationEnabled(settingsShowOperatorDiagnostics = false): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return settingsShowOperatorDiagnostics
    || env?.VITE_QMP_OPERATOR_MODE === 'true'
    || env?.VITE_ENABLE_OPERATOR_UI === 'true';
}

export function getVisibleNavGroups(operatorMode = isOperatorNavigationEnabled()): NavGroup[] {
  return NAV_GROUPS
    .filter((group) => operatorMode || !group.operatorOnly)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => operatorMode || !item.operatorOnly),
    }))
    .filter((group) => group.items.length > 0);
}

export const PRIMARY_MOBILE_TABS: NavItem[] = [
  { id: 'AUTO_TRADE', label: 'Trade', icon: Zap },
  { id: 'DISCOVER', label: 'Candidates', icon: Search },
  { id: 'WATCHLIST', label: 'Watchlist', icon: Bookmark },
  { id: 'PUBLIC_REPORT', label: 'Report', icon: FileText },
];

export const MORE_MOBILE_TABS: NavItem[] = [
  { id: 'MARKET', label: 'Gate', icon: Activity },
  { id: 'SHADOW_LEARNING', label: 'Shadow', icon: Brain },
  { id: 'RECOMMENDATION_HISTORY', label: 'History', icon: Trophy },
  { id: 'BLOG_EXPORT', label: 'Blog Export', icon: FileOutput },
  { id: 'TELEGRAM_SUMMARY', label: 'Telegram', icon: Send },
  { id: 'PAID_PREVIEW', label: 'Paid', icon: BadgeDollarSign },
  { id: 'SCREENER', label: 'Screener', icon: Filter },
  { id: 'SUBSCRIPTION', label: 'Sector', icon: Radar },
  { id: 'MANUAL_INPUT', label: 'Manual', icon: Calculator },
  { id: 'BACKTEST', label: 'Backtest', icon: History },
  { id: 'PORTFOLIO_EXTRACT', label: 'Portfolio', icon: Layers },
  { id: 'WALK_FORWARD', label: 'Walk Forward', icon: Shield },
  { id: 'TRADE_JOURNAL', label: 'Journal', icon: TrendingUp },
];
