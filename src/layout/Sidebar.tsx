import React from 'react';
import {
  Zap, LayoutGrid, Bookmark, Filter, Radar, Calculator,
  History, Shield, Activity, TrendingUp, ShieldCheck, Settings,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '../ui/cn';
import { useSettingsStore, useRecommendationStore, useTradeStore, useMarketStore } from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import type { TradeRecord } from '../types/quant';

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  count?: number;
}

export function Sidebar() {
  const { view, setView, setShowSettings, setShowMasterChecklist } = useSettingsStore();
  const { watchlist, setSearchQuery, lastUpdated } = useRecommendationStore();
  const { tradeRecords } = useTradeStore();
  const { syncStatus } = useMarketStore();
  const { shadowTrades } = useShadowTradeStore();

  const openTradesCount = tradeRecords.filter((t: TradeRecord) => t.status === 'OPEN').length;

  const navGroups: NavGroup[] = [
    {
      label: '탐색',
      items: [
        { id: 'DISCOVER', label: 'AI 추천', icon: LayoutGrid },
        { id: 'WATCHLIST', label: '관심 목록', icon: Bookmark, count: (watchlist || []).length },
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
        { id: 'WALK_FORWARD', label: '워크포워드', icon: Shield },
        { id: 'MARKET', label: '시장 대시보드', icon: Activity },
      ],
    },
    {
      label: '매매',
      items: [
        { id: 'TRADE_JOURNAL', label: '매매일지', icon: TrendingUp, count: openTradesCount },
        { id: 'AUTO_TRADE', label: '자동매매', icon: Zap, count: shadowTrades.length },
      ],
    },
  ];

  return (
    <aside className="app-sidebar no-scrollbar no-print">
      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-theme-border shrink-0">
        <button
          onClick={() => { setView('DISCOVER' as any); setSearchQuery(''); }}
          className="flex items-center gap-3 group/logo"
        >
          <div className="relative">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25 group-hover/logo:shadow-blue-500/40 transition-all">
              <Zap className="w-5 h-5 text-white" />
            </div>
            {syncStatus.isSyncing && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-[var(--bg-elevated)] animate-pulse" />
            )}
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-black text-theme-text tracking-tight">QuantMaster</span>
            <span className="text-[10px] font-bold text-blue-400">Pro</span>
          </div>
        </button>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 py-4 px-3 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="px-3 mb-2">
              <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-[0.2em]">
                {group.label}
              </span>
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = view === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setView(item.id as any); setSearchQuery(''); }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-bold transition-all group/nav',
                      isActive
                        ? 'bg-blue-500/12 text-blue-400 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)]'
                        : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface'
                    )}
                  >
                    <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-blue-400' : 'text-theme-text-muted group-hover/nav:text-theme-text-secondary')} />
                    <span className="truncate">{item.label}</span>
                    {item.count != null && item.count > 0 && (
                      <span className={cn(
                        'ml-auto text-[10px] font-black px-1.5 py-0.5 rounded-md font-num',
                        isActive
                          ? 'bg-blue-500/20 text-blue-300'
                          : 'bg-theme-surface text-theme-text-muted'
                      )}>
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom Actions */}
      <div className="border-t border-theme-border p-3 space-y-1 shrink-0">
        <button
          onClick={() => setShowMasterChecklist(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-bold text-theme-text-muted hover:text-blue-400 hover:bg-blue-500/[0.06] transition-all"
        >
          <ShieldCheck className="w-4 h-4" />
          <span>체크리스트</span>
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-bold text-theme-text-muted hover:text-theme-text-secondary hover:bg-theme-surface transition-all"
        >
          <Settings className="w-4 h-4" />
          <span>설정</span>
        </button>

        {/* Last Updated */}
        {lastUpdated && (
          <div className="px-3 pt-2 flex flex-col gap-0.5">
            <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-[0.15em]">마지막 업데이트</span>
            <span className="text-[11px] font-bold text-theme-text-secondary font-num">
              {new Date(lastUpdated).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
