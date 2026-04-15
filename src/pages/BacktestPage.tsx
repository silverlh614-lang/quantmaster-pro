import React, { useRef, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, ShieldCheck, ShieldAlert, Play, RefreshCw,
  Settings, History, Info, Plus, Trash2, GripVertical, Zap, Activity,
  Target, BarChart3, ArrowUpRight, ArrowDownRight, XCircle, Copy,
  AlertTriangle, Lightbulb, Sparkles, Layers, ArrowRightLeft,
  Calendar as CalendarIcon, Wallet, Clock, Percent
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';
import { cn } from '../ui/cn';
import { PageHeader } from '../ui/page-header';
import { Card, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Section } from '../ui/section';
import { Badge } from '../ui/badge';
import { EmptyState } from '../ui/empty-state';
import { KpiStrip } from '../ui/kpi-strip';
import { Stack } from '../layout/Stack';
import { PageGrid } from '../layout/PageGrid';
import { PortfolioManager } from '../components/portfolio/PortfolioManager';
import { PortfolioPieChart } from '../components/portfolio/PortfolioPieChart';
import { useMarketStore, usePortfolioStore } from '../stores';

interface BacktestPageProps {
  onRunBacktest: () => Promise<void>;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFromBacktest: (code: string) => void;
  onUpdateWeight: (code: string, weight: number) => void;
  onReorderPortfolioItems: (newItems: { name: string; code: string; weight: number }[]) => void;
  onApplyAIRecommendedWeights: () => void;
  onSelectPortfolio: (id: string) => void;
  onSavePortfolio: (name: string, description?: string) => void;
  onDeletePortfolio: (id: string) => void;
  onUpdatePortfolio: (id: string, name: string, description?: string) => void;
  onCopy: (name: string, code: string) => void;
  copiedCode: string | null;
}

export function BacktestPage({
  onRunBacktest, onFileUpload, onRemoveFromBacktest, onUpdateWeight,
  onReorderPortfolioItems, onApplyAIRecommendedWeights,
  onSelectPortfolio, onSavePortfolio, onDeletePortfolio, onUpdatePortfolio,
  onCopy, copiedCode
}: BacktestPageProps) {
  const {
    backtestPortfolioItems, backtestResult, backtesting,
    initialEquity, setInitialEquity, backtestYears, setBacktestYears,
    commissionFee, setCommissionFee, parsingFile
  } = useMarketStore();
  const { portfolios, currentPortfolioId } = usePortfolioStore();

  const totalWeight = (backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0);

  // Auto-focus refs for large input cards
  const equityInputRef = useRef<HTMLInputElement>(null);
  const yearsInputRef = useRef<HTMLInputElement>(null);
  const feeInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((nextRef: React.RefObject<HTMLInputElement | null>) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      nextRef.current?.focus();
      nextRef.current?.select();
    }
  }, []);

  // Display helpers
  const equityInManWon = Math.round(initialEquity / 10000);
  const formatManWon = (v: number) => v.toLocaleString('ko-KR');

  return (
    <motion.div
      key="backtest-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Stack gap="xl">
        {/* Header */}
        <PageHeader
          title="AI Portfolio Backtest"
          subtitle="포트폴리오 백테스트 시뮬레이터"
          accentColor="bg-blue-500"
        >
          사용자 정의 포트폴리오의 과거 성과를 AI로 시뮬레이션하고, 위험 지표 분석 및 최적화 전략을 제안받으세요.
        </PageHeader>

        {/* ═══════════════════════════════════════════════════════════════════
            QUANTUS-STYLE LARGE INPUT CARDS — Settings
            ═══════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
          {/* Card 1: Initial Equity (만원) */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <Card padding="lg" className="relative group hover:border-blue-500/30 transition-all">
              <div className="flex items-center gap-3 mb-4 sm:mb-6">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-500/15 flex items-center justify-center">
                  <Wallet className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" />
                </div>
                <div>
                  <span className="text-micro block">초기투자금액</span>
                  <span className="text-[10px] font-bold text-theme-text-muted">Initial Equity</span>
                </div>
              </div>
              <div className="relative">
                <input
                  ref={equityInputRef}
                  type="number"
                  value={equityInManWon}
                  onChange={(e) => setInitialEquity((parseInt(e.target.value) || 0) * 10000)}
                  onKeyDown={handleKeyDown(yearsInputRef)}
                  className="w-full bg-transparent border-b-2 border-theme-border focus:border-blue-500 pb-2 text-2xl sm:text-3xl lg:text-4xl font-black text-theme-text text-right pr-16 sm:pr-20 focus:outline-none transition-colors font-mono tabular-nums tracking-tighter"
                />
                <span className="absolute right-0 bottom-2 text-lg sm:text-xl font-black text-blue-400">만원</span>
              </div>
              <p className="text-[10px] text-theme-text-muted font-bold mt-3 text-right">
                = {(initialEquity).toLocaleString('ko-KR')}원
              </p>
            </Card>
          </motion.div>

          {/* Card 2: Period (년) */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card padding="lg" className="relative group hover:border-green-500/30 transition-all">
              <div className="flex items-center gap-3 mb-4 sm:mb-6">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-green-500/15 flex items-center justify-center">
                  <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-green-400" />
                </div>
                <div>
                  <span className="text-micro block">백테스트 기간</span>
                  <span className="text-[10px] font-bold text-theme-text-muted">Backtest Period</span>
                </div>
              </div>
              <div className="relative">
                <input
                  ref={yearsInputRef}
                  type="number"
                  min={1}
                  max={10}
                  value={backtestYears}
                  onChange={(e) => setBacktestYears(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  onKeyDown={handleKeyDown(feeInputRef)}
                  className="w-full bg-transparent border-b-2 border-theme-border focus:border-green-500 pb-2 text-2xl sm:text-3xl lg:text-4xl font-black text-theme-text text-right pr-10 sm:pr-12 focus:outline-none transition-colors font-mono tabular-nums tracking-tighter"
                />
                <span className="absolute right-0 bottom-2 text-lg sm:text-xl font-black text-green-400">년</span>
              </div>
              {/* Quick select buttons */}
              <div className="flex gap-2 mt-4">
                {[1, 3, 5].map((y) => (
                  <button
                    key={y}
                    onClick={() => { setBacktestYears(y); feeInputRef.current?.focus(); }}
                    className={cn(
                      'flex-1 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all border',
                      backtestYears === y
                        ? 'bg-green-500/15 border-green-500/40 text-green-400 shadow-[0_0_12px_rgba(34,197,94,0.12)]'
                        : 'bg-white/5 border-theme-border text-theme-text-muted hover:bg-white/10'
                    )}
                  >
                    {y}년
                  </button>
                ))}
              </div>
            </Card>
          </motion.div>

          {/* Card 3: Commission Fee (%) */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <Card padding="lg" className="relative group hover:border-orange-500/30 transition-all">
              <div className="flex items-center gap-3 mb-4 sm:mb-6">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-orange-500/15 flex items-center justify-center">
                  <Percent className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400" />
                </div>
                <div>
                  <span className="text-micro block">거래수수료</span>
                  <span className="text-[10px] font-bold text-theme-text-muted">Commission Fee</span>
                </div>
              </div>
              <div className="relative">
                <input
                  ref={feeInputRef}
                  type="number"
                  step="0.01"
                  min={0}
                  max={5}
                  value={commissionFee}
                  onChange={(e) => setCommissionFee(parseFloat(e.target.value) || 0)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  className="w-full bg-transparent border-b-2 border-theme-border focus:border-orange-500 pb-2 text-2xl sm:text-3xl lg:text-4xl font-black text-theme-text text-right pr-8 sm:pr-10 focus:outline-none transition-colors font-mono tabular-nums tracking-tighter"
                />
                <span className="absolute right-0 bottom-2 text-lg sm:text-xl font-black text-orange-400">%</span>
              </div>
              {/* Quick select buttons */}
              <div className="flex gap-2 mt-4">
                {[0.015, 0.05, 0.1].map((f) => (
                  <button
                    key={f}
                    onClick={() => setCommissionFee(f)}
                    className={cn(
                      'flex-1 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all border',
                      commissionFee === f
                        ? 'bg-orange-500/15 border-orange-500/40 text-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.12)]'
                        : 'bg-white/5 border-theme-border text-theme-text-muted hover:bg-white/10'
                    )}
                  >
                    {f}%
                  </button>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            REAL-TIME SUMMARY BAR + RUN BUTTON
            ═══════════════════════════════════════════════════════════════════ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-0 bg-[var(--bg-elevated)] border-2 border-theme-border rounded-xl sm:rounded-2xl p-3 sm:p-4 shadow-[4px_4px_0px_rgba(0,0,0,0.3)]"
        >
          <div className="flex flex-wrap items-center gap-3 sm:gap-5 flex-1 min-w-0 px-1 sm:px-3">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Wallet className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="text-xs sm:text-sm font-black text-theme-text whitespace-nowrap">
                {formatManWon(equityInManWon)}만원
              </span>
            </div>
            <span className="text-theme-text-muted font-black hidden xs:inline">|</span>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Clock className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <span className="text-xs sm:text-sm font-black text-theme-text whitespace-nowrap">{backtestYears}년</span>
            </div>
            <span className="text-theme-text-muted font-black hidden xs:inline">|</span>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Percent className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span className="text-xs sm:text-sm font-black text-theme-text whitespace-nowrap">{commissionFee}%</span>
            </div>
            <span className="text-theme-text-muted font-black hidden xs:inline">&rarr;</span>
          </div>
          <Button
            variant="accent"
            size="lg"
            icon={backtesting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
            onClick={onRunBacktest}
            disabled={backtesting || (backtestPortfolioItems || []).length === 0 || totalWeight !== 100}
            className="shrink-0 sm:ml-4"
          >
            {backtesting ? '시뮬레이션 중...' : '백테스팅 시작'}
          </Button>
        </motion.div>

        {/* Portfolio Manager */}
        <PortfolioManager
          portfolios={portfolios}
          currentPortfolioId={currentPortfolioId}
          onSelect={onSelectPortfolio}
          onSave={onSavePortfolio}
          onDelete={onDeletePortfolio}
          onUpdate={onUpdatePortfolio}
        />

        {/* Pie Chart */}
        {portfolios.find(p => p.id === currentPortfolioId) && (
          <Card padding="lg">
            <CardTitle className="mb-6 uppercase tracking-widest">포트폴리오 비중</CardTitle>
            <PortfolioPieChart items={portfolios.find(p => p.id === currentPortfolioId)!.items} />
          </Card>
        )}

        {/* 3-column layout: portfolio builder | results */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 lg:gap-10">
          {/* Left: Portfolio Builder */}
          <div className="lg:col-span-1 space-y-6 sm:space-y-8">

            {/* Portfolio Composition */}
            <Card padding="lg">
              <div className="flex items-center justify-between mb-6 sm:mb-8">
                <div className="flex flex-col gap-1">
                  <span className="text-micro">포트폴리오 구성</span>
                  <label className="cursor-pointer flex items-center gap-2 text-micro text-blue-400 hover:text-blue-300 transition-colors">
                    <input type="file" accept=".txt" onChange={onFileUpload} className="hidden" />
                    {parsingFile ? <RefreshCw className="w-3 h-3 animate-spin" /> : <History className="w-3 h-3" />}
                    <span>파일 업로드 분석</span>
                  </label>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge variant={totalWeight === 100 ? 'success' : totalWeight > 100 ? 'danger' : 'warning'}>
                    Total: {totalWeight}%
                  </Badge>
                  <div className="w-24 sm:w-32 h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{
                        width: `${Math.min(100, totalWeight)}%`,
                        backgroundColor: totalWeight === 100 ? '#22c55e' : totalWeight > 100 ? '#ef4444' : '#f97316'
                      }}
                      className="h-full transition-colors duration-500"
                    />
                  </div>
                </div>
              </div>

              <Reorder.Group
                axis="y"
                values={backtestPortfolioItems || []}
                onReorder={onReorderPortfolioItems}
                className="space-y-3 sm:space-y-5"
              >
                {(backtestPortfolioItems || []).length === 0 ? (
                  <div className="text-center py-12 sm:py-20 border-2 border-dashed border-theme-border rounded-2xl sm:rounded-3xl">
                    <Plus className="w-10 h-10 sm:w-12 sm:h-12 text-theme-text-muted mx-auto mb-3 sm:mb-4" />
                    <p className="text-xs sm:text-sm text-theme-text-muted font-black leading-relaxed">추천 종목이나 검색 결과에서<br/>종목을 추가하세요.</p>
                  </div>
                ) : (
                  (backtestPortfolioItems || []).map((item: any) => {
                    const riskyStock = backtestResult?.riskyStocks?.find((s: any) => s.stock === item.name || s.stock === item.code);
                    const isHighRisk = riskyStock?.riskLevel === 'HIGH';
                    const isMediumRisk = riskyStock?.riskLevel === 'MEDIUM';

                    return (
                      <Reorder.Item
                        key={item.code}
                        value={item}
                        className={cn(
                          'bg-white/5 rounded-xl sm:rounded-2xl p-4 sm:p-6 border flex items-center justify-between gap-3 sm:gap-6 group hover:bg-white/[0.08] transition-all cursor-grab active:cursor-grabbing',
                          isHighRisk ? 'border-red-500/40' :
                          isMediumRisk ? 'border-orange-500/25' :
                          'border-theme-border'
                        )}
                      >
                        <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
                          <div className="p-1.5 sm:p-2 text-theme-text-muted group-hover:text-theme-text-secondary transition-colors shrink-0">
                            <GripVertical className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0 relative group/copy">
                            <div className="flex items-center gap-2 mb-0.5 sm:mb-1">
                              <div
                                onClick={() => onCopy(item.name, item.code)}
                                className="text-sm sm:text-lg font-black text-theme-text cursor-pointer hover:text-orange-500 transition-colors flex items-center gap-2 truncate"
                                title="종목명 복사"
                              >
                                {item.name}
                                <Copy className="w-3.5 h-3.5 opacity-0 group-hover/copy:opacity-50 transition-opacity shrink-0" />
                              </div>
                              {riskyStock && (
                                <Badge variant={isHighRisk ? 'danger' : 'warning'} size="sm">
                                  <ShieldAlert className="w-2.5 h-2.5 mr-0.5" />
                                  {riskyStock.riskLevel} RISK
                                </Badge>
                              )}
                            </div>
                            <AnimatePresence>
                              {copiedCode === item.code && (
                                <motion.span
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0 }}
                                  className="absolute -top-6 left-0 text-[8px] font-black text-green-400 uppercase tracking-widest bg-green-500/20 backdrop-blur-md px-2 py-0.5 rounded-lg border border-green-500/30 z-30"
                                >
                                  Copied!
                                </motion.span>
                              )}
                            </AnimatePresence>
                            <div className="text-micro">{item.code}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                          <div className="relative">
                            <input
                              type="number"
                              value={item.weight}
                              onChange={(e) => onUpdateWeight(item.code, parseInt(e.target.value) || 0)}
                              className={cn(
                                'w-16 sm:w-20 bg-theme-card border rounded-xl sm:rounded-2xl px-2 sm:px-3 py-2 text-sm font-black text-theme-text text-center focus:outline-none transition-all',
                                totalWeight > 100 ? 'border-red-500/50 focus:border-red-500' : 'border-theme-border focus:border-blue-500/50'
                              )}
                            />
                            <span className="absolute -right-3 sm:-right-4 top-1/2 -translate-y-1/2 text-xs font-black text-theme-text-muted">%</span>
                          </div>
                          <button
                            onClick={() => onRemoveFromBacktest(item.code)}
                            className="p-2 sm:p-3 text-theme-text-muted hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                          </button>
                        </div>
                      </Reorder.Item>
                    );
                  })
                )}
              </Reorder.Group>
            </Card>
          </div>

          {/* Right: Results Dashboard */}
          <div className="lg:col-span-2 space-y-6 sm:space-y-8 lg:space-y-10">
            {backtestResult ? (
              <>
                {/* High Risk Alert */}
                {backtestResult.riskyStocks && backtestResult.riskyStocks.some((s: any) => s.riskLevel === 'HIGH') && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-red-500/10 border border-red-500/20 rounded-2xl sm:rounded-3xl p-5 sm:p-8 flex items-center gap-4 sm:gap-6 relative overflow-hidden"
                  >
                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-3xl bg-red-500/20 flex items-center justify-center shrink-0 animate-pulse">
                      <ShieldAlert className="w-6 h-6 sm:w-8 sm:h-8 text-red-500" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-base sm:text-xl font-black text-theme-text uppercase tracking-tighter mb-1">고위험 종목 감지</h4>
                      <p className="text-xs sm:text-sm text-theme-text-secondary font-bold leading-relaxed">
                        포트폴리오 내에 AI가 분석한 고위험 종목이 포함되어 있습니다. 리스크 관리 섹션을 확인하세요.
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* Primary KPI Strip — Neo-Brutalism Large Scoreboard */}
                <KpiStrip size="lg" items={[
                  { label: '누적 수익률', value: `${backtestResult.cumulativeReturn.toFixed(2)}%`, status: backtestResult.cumulativeReturn >= 0 ? 'pass' : 'fail', trend: backtestResult.cumulativeReturn >= 0 ? 'up' : 'down' },
                  { label: '샤프 지수', value: backtestResult.sharpeRatio.toFixed(2), status: backtestResult.sharpeRatio >= 1 ? 'pass' : backtestResult.sharpeRatio >= 0.5 ? 'warn' : 'fail' },
                  { label: '최대 낙폭', value: `${backtestResult.maxDrawdown.toFixed(2)}%`, status: backtestResult.maxDrawdown > -20 ? 'pass' : backtestResult.maxDrawdown > -30 ? 'warn' : 'fail', trend: 'down' },
                  { label: '변동성', value: `${backtestResult.volatility.toFixed(2)}%`, status: 'neutral' },
                ]} />

                {/* Secondary KPI Strip */}
                <KpiStrip items={[
                  { label: 'CAGR (연평균)', value: `${backtestResult.cagr.toFixed(2)}%`, status: backtestResult.cagr >= 0 ? 'pass' : 'fail', trend: backtestResult.cagr >= 0 ? 'up' : 'down' },
                  { label: '승률', value: `${backtestResult.winRate.toFixed(1)}%`, status: backtestResult.winRate >= 50 ? 'pass' : 'warn', trend: backtestResult.winRate >= 50 ? 'up' : 'down' },
                  { label: 'Profit Factor', value: backtestResult.profitFactor.toFixed(2), status: backtestResult.profitFactor >= 1 ? 'pass' : 'fail', trend: backtestResult.profitFactor >= 1 ? 'up' : 'down' },
                  { label: '총 매매', value: backtestResult.trades, status: 'neutral' },
                  { label: '최대 연속 손실', value: `${backtestResult.maxConsecutiveLoss}회`, status: backtestResult.maxConsecutiveLoss <= 3 ? 'pass' : 'fail', trend: 'down' },
                ]} />

                {/* Performance Chart */}
                <Card padding="lg">
                  <span className="text-micro block mb-6 sm:mb-8">수익률 추이 (vs KOSPI)</span>
                  <div className="h-[280px] sm:h-[350px] lg:h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={backtestResult.performanceData}>
                        <defs>
                          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorBenchmark" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis dataKey="date" stroke="rgba(255,255,255,0.2)" fontSize={11} tickLine={false} axisLine={false} tick={{ fontWeight: 900 }} />
                        <YAxis stroke="rgba(255,255,255,0.2)" fontSize={11} tickLine={false} axisLine={false} domain={['auto', 'auto']} tick={{ fontWeight: 900 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#141414', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '12px' }}
                          itemStyle={{ fontSize: '13px', fontWeight: '900', padding: '4px 0' }}
                          labelStyle={{ color: 'rgba(255,255,255,0.4)', fontWeight: '900', marginBottom: '8px', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }}
                        />
                        <Legend verticalAlign="top" align="right" height={48} iconType="circle" wrapperStyle={{ fontWeight: 900, fontSize: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }} />
                        <Area type="monotone" dataKey="value" name="Portfolio" stroke="#f97316" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                        <Area type="monotone" dataKey="benchmark" name="KOSPI" stroke="#3b82f6" strokeWidth={2} strokeDasharray="8 8" fillOpacity={1} fill="url(#colorBenchmark)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* Risk Analysis Row */}
                <PageGrid columns="2" gap="md">
                  {/* Risk Metrics */}
                  <Card padding="lg">
                    <div className="flex items-center gap-3 mb-6">
                      <ShieldAlert className="w-5 h-5 text-red-400" />
                      <span className="text-micro">리스크 지표</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 sm:gap-4">
                      {[
                        { label: 'Beta', value: backtestResult.riskMetrics?.beta.toFixed(2) || 'N/A' },
                        { label: 'Alpha', value: `${backtestResult.riskMetrics?.alpha.toFixed(2) || 'N/A'}%` },
                        { label: 'Treynor', value: backtestResult.riskMetrics?.treynorRatio.toFixed(2) || 'N/A' },
                      ].map(m => (
                        <div key={m.label} className="p-4 sm:p-6 bg-white/5 rounded-xl sm:rounded-2xl border border-theme-border">
                          <div className="text-micro mb-1 sm:mb-2">{m.label}</div>
                          <div className="text-lg sm:text-xl font-black text-theme-text tracking-tighter">{m.value}</div>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {/* Risky Stocks */}
                  <Card padding="lg">
                    <div className="flex items-center gap-3 mb-6">
                      <AlertTriangle className="w-5 h-5 text-yellow-400" />
                      <span className="text-micro">주의 종목 분석</span>
                    </div>
                    <div className="space-y-3 sm:space-y-4">
                      {backtestResult.riskyStocks?.map((stock: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between p-3 sm:p-4 bg-white/5 rounded-xl sm:rounded-2xl border border-theme-border">
                          <div className="min-w-0 mr-3">
                            <div className="text-xs font-black text-theme-text uppercase truncate">{stock.stock}</div>
                            <div className="text-[10px] font-bold text-theme-text-muted truncate">{stock.reason}</div>
                          </div>
                          <Badge variant={stock.riskLevel === 'HIGH' ? 'danger' : 'warning'} size="sm">
                            {stock.riskLevel}
                          </Badge>
                        </div>
                      ))}
                      {(!backtestResult.riskyStocks || backtestResult.riskyStocks.length === 0) && (
                        <div className="text-center py-8 sm:py-10 text-theme-text-muted font-black uppercase text-xs">특이 리스크 종목 없음</div>
                      )}
                    </div>
                  </Card>
                </PageGrid>

                {/* AI Analysis & Optimization Row */}
                <PageGrid columns="2" gap="md">
                  {/* AI Strategy Analysis */}
                  <Card padding="lg">
                    <div className="flex items-center gap-3 mb-6">
                      <Lightbulb className="w-5 h-5 text-orange-400" />
                      <span className="text-micro">AI 전략 분석</span>
                    </div>
                    <p className="text-sm sm:text-base text-theme-text-secondary font-bold leading-relaxed whitespace-pre-wrap">
                      {backtestResult.aiAnalysis}
                    </p>
                  </Card>

                  {/* Optimization Suggestions */}
                  <Card padding="lg">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <Target className="w-5 h-5 text-blue-400" />
                        <span className="text-micro">포트폴리오 최적화 제안</span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Sparkles className="w-3 h-3" />}
                        onClick={onApplyAIRecommendedWeights}
                        className="text-blue-400 border-blue-500/20"
                      >
                        AI 추천 비중 적용
                      </Button>
                    </div>

                    {/* AI Tip */}
                    <div className="mb-6 p-4 sm:p-6 bg-blue-500/5 border border-blue-500/15 rounded-xl sm:rounded-2xl">
                      <div className="flex items-start gap-3 sm:gap-4">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-500/15 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0">
                          <Lightbulb className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs sm:text-sm font-black text-theme-text mb-2 flex items-center gap-2 flex-wrap">
                            오늘의 추천이 '제거' 대상으로?
                            <Badge variant="info" size="sm">AI Tip</Badge>
                          </h4>
                          <div className="space-y-1.5 text-[10px] sm:text-xs text-theme-text-muted font-medium leading-relaxed">
                            <p>• <span className="text-blue-400 font-bold">시간 지평의 차이:</span> 단기 모멘텀 vs 장기 안정성 평가</p>
                            <p>• <span className="text-blue-400 font-bold">포트폴리오 밸런스:</span> 개별 우수해도 전체 변동성 상승 시 축소 제안</p>
                            <p>• <span className="text-blue-400 font-bold">리스크 관리:</span> 급등주의 높은 MDD를 위험 요소로 식별</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 sm:space-y-5">
                      {(backtestResult.optimizationSuggestions || []).map((s: any, i: number) => (
                        <div key={i} className="bg-white/5 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-theme-border group hover:bg-white/[0.08] transition-all">
                          <div className="flex items-center justify-between mb-2 sm:mb-3 relative group/copy">
                            <div
                              onClick={() => onCopy(s.stock, `opt-${i}`)}
                              className="text-sm sm:text-lg font-black text-theme-text cursor-pointer hover:text-orange-500 transition-colors flex items-center gap-2"
                              title="종목명 복사"
                            >
                              {s.stock}
                              <Copy className="w-3.5 h-3.5 opacity-0 group-hover/copy:opacity-50 transition-opacity" />
                              <AnimatePresence>
                                {copiedCode === `opt-${i}` && (
                                  <motion.span
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute -top-6 left-0 text-[8px] font-black text-green-400 uppercase tracking-widest bg-green-500/20 backdrop-blur-md px-2 py-0.5 rounded-lg border border-green-500/30 z-30"
                                  >
                                    Copied!
                                  </motion.span>
                                )}
                              </AnimatePresence>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                              <div className="flex items-center gap-1.5 sm:gap-2 text-micro">
                                <span>{s.currentWeight}%</span>
                                <ArrowRightLeft className="w-2.5 h-2.5" />
                                <span className="text-blue-400">{s.recommendedWeight}%</span>
                              </div>
                              <Badge
                                variant={
                                  s.action === 'INCREASE' ? 'success' :
                                  s.action === 'DECREASE' ? 'warning' :
                                  s.action === 'REMOVE' ? 'danger' : 'default'
                                }
                                size="sm"
                              >
                                {s.action}
                              </Badge>
                            </div>
                          </div>
                          <p className="text-[10px] sm:text-xs text-theme-text-muted font-bold leading-relaxed">{s.reason}</p>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {/* New Theme Suggestions */}
                  {backtestResult.newThemeSuggestions && backtestResult.newThemeSuggestions.length > 0 && (
                    <Card padding="lg">
                      <div className="flex items-center gap-3 mb-6">
                        <Layers className="w-5 h-5 text-purple-400" />
                        <span className="text-micro">신규 편입 테마 제안</span>
                      </div>
                      <div className="space-y-3 sm:space-y-5">
                        {(backtestResult.newThemeSuggestions || []).map((t: any, i: number) => (
                          <div key={i} className="bg-white/5 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-theme-border hover:bg-white/[0.08] transition-all">
                            <div className="flex items-center justify-between mb-2 sm:mb-3 flex-wrap gap-2">
                              <span className="text-sm sm:text-lg font-black text-purple-400">{t.theme}</span>
                              <div className="flex gap-1.5 sm:gap-2 flex-wrap">
                                {(t.stocks || []).map((stock: string, si: number) => (
                                  <Badge key={si} variant="violet" size="sm">{stock}</Badge>
                                ))}
                              </div>
                            </div>
                            <p className="text-[10px] sm:text-xs text-theme-text-muted font-bold leading-relaxed">{t.reason}</p>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  {/* Risky Stocks Detailed */}
                  {backtestResult.riskyStocks && backtestResult.riskyStocks.length > 0 && (
                    <Card
                      padding="lg"
                      className={cn(
                        backtestResult.riskyStocks.some((s: any) => s.riskLevel === 'HIGH')
                          ? '!border-red-500/25 shadow-[0_0_40px_rgba(239,68,68,0.08)]' : ''
                      )}
                    >
                      <div className="flex items-center gap-3 mb-6">
                        <ShieldAlert className={cn('w-5 h-5', backtestResult.riskyStocks.some((s: any) => s.riskLevel === 'HIGH') ? 'text-red-500 animate-pulse' : 'text-red-400')} />
                        <span className="text-micro">리스크 관리: 정리 추천</span>
                      </div>
                      <div className="space-y-3 sm:space-y-5">
                        {(backtestResult.riskyStocks || []).map((rs: any, i: number) => (
                          <div key={i} className={cn(
                            'rounded-xl sm:rounded-2xl p-4 sm:p-6 border transition-all',
                            rs.riskLevel === 'HIGH'
                              ? 'bg-red-500/10 border-red-500/25'
                              : 'bg-red-500/5 border-red-500/10 hover:bg-red-500/10'
                          )}>
                            <div className="flex items-center justify-between mb-2 sm:mb-3">
                              <span className={cn('text-sm sm:text-lg font-black', rs.riskLevel === 'HIGH' ? 'text-red-500' : 'text-red-400')}>{rs.stock}</span>
                              <Badge variant="danger" size="sm">
                                <ShieldAlert className="w-3 h-3 mr-0.5" />
                                {rs.riskLevel} RISK
                              </Badge>
                            </div>
                            <p className="text-[10px] sm:text-xs text-theme-text-secondary font-bold leading-relaxed">{rs.reason}</p>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                </PageGrid>
              </>
            ) : (
              <EmptyState
                icon={<History className="w-10 h-10 sm:w-12 sm:h-12" />}
                title="백테스팅 결과가 없습니다"
                description="포트폴리오를 구성하고 시뮬레이션을 시작하세요."
              />
            )}
          </div>
        </div>
      </Stack>
    </motion.div>
  );
}
