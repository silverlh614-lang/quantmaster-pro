// @responsibility Navigation SSOT for sidebar and mobile tabs.

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
    label: '핵심 운영',
    items: [
      { id: 'MARKET', label: '마켓 게이트', icon: Activity },
      { id: 'AUTO_TRADE', label: '자동매매', icon: Zap },
      { id: 'SHADOW_LEARNING', label: '섀도우 러닝', icon: Brain },
    ],
  },
  {
    label: '후보 발굴',
    items: [
      { id: 'DISCOVER', label: '후보 발굴', icon: Search },
      { id: 'WATCHLIST', label: '관심종목', icon: Bookmark },
      { id: 'SCREENER', label: '스크리너', icon: Filter },
      { id: 'SUBSCRIPTION', label: '섹터 로테이션', icon: Radar },
      { id: 'MANUAL_INPUT', label: '수동 퀀트', icon: Calculator },
    ],
  },
  {
    label: '검증',
    items: [
      { id: 'RECOMMENDATION_HISTORY', label: '판단 히스토리', icon: Trophy },
      { id: 'TRADE_JOURNAL', label: '매매 일지', icon: TrendingUp },
      { id: 'WALK_FORWARD', label: '워크 포워드', icon: Shield },
      { id: 'BACKTEST', label: '백테스트', icon: History },
      { id: 'PORTFOLIO_EXTRACT', label: '후보 포트폴리오', icon: Layers },
    ],
  },
  {
    label: '리포트',
    items: [
      { id: 'PUBLIC_REPORT', label: '공개 리포트', icon: FileText },
      { id: 'BLOG_EXPORT', label: '블로그 내보내기', icon: FileOutput },
      { id: 'TELEGRAM_SUMMARY', label: '텔레그램 요약', icon: Send },
      { id: 'PAID_PREVIEW', label: '유료 미리보기', icon: BadgeDollarSign },
    ],
  },
  {
    label: '운영자',
    operatorOnly: true,
    items: [
      { id: 'MACRO_INTEL', label: '매크로 인텔', icon: Globe },
      { id: 'DIAGNOSTICS', label: '진단', icon: Stethoscope },
      { id: 'PROVIDER_HEALTH', label: '공급자 상태', icon: Server },
      { id: 'EXECUTION_TRACE', label: '실행 추적', icon: ScrollText },
      { id: 'LEARNING_SANITY', label: '학습 진단', icon: Activity },
      { id: 'RAW_SNAPSHOT', label: '원본 스냅샷', icon: Database },
    ],
  },
];

function isOperatorNavigationEnabled(settingsShowOperatorDiagnostics = false): boolean {
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
  { id: 'AUTO_TRADE', label: '매매', icon: Zap },
  { id: 'DISCOVER', label: '후보', icon: Search },
  { id: 'WATCHLIST', label: '관심종목', icon: Bookmark },
  { id: 'PUBLIC_REPORT', label: '리포트', icon: FileText },
];

export const MORE_MOBILE_TABS: NavItem[] = [
  { id: 'MARKET', label: '게이트', icon: Activity },
  { id: 'SHADOW_LEARNING', label: '섀도우', icon: Brain },
  { id: 'RECOMMENDATION_HISTORY', label: '히스토리', icon: Trophy },
  { id: 'BLOG_EXPORT', label: '블로그', icon: FileOutput },
  { id: 'TELEGRAM_SUMMARY', label: '텔레그램', icon: Send },
  { id: 'PAID_PREVIEW', label: '유료', icon: BadgeDollarSign },
  { id: 'SCREENER', label: '스크리너', icon: Filter },
  { id: 'SUBSCRIPTION', label: '섹터', icon: Radar },
  { id: 'MANUAL_INPUT', label: '수동', icon: Calculator },
  { id: 'BACKTEST', label: '백테스트', icon: History },
  { id: 'PORTFOLIO_EXTRACT', label: '포트폴리오', icon: Layers },
  { id: 'WALK_FORWARD', label: '워크포워드', icon: Shield },
  { id: 'TRADE_JOURNAL', label: '일지', icon: TrendingUp },
];
