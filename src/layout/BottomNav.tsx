import React, { useState, useMemo } from 'react';
import {
  Settings, MoreHorizontal, X, ShieldCheck,
} from 'lucide-react';
import { cn } from '../ui/cn';
import { AnimatePresence, motion } from 'motion/react';
import { useSettingsStore, useRecommendationStore, useTradeStore } from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import { PRIMARY_MOBILE_TABS, MORE_MOBILE_TABS } from '../config';
import type { TradeRecord } from '../types/quant';

export function BottomNav() {
  const [showMore, setShowMore] = useState(false);
  const { view, setView, setShowSettings, setShowMasterChecklist } = useSettingsStore();
  const { watchlist, setSearchQuery } = useRecommendationStore();
  const { tradeRecords } = useTradeStore();
  const { shadowTrades } = useShadowTradeStore();

  const openTradesCount = tradeRecords.filter((t: TradeRecord) => t.status === 'OPEN').length;

  /** Dynamic badge counts merged at render time */
  const countMap: Partial<Record<string, number>> = useMemo(() => ({
    WATCHLIST: (watchlist || []).length,
    TRADE_JOURNAL: openTradesCount,
    AUTO_TRADE: shadowTrades.length,
  }), [watchlist, openTradesCount, shadowTrades.length]);

  const isMoreActive = MORE_MOBILE_TABS.some(item => view === item.id);

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
              <div className="mx-3 mb-2 rounded-2xl border border-white/[0.06] overflow-hidden backdrop-blur-xl" style={{ background: 'rgba(11, 16, 24, 0.92)' }}>
                {/* More Menu Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
                  <span className="text-[11px] font-black text-theme-text-muted uppercase tracking-[0.2em]">더보기</span>
                  <button onClick={() => setShowMore(false)} className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors">
                    <X className="w-4 h-4 text-theme-text-muted" />
                  </button>
                </div>

                {/* Menu Grid */}
                <div className="grid grid-cols-3 gap-1 p-3">
                  {MORE_MOBILE_TABS.map((item) => {
                    const Icon = item.icon;
                    const isActive = view === item.id;
                    const count = countMap[item.id];
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleNavClick(item.id)}
                        className={cn(
                          'flex flex-col items-center gap-2 p-4 rounded-xl transition-all',
                          isActive
                            ? 'bg-blue-500/[0.12] text-blue-300'
                            : 'text-theme-text-secondary hover:bg-white/[0.04]'
                        )}
                      >
                        <div className="relative">
                          <Icon className="w-5 h-5" />
                          {count != null && count > 0 && (
                            <span className="absolute -top-1.5 -right-2 text-[8px] font-black bg-gradient-to-r from-blue-500 to-indigo-500 text-white w-4 h-4 rounded-full flex items-center justify-center font-num">
                              {count}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-bold">{item.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Quick Actions */}
                <div className="border-t border-white/[0.05] p-3 flex gap-2">
                  <button
                    onClick={() => { setShowMasterChecklist(true); setShowMore(false); }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-bold text-theme-text-muted hover:text-blue-300 hover:bg-blue-500/[0.06] transition-all border border-white/[0.06]"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    체크리스트
                  </button>
                  <button
                    onClick={() => { setShowSettings(true); setShowMore(false); }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-bold text-theme-text-muted hover:text-theme-text-secondary hover:bg-white/[0.04] transition-all border border-white/[0.06]"
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
      <nav className="fixed bottom-0 left-0 right-0 z-[57] lg:hidden no-print backdrop-blur-xl" style={{ height: 'var(--bottom-nav-height)', background: 'rgba(6, 9, 13, 0.85)' }}>
        <div className="border-t border-white/[0.05] h-full flex items-stretch relative">
          {PRIMARY_MOBILE_TABS.map((item) => {
            const Icon = item.icon;
            const isActive = view === item.id;
            const count = countMap[item.id];
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-1 transition-all relative',
                  isActive ? 'text-blue-400' : 'text-theme-text-muted'
                )}
              >
                {isActive && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-gradient-to-r from-blue-400 to-indigo-500" />
                )}
                <div className="relative">
                  <Icon className={cn('w-5 h-5 transition-transform', isActive && 'scale-110')} />
                  {count != null && count > 0 && (
                    <span className="absolute -top-1 -right-2 text-[7px] font-black bg-gradient-to-r from-blue-500 to-indigo-500 text-white w-3.5 h-3.5 rounded-full flex items-center justify-center font-num">
                      {count > 9 ? '9+' : count}
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
              'flex-1 flex flex-col items-center justify-center gap-1 transition-all relative',
              showMore || isMoreActive ? 'text-blue-400' : 'text-theme-text-muted'
            )}
          >
            {isMoreActive && !showMore && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-gradient-to-r from-blue-400 to-indigo-500" />
            )}
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-bold">더보기</span>
          </button>
        </div>
      </nav>
    </>
  );
}
