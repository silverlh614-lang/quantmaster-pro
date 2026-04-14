import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Activity, Eye, Briefcase } from 'lucide-react';
import { cn } from '../ui/cn';
import { PageHeader } from '../ui/page-header';
import { KpiStrip } from '../ui/kpi-strip';
import { Card } from '../ui/card';
import { Section } from '../ui/section';
import { Badge } from '../ui/badge';
import { Stack } from '../layout/Stack';
import { PageGrid } from '../layout/PageGrid';
import { TradingChecklist } from '../components/TradingChecklist';
import { useShadowTradeStore, useShadowWinRate, useShadowAvgReturn } from '../stores/useShadowTradeStore';

interface WatchlistEntry {
  code: string;
  name: string;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  addedAt: string;
  gateScore?: number;
  addedBy: 'AUTO' | 'MANUAL';
  isFocus?: boolean;
  rrr?: number;
  sector?: string;
}

interface KisHolding {
  pdno: string;       // 종목코드
  prdt_name: string;  // 종목명
  hldg_qty: string;   // 보유수량
  pchs_avg_pric: string; // 매입평균가격
  prpr: string;          // 현재가
  evlu_pfls_rt: string;  // 평가손익율
  evlu_pfls_amt: string; // 평가손익금액
}

export function AutoTradePage() {
  const { shadowTrades } = useShadowTradeStore();
  const winRate = useShadowWinRate();
  const avgReturn = useShadowAvgReturn();

  const [serverShadowTrades, setServerShadowTrades] = useState<any[]>([]);
  const [serverRecStats, setServerRecStats] = useState<{ month?: string; winRate?: number; avgReturn?: number; strongBuyWinRate?: number; total?: number } | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [holdings, setHoldings] = useState<KisHolding[]>([]);
  const [portfolioTab, setPortfolioTab] = useState<'watchlist' | 'holdings'>('watchlist');

  useEffect(() => {
    const fetchServerData = () => {
      fetch('/api/auto-trade/shadow-trades').then(r => r.json()).then(setServerShadowTrades).catch((err) => console.error('[ERROR] Shadow trades 조회 실패:', err));
      fetch('/api/auto-trade/recommendations/stats').then(r => r.json()).then(setServerRecStats).catch((err) => console.error('[ERROR] Recommendation stats 조회 실패:', err));
      fetch('/api/auto-trade/watchlist').then(r => r.json()).then(setWatchlist).catch((err) => console.error('[ERROR] 워치리스트 조회 실패:', err));
      fetch('/api/kis/holdings').then(r => r.json()).then((data) => {
        if (Array.isArray(data)) setHoldings(data);
      }).catch((err) => console.error('[ERROR] 보유종목 조회 실패:', err));
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
    >
      <Stack gap="lg">
        <PageHeader
          title="자동매매 센터"
          subtitle="KIS 모의계좌 연동 · Shadow Trading · OCO 자동 등록"
          accentColor="bg-violet-500"
        />

        {/* KPI Strip */}
        <KpiStrip items={[
          { label: 'Shadow 건수', value: shadowTrades.length, trend: 'neutral' },
          { label: '적중률', value: `${winRate}%`, trend: winRate >= 50 ? 'up' : 'down' },
          { label: '평균수익', value: `${avgReturn.toFixed(2)}%`, trend: avgReturn >= 0 ? 'up' : 'down' },
        ]} />

        {/* Watchlist & Holdings Panel */}
        <Card padding="md">
          {/* Tab Header */}
          <div className="flex items-center gap-4 mb-4 border-b border-theme-border/40 pb-3">
            <button
              onClick={() => setPortfolioTab('watchlist')}
              className={cn(
                'flex items-center gap-1.5 text-sm font-bold pb-1 border-b-2 transition-colors',
                portfolioTab === 'watchlist'
                  ? 'border-violet-400 text-violet-300'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text'
              )}
            >
              <Eye className="w-4 h-4" />
              워치리스트 <span className="text-xs opacity-70">({watchlist.length})</span>
            </button>
            <button
              onClick={() => setPortfolioTab('holdings')}
              className={cn(
                'flex items-center gap-1.5 text-sm font-bold pb-1 border-b-2 transition-colors',
                portfolioTab === 'holdings'
                  ? 'border-amber-400 text-amber-300'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text'
              )}
            >
              <Briefcase className="w-4 h-4" />
              보유종목 <span className="text-xs opacity-70">({holdings.length})</span>
            </button>
          </div>

          {portfolioTab === 'watchlist' && (
            <>
              {watchlist.length === 0 ? (
                <p className="text-micro text-center py-6">워치리스트가 비어 있습니다.</p>
              ) : (
                <div className="space-y-2">
                  {watchlist.map((w) => (
                    <div key={w.code} className="flex items-center justify-between gap-3 py-2 border-b border-theme-border/20 last:border-0">
                      <div className="min-w-0">
                        <span className="text-sm font-bold text-theme-text truncate">{w.name}</span>
                        <span className="text-micro ml-2">{w.code}</span>
                        {w.isFocus && (
                          <Badge variant="violet" size="sm" className="ml-2">FOCUS</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs shrink-0">
                        {w.gateScore != null && (
                          <span className="text-theme-text-muted">G{w.gateScore}</span>
                        )}
                        <span className="text-theme-text-muted">{w.entryPrice.toLocaleString()}</span>
                        <Badge variant={w.addedBy === 'AUTO' ? 'success' : 'default'} size="sm">
                          {w.addedBy}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {portfolioTab === 'holdings' && (
            <>
              {holdings.length === 0 ? (
                <p className="text-micro text-center py-6">보유 중인 종목이 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {holdings.map((h) => {
                    const pfRate = parseFloat(h.evlu_pfls_rt ?? '0');
                    return (
                      <div key={h.pdno} className="flex items-center justify-between gap-3 py-2 border-b border-theme-border/20 last:border-0">
                        <div className="min-w-0">
                          <span className="text-sm font-bold text-theme-text truncate">{h.prdt_name}</span>
                          <span className="text-micro ml-2">{h.pdno}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs shrink-0">
                          <span className="text-theme-text-muted">{Number(h.hldg_qty).toLocaleString()}주</span>
                          <span className="text-theme-text-muted">평단 {Number(h.pchs_avg_pric).toLocaleString()}</span>
                          <span className={cn('font-bold', pfRate >= 0 ? 'text-green-400' : 'text-red-400')}>
                            {pfRate >= 0 ? '+' : ''}{pfRate.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Card>

        {/* Server Learning Stats */}
        {serverRecStats && serverRecStats.total != null && serverRecStats.total > 0 && (
          <Card padding="md">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-amber-400" />
              <span className="text-micro">서버 자기학습 통계 ({serverRecStats.month})</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 text-center">
              <div>
                <p className="text-micro">결산 건수</p>
                <p className="text-lg font-black text-theme-text mt-1">{serverRecStats.total}</p>
              </div>
              <div>
                <p className="text-micro">WIN률</p>
                <p className="text-lg font-black text-green-400 mt-1">{serverRecStats.winRate?.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-micro">평균 수익</p>
                <p className={cn('text-lg font-black mt-1', (serverRecStats.avgReturn ?? 0) >= 0 ? 'text-green-400' : 'text-red-400')}>{serverRecStats.avgReturn?.toFixed(2)}%</p>
              </div>
              <div>
                <p className="text-micro">STRONG_BUY</p>
                <p className="text-lg font-black text-amber-400 mt-1">{serverRecStats.strongBuyWinRate?.toFixed(1)}%</p>
              </div>
            </div>
          </Card>
        )}

        {/* Server Shadow Trades (중복 제거: 서버에 동기화된 클라이언트 trades 포함) */}
        {serverShadowTrades.length > 0 && (
          <Section title={`서버 Shadow Trades`} subtitle={`${serverShadowTrades.length}건`}>
            <PageGrid columns="2" gap="sm">
              {serverShadowTrades.slice(0, 10).map((t: any, i: number) => (
                <Card
                  key={t.id ?? i}
                  padding="sm"
                  className={cn(
                    'text-sm',
                    t.status === 'HIT_TARGET' ? '!border-green-500/20 !bg-green-500/5' :
                    t.status === 'HIT_STOP' ? '!border-red-500/20 !bg-red-500/5' : ''
                  )}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-black text-theme-text">{t.stockName} <span className="text-theme-text-muted text-xs">{t.stockCode}</span></span>
                    <Badge variant={t.status === 'HIT_TARGET' ? 'success' : t.status === 'HIT_STOP' ? 'danger' : t.status === 'ACTIVE' ? 'violet' : 'default'} size="sm">
                      {t.status}
                    </Badge>
                  </div>
                  <div className="flex justify-between mt-2 text-xs text-theme-text-muted">
                    <span>진입 {t.shadowEntryPrice?.toLocaleString()}</span>
                    <span>손절 {t.stopLoss?.toLocaleString()}</span>
                    <span>목표 {t.targetPrice?.toLocaleString()}</span>
                  </div>
                </Card>
              ))}
            </PageGrid>
          </Section>
        )}

        <TradingChecklist />

        {/* Local Shadow Trades (서버에 이미 동기화된 항목은 제외) */}
        {(() => {
          const serverIds = new Set(serverShadowTrades.map((t: any) => t.id));
          const localOnly = shadowTrades.filter(t => !serverIds.has(t.id));
          return localOnly.length > 0 && (
          <Section
            title="로컬 Shadow Trades"
            actions={<span className="text-xs text-theme-text-muted">{localOnly.filter(t => t.status === 'ACTIVE' || t.status === 'PENDING').length}건 진행 중</span>}
          >
            <PageGrid columns="2" gap="sm">
              {localOnly.map(trade => (
                <Card
                  key={trade.id}
                  padding="md"
                  className={cn(
                    trade.status === 'HIT_TARGET' ? '!border-green-500/25 !bg-green-500/5' :
                    trade.status === 'HIT_STOP' ? '!border-red-500/25 !bg-red-500/5' :
                    trade.status === 'ACTIVE' ? '!border-violet-500/25 !bg-violet-500/5' : ''
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-black text-theme-text truncate">{trade.stockName}</span>
                      <span className="text-micro">{trade.stockCode}</span>
                    </div>
                    <Badge
                      variant={trade.status === 'HIT_TARGET' ? 'success' : trade.status === 'HIT_STOP' ? 'danger' : trade.status === 'ACTIVE' ? 'violet' : 'default'}
                    >
                      {trade.status === 'HIT_TARGET' ? 'TARGET HIT' :
                       trade.status === 'HIT_STOP' ? 'STOP HIT' :
                       trade.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-micro">진입가</p>
                      <p className="text-sm font-bold text-theme-text mt-0.5">{trade.shadowEntryPrice.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-micro">손절</p>
                      <p className="text-sm font-bold text-red-400 mt-0.5">{trade.stopLoss.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-micro">목표</p>
                      <p className="text-sm font-bold text-green-400 mt-0.5">{trade.targetPrice.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-theme-border/50">
                    <span className="text-micro">{trade.quantity}주 · Kelly {(trade.kellyFraction * 100).toFixed(0)}%</span>
                    {trade.returnPct != null && (
                      <span className={cn('text-sm font-black', trade.returnPct >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {trade.returnPct >= 0 ? '+' : ''}{trade.returnPct.toFixed(2)}%
                      </span>
                    )}
                    <span className="text-micro">{new Date(trade.signalTime).toLocaleDateString('ko-KR')}</span>
                  </div>
                </Card>
              ))}
            </PageGrid>
          </Section>
          );
        })()}
      </Stack>
    </motion.div>
  );
}
