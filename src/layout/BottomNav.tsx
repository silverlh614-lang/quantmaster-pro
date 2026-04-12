import React, { useState } from 'react';
import {
  Zap, LayoutGrid, Bookmark, Filter, Radar, Calculator,
  History, Shield, Activity, TrendingUp, Settings, MoreHorizontal,
  X, ShieldCheck,
} from 'lucide-react';
import { cn } from '../ui/cn';
import { AnimatePresence, motion } from 'motion/react';
import { useSettingsStore, useRecommendationStore, useTradeStore } from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import type { TradeRecord } from '../types/quant';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  count?: number;
}

export function BottomNav() {
  const [showMore, setShowMore] = useState(false);
  const { view, setView, setShowSettings, setShowMasterChecklist } = useSettingsStore();
  const { watchlist, setSearchQuery } = useRecommendationStore();
  const { tradeRecords } = useTradeStore();
  const { shadowTrades } = useShadowTradeStore();

  const openTradesCount = tradeRecords.filter((t: TradeRecord) => t.status === 'OPEN').length;

  // Primary 4 tabs (always visible)
  const primaryTabs: NavItem[] = [
    { id: 'DISCOVER', label: '탐색', icon: LayoutGrid },
    { id: 'WATCHLIST', label: '관심', icon: Bookmark, count: (watchlist || []).length },
    { id: 'TRADE_JOURNAL', label: '매매', icon: TrendingUp, count: openTradesCount },
    { id: 'MARKET', label: '시장', icon: Activity },
  ];

  // More menu items
  const moreItems: NavItem[] = [
    { id: 'SCREENER', label: '스크리너', icon: Filter },
    { id: 'SUBSCRIPTION', label: '섹터 구독', icon: Radar },
    { id: 'MANUAL_INPUT', label: '수동 퀀트', icon: Calculator },
    { id: 'BACKTEST', label: '백테스트', icon: History },
    { id: 'WALK_FORWARD', label: '워크포워드', icon: Shield },
    { id: 'AUTO_TRADE', label: '자동매매', icon: Zap, count: shadowTrades.length },
  ];

  const isMoreActive = moreItems.some(item => view === item.id);

  const handleNavClick = (id: string) => {
    setView(id as any);
    setSearchQuery('');
    setShowMore(false);
  };

  return (
    <>
      {/* More Menu Overlay */}
      <AnimatePresence>
        {showMore && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMore(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[58] lg:hidden"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-[var(--bottom-nav-height)] left-0 right-0 z-[59] lg:hidden"
            >
              <div className="mx-3 mb-2 rounded-2xl border border-theme-border overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                {/* More Menu Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-theme-border">
                  <span className="text-[11px] font-black text-theme-text-muted uppercase tracking-[0.2em]">더보기</span>
                  <button onClick={() => setShowMore(false)} className="p-1.5 rounded-lg hover:bg-theme-surface transition-colors">
                    <X className="w-4 h-4 text-theme-text-muted" />
                  </button>
                </div>

                {/* Menu Grid */}
                <div className="grid grid-cols-3 gap-1 p-3">
                  {moreItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = view === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleNavClick(item.id)}
                        className={cn(
                          'flex flex-col items-center gap-2 p-4 rounded-xl transition-all',
                          isActive
                            ? 'bg-orange-500/15 text-orange-400'
                            : 'text-theme-text-secondary hover:bg-theme-surface'
                        )}
                      >
                        <div className="relative">
                          <Icon className="w-5 h-5" />
                          {item.count != null && item.count > 0 && (
                            <span className="absolute -top-1.5 -right-2 text-[8px] font-black bg-orange-500 text-white w-4 h-4 rounded-full flex items-center justify-center font-num">
                              {item.count}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-bold">{item.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Quick Actions */}
                <div className="border-t border-theme-border p-3 flex gap-2">
                  <button
                    onClick={() => { setShowMasterChecklist(true); setShowMore(false); }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-bold text-theme-text-muted hover:text-orange-400 hover:bg-orange-500/[0.06] transition-all border border-theme-border"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    체크리스트
                  </button>
                  <button
                    onClick={() => { setShowSettings(true); setShowMore(false); }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-bold text-theme-text-muted hover:text-theme-text-secondary hover:bg-theme-surface transition-all border border-theme-border"
                  >
                    <Settings className="w-4 h-4" />
                    설정
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-[57] lg:hidden no-print" style={{ height: 'var(--bottom-nav-height)', background: 'var(--bg-elevated)' }}>
        <div className="border-t border-theme-border h-full flex items-stretch">
          {primaryTabs.map((item) => {
            const Icon = item.icon;
            const isActive = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-1 transition-colors relative',
                  isActive ? 'text-orange-400' : 'text-theme-text-muted'
                )}
              >
                {isActive && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-orange-400" />
                )}
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {item.count != null && item.count > 0 && (
                    <span className="absolute -top-1 -right-2 text-[7px] font-black bg-orange-500 text-white w-3.5 h-3.5 rounded-full flex items-center justify-center font-num">
                      {item.count > 9 ? '9+' : item.count}
                    </span>
                  )}
                </div>
                <span className={cn('text-[10px] font-bold', isActive ? 'font-black' : '')}>{item.label}</span>
              </button>
            );
          })}

          {/* More Button */}
          <button
            onClick={() => setShowMore(prev => !prev)}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1 transition-colors relative',
              showMore || isMoreActive ? 'text-orange-400' : 'text-theme-text-muted'
            )}
          >
            {isMoreActive && !showMore && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-orange-400" />
            )}
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-bold">더보기</span>
          </button>
        </div>
      </nav>
    </>
  );
}
