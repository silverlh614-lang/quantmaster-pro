import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Activity } from 'lucide-react';
import { cn } from '../ui/cn';
import { PageHeader } from '../ui/page-header';
import { KpiStrip } from '../ui/kpi-strip';
import { Card } from '../ui/card';
import { Section } from '../ui/section';
import { Badge } from '../ui/badge';
import { Stack } from '../layout/Stack';
import { PageGrid } from '../layout/PageGrid';
import { TradingChecklist } from '../components/TradingChecklist';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';

export function AutoTradePage() {
  const { shadowTrades, winRate, avgReturn } = useShadowTradeStore();

  const [serverShadowTrades, setServerShadowTrades] = useState<any[]>([]);
  const [serverRecStats, setServerRecStats] = useState<{ month?: string; winRate?: number; avgReturn?: number; strongBuyWinRate?: number; total?: number } | null>(null);

  useEffect(() => {
    const fetchServerData = () => {
      fetch('/api/auto-trade/shadow-trades').then(r => r.json()).then(setServerShadowTrades).catch((err) => console.error('[ERROR] Shadow trades 조회 실패:', err));
      fetch('/api/auto-trade/recommendations/stats').then(r => r.json()).then(setServerRecStats).catch((err) => console.error('[ERROR] Recommendation stats 조회 실패:', err));
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
          { label: '적중률', value: `${winRate()}%`, trend: winRate() >= 50 ? 'up' : 'down' },
          { label: '평균수익', value: `${avgReturn().toFixed(2)}%`, trend: avgReturn() >= 0 ? 'up' : 'down' },
        ]} />

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

        {/* Server Shadow Trades */}
        {serverShadowTrades.length > 0 && (
          <Section title={`서버 자동 Shadow Trades`} subtitle={`${serverShadowTrades.length}건`}>
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

        {/* Local Shadow Trades */}
        {shadowTrades.length > 0 && (
          <Section
            title="Shadow Trades"
            actions={<span className="text-xs text-theme-text-muted">{shadowTrades.filter(t => t.status === 'ACTIVE' || t.status === 'PENDING').length}건 진행 중</span>}
          >
            <PageGrid columns="2" gap="sm">
              {shadowTrades.map(trade => (
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
        )}
      </Stack>
    </motion.div>
  );
}
