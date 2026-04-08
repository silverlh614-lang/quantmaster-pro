import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Activity } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { TradingChecklist } from '../components/TradingChecklist';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function AutoTradePage() {
  const { shadowTrades, winRate, avgReturn } = useShadowTradeStore();

  // 서버 자동매매 데이터
  const [serverShadowTrades, setServerShadowTrades] = useState<any[]>([]);
  const [serverRecStats, setServerRecStats] = useState<{ month?: string; winRate?: number; avgReturn?: number; strongBuyWinRate?: number; total?: number } | null>(null);

  useEffect(() => {
    const fetchServerData = () => {
      fetch('/api/auto-trade/shadow-trades').then(r => r.json()).then(setServerShadowTrades).catch(() => {});
      fetch('/api/auto-trade/recommendations/stats').then(r => r.json()).then(setServerRecStats).catch(() => {});
    };
    fetchServerData();
    const interval = setInterval(fetchServerData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      key="auto-trade-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-white uppercase tracking-tighter">자동매매 센터</h2>
          <p className="text-xs text-white/30 mt-1">KIS 모의계좌 연동 · Shadow Trading · OCO 자동 등록</p>
        </div>
        <div className="flex gap-3 text-center">
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2">
            <p className="text-[10px] text-white/30 uppercase tracking-widest">Shadow 건수</p>
            <p className="text-xl font-black text-violet-400">{shadowTrades.length}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2">
            <p className="text-[10px] text-white/30 uppercase tracking-widest">적중률</p>
            <p className="text-xl font-black text-green-400">{winRate()}%</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2">
            <p className="text-[10px] text-white/30 uppercase tracking-widest">평균수익</p>
            <p className={cn("text-xl font-black", avgReturn() >= 0 ? "text-green-400" : "text-red-400")}>{avgReturn().toFixed(2)}%</p>
          </div>
        </div>
      </div>

      {/* 서버 자기학습 추천 통계 */}
      {serverRecStats && serverRecStats.total != null && serverRecStats.total > 0 && (
        <div className="p-5 rounded-2xl bg-white/5 border border-white/10">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-black text-white/40 uppercase tracking-widest">서버 자기학습 통계 ({serverRecStats.month})</span>
          </div>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-[10px] text-white/30 uppercase">결산 건수</p>
              <p className="text-lg font-black text-white">{serverRecStats.total}</p>
            </div>
            <div>
              <p className="text-[10px] text-white/30 uppercase">WIN률</p>
              <p className="text-lg font-black text-green-400">{serverRecStats.winRate?.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-[10px] text-white/30 uppercase">평균 수익</p>
              <p className={cn("text-lg font-black", (serverRecStats.avgReturn ?? 0) >= 0 ? "text-green-400" : "text-red-400")}>{serverRecStats.avgReturn?.toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-[10px] text-white/30 uppercase">STRONG_BUY</p>
              <p className="text-lg font-black text-amber-400">{serverRecStats.strongBuyWinRate?.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      )}

      {/* 서버 Shadow Trades (서버 cron 생성분) */}
      {serverShadowTrades.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-black text-white/40 uppercase tracking-widest">서버 자동 Shadow Trades ({serverShadowTrades.length}건)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {serverShadowTrades.slice(0, 10).map((t: any, i: number) => (
              <div key={t.id ?? i} className={cn(
                "p-4 rounded-xl border backdrop-blur-md text-sm",
                t.status === 'HIT_TARGET' ? "bg-green-500/10 border-green-500/20" :
                t.status === 'HIT_STOP' ? "bg-red-500/10 border-red-500/20" :
                "bg-white/5 border-white/10"
              )}>
                <div className="flex justify-between items-center">
                  <span className="font-black text-white">{t.stockName} <span className="text-white/30 text-xs">{t.stockCode}</span></span>
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded",
                    t.status === 'HIT_TARGET' ? "bg-green-500/20 text-green-400" :
                    t.status === 'HIT_STOP' ? "bg-red-500/20 text-red-400" :
                    t.status === 'ACTIVE' ? "bg-violet-500/20 text-violet-400" : "bg-white/10 text-white/40"
                  )}>{t.status}</span>
                </div>
                <div className="flex justify-between mt-2 text-xs text-white/30">
                  <span>진입 {t.shadowEntryPrice?.toLocaleString()}</span>
                  <span>손절 {t.stopLoss?.toLocaleString()}</span>
                  <span>목표 {t.targetPrice?.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <TradingChecklist />

      {/* Shadow Trade 목록 */}
      {shadowTrades.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-black text-white/60 uppercase tracking-widest">Shadow Trades</h3>
            <span className="text-xs text-white/30">{shadowTrades.filter(t => t.status === 'ACTIVE' || t.status === 'PENDING').length}건 진행 중</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {shadowTrades.map(trade => (
              <div
                key={trade.id}
                className={cn(
                  "p-5 rounded-2xl border backdrop-blur-md",
                  trade.status === 'HIT_TARGET' ? "bg-green-500/10 border-green-500/30" :
                  trade.status === 'HIT_STOP' ? "bg-red-500/10 border-red-500/30" :
                  trade.status === 'ACTIVE' ? "bg-violet-500/10 border-violet-500/30" :
                  "bg-white/5 border-white/10"
                )}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white">{trade.stockName}</span>
                    <span className="text-[10px] text-white/40 font-bold">{trade.stockCode}</span>
                  </div>
                  <span className={cn(
                    "text-[10px] font-black uppercase px-2 py-1 rounded-lg",
                    trade.status === 'HIT_TARGET' ? "bg-green-500/20 text-green-400" :
                    trade.status === 'HIT_STOP' ? "bg-red-500/20 text-red-400" :
                    trade.status === 'ACTIVE' ? "bg-violet-500/20 text-violet-400" :
                    "bg-white/10 text-white/40"
                  )}>
                    {trade.status === 'HIT_TARGET' ? 'TARGET HIT' :
                     trade.status === 'HIT_STOP' ? 'STOP HIT' :
                     trade.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[9px] text-white/30 uppercase">진입가</p>
                    <p className="text-sm font-bold text-white">{trade.shadowEntryPrice.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-white/30 uppercase">손절</p>
                    <p className="text-sm font-bold text-red-400">{trade.stopLoss.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-white/30 uppercase">목표</p>
                    <p className="text-sm font-bold text-green-400">{trade.targetPrice.toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                  <span className="text-[10px] text-white/20">{trade.quantity}주 · Kelly {(trade.kellyFraction * 100).toFixed(0)}%</span>
                  {trade.returnPct != null && (
                    <span className={cn("text-sm font-black", trade.returnPct >= 0 ? "text-green-400" : "text-red-400")}>
                      {trade.returnPct >= 0 ? '+' : ''}{trade.returnPct.toFixed(2)}%
                    </span>
                  )}
                  <span className="text-[10px] text-white/20">{new Date(trade.signalTime).toLocaleDateString('ko-KR')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
