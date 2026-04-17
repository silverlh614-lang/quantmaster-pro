import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { Activity, Eye, Briefcase, ShieldAlert, BarChart3, Settings2, Sliders, Power, Zap, TrendingUp, Wallet, Timer, Shield, Clock, ArrowUpDown, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { cn } from '../ui/cn';
import { PageHeader } from '../ui/page-header';
import { KpiStrip } from '../ui/kpi-strip';
import { Card } from '../ui/card';
import { Section } from '../ui/section';
import { Badge } from '../ui/badge';
import { Stack } from '../layout/Stack';
import { PageGrid } from '../layout/PageGrid';
import { TradingChecklist } from '../components/trading/TradingChecklist';
import { TradingSettingsPanel } from '../components/trading/TradingSettingsPanel';
import { SessionRecoveryBanner } from '../components/trading/SessionRecoveryBanner';

// ─── 조건 키 → 사람이 읽을 수 있는 한국어 레이블 ─────────────────────────────
const CONDITION_LABELS: Record<string, string> = {
  momentum:          '모멘텀 (당일 +2% 이상)',
  ma_alignment:      '정배열 (MA5 > MA20 > MA60)',
  volume_breakout:   '거래량 돌파 (평균 2배 이상)',
  per:               'PER 밸류에이션 (0~20 구간)',
  turtle_high:       '터틀 돌파 (20일 신고가)',
  relative_strength: '상대강도 (KOSPI 대비 +1%p)',
  vcp:               '변동성 수축 (VCP 패턴)',
  volume_surge:      '거래량 급증+상승 (3배 & +1%)',
  rsi_zone:          'RSI 건강구간 (40~70)',
  macd_bull:         'MACD 가속 (히스토그램 양수+확대)',
  pullback:          '눌림목 셋업 (고점 대비 조정)',
  ma60_rising:       'MA60 우상향 추세 (장기 상승)',
  weekly_rsi_zone:   '주봉 RSI 건강구간 (40~70)',
  supply_confluence: '수급 합치 (기관+외인 순매수)',
  earnings_quality:  '이익 품질 (영업현금흐름 비율)',
};

// ─── 레짐 코드 → 한국어 레이블 ────────────────────────────────────────────────
const REGIME_LABELS: Record<string, string> = {
  R1_TURBO:   'R1 터보 강세',
  R2_BULL:    'R2 상승장',
  R3_EARLY:   'R3 초기 회복',
  R4_NEUTRAL: 'R4 중립',
  R5_CAUTION: 'R5 주의',
  R6_DEFENSE: 'R6 방어',
};

// ─── Gate 설명 툴팁 ───────────────────────────────────────────────────────────
const GATE_TOOLTIPS: Record<number, string> = {
  1: 'Gate 1 (생존): 유동성·재무·상장요건 필수 통과',
  2: 'Gate 2 (성장): ROE개선·마진가속·수급 12개 조건',
  3: 'Gate 3 (타이밍): 기술적 진입 타점 10개 조건',
};

interface WatchlistEntry {
  code: string;
  name: string;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  addedAt: string;
  gateScore?: number;
  addedBy: 'AUTO' | 'MANUAL' | 'DART';
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

// 아이디어 10: Buy Audit 진단 대시보드
interface BuyAuditData {
  watchlistCount: number;
  focusCount: number;
  buyListCount: number;
  regime: string;
  vixGating: { noNewEntry: boolean; kellyMultiplier: number; reason: string };
  fomcGating: { noNewEntry: boolean; phase: string; kellyMultiplier: number; description: string; nextFomcDate?: string | null; unblockAt?: string | null };
  emergencyStop: boolean;
  lastScanAt: string | null;
  rejectedStocks: { code: string; name: string; reason: string }[];
}

// 아이디어 11: Gate 조건 통과율 히트맵
type GateAuditData = Record<string, { passed: number; failed: number }>;

// 자동매매 엔진 상태
interface EngineStatus {
  running: boolean;
  autoTradeEnabled: boolean;
  emergencyStop: boolean;
  mode: string;
  currentState: string;
  lastRun: string | null;
  lastScanAt: string | null;
  lastBuySignalAt: string | null;
  todayStats: { scans: number; buys: number; exits: number };
}

// OCO 주문 쌍
interface OcoOrderPair {
  id: string;
  stockCode: string;
  stockName: string;
  quantity: number;
  entryPrice: number;
  stopPrice: number;
  stopStatus: 'PENDING' | 'FILLED' | 'CANCELLED' | 'FAILED';
  profitPrice: number;
  profitStatus: 'PENDING' | 'FILLED' | 'CANCELLED' | 'FAILED';
  createdAt: string;
  resolvedAt?: string;
  status: 'ACTIVE' | 'STOP_FILLED' | 'PROFIT_FILLED' | 'BOTH_CANCELLED' | 'ERROR';
}

// RRR 분포 차트 색상
const RRR_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#10b981'];

// KIS 계좌 잔고 요약
interface AccountSummary {
  totalEvalAmt: number;    // 총 평가금액
  totalPnlAmt: number;     // 총 손익금액
  totalPnlRate: number;    // 총 수익률(%)
  availableCash: number;   // 가용 현금
}

// ─── 카운트다운 훅 ─────────────────────────────────────────────────────────
function useCountdown(targetIso: string | null | undefined): string | null {
  const [remaining, setRemaining] = useState<string | null>(null);
  useEffect(() => {
    if (!targetIso) { setRemaining(null); return; }
    const calc = () => {
      const diff = new Date(targetIso).getTime() - Date.now();
      if (diff <= 0) { setRemaining('해제됨'); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setRemaining(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    calc();
    const id = setInterval(calc, 1_000);
    return () => clearInterval(id);
  }, [targetIso]);
  return remaining;
}

export function AutoTradePage() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings'>('dashboard');
  const [serverShadowTrades, setServerShadowTrades] = useState<any[]>([]);
  const [serverRecStats, setServerRecStats] = useState<{ month?: string; winRate?: number; avgReturn?: number; strongBuyWinRate?: number; total?: number } | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [holdings, setHoldings] = useState<KisHolding[]>([]);
  const [portfolioTab, setPortfolioTab] = useState<'watchlist' | 'holdings'>('watchlist');
  const [buyAudit, setBuyAudit] = useState<BuyAuditData | null>(null);
  const [gateAudit, setGateAudit] = useState<GateAuditData | null>(null);
  const [conditionDebug, setConditionDebug] = useState<{
    globalWeights: Record<string, number>;
    defaults: Record<string, number>;
    conditionStats30d: Record<string, { totalAppearances: number; wins: number; losses: number; hitRate: number; avgReturn: number }>;
    recentRecordsCount: number;
    period: { from: string; to: string };
  } | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [engineToggling, setEngineToggling] = useState(false);
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [ocoOrders, setOcoOrders] = useState<{ active: OcoOrderPair[]; history: OcoOrderPair[] }>({ active: [], history: [] });

  // ③ FOMC 차단 해제 카운트다운
  const fomcCountdown = useCountdown(buyAudit?.fomcGating.unblockAt);

  // 서버 Shadow Trades 기반 통계 (로컬 저장소 의존 제거)
  const serverShadowStats = useMemo(() => {
    const settled = serverShadowTrades.filter((t: any) =>
      t.status === 'HIT_TARGET' || t.status === 'HIT_STOP',
    );
    if (settled.length === 0) return { count: serverShadowTrades.length, winRate: 0, avgReturn: 0 };
    const wins = settled.filter((t: any) => t.status === 'HIT_TARGET').length;
    const winRate = Math.round((wins / settled.length) * 100);
    const avgReturn = settled.reduce((s: number, t: any) => s + (t.returnPct ?? 0), 0) / settled.length;
    return { count: serverShadowTrades.length, winRate, avgReturn };
  }, [serverShadowTrades]);

  // ④ 포지션 리스크 게이지
  const riskGauge = useMemo(() => {
    if (!accountSummary) return null;
    const totalAsset = accountSummary.totalEvalAmt + accountSummary.availableCash;
    if (totalAsset <= 0) return null;
    const exposureRate = (accountSummary.totalEvalAmt / totalAsset) * 100;
    const cashRate = (accountSummary.availableCash / totalAsset) * 100;
    // 최대 예상 손실: 워치리스트 손절가 기반 계산
    const maxLoss = watchlist.reduce((sum: number, w: WatchlistEntry) => {
      const lossRate = Math.abs((w.stopLoss - w.entryPrice) / w.entryPrice);
      const posSize = accountSummary.totalEvalAmt / Math.max(watchlist.length, 1);
      return sum + lossRate * posSize;
    }, 0);
    return { exposureRate, cashRate, maxLoss };
  }, [accountSummary, watchlist]);

  // ⑤ RRR 분포 막대차트 데이터
  const rrrBuckets = useMemo(() => {
    const settled = serverShadowTrades.filter((t: any) => t.returnPct != null);
    return [
      { name: '손실', value: settled.filter((t: any) => t.returnPct < 0).length },
      { name: '0~5%', value: settled.filter((t: any) => t.returnPct >= 0 && t.returnPct < 5).length },
      { name: '5~10%', value: settled.filter((t: any) => t.returnPct >= 5 && t.returnPct < 10).length },
      { name: '10%+', value: settled.filter((t: any) => t.returnPct >= 10).length },
    ];
  }, [serverShadowTrades]);

  // ⑥ 매매 타임라인 (최근 활동 피드)
  const timeline = useMemo(() => {
    const events: { time: string; type: string; stock: string; detail: string }[] = [];
    // Shadow Trade 이벤트
    for (const t of serverShadowTrades) {
      if (t.status === 'HIT_TARGET') events.push({ time: t.resolvedAt ?? t.signalTime, type: 'TARGET_HIT', stock: t.stockName, detail: `+${t.returnPct?.toFixed(1)}%` });
      else if (t.status === 'HIT_STOP') events.push({ time: t.resolvedAt ?? t.signalTime, type: 'STOP_HIT', stock: t.stockName, detail: `${t.returnPct?.toFixed(1)}%` });
      else if (t.status === 'ACTIVE') events.push({ time: t.signalTime, type: 'BUY', stock: t.stockName, detail: `${t.shadowEntryPrice?.toLocaleString()}원` });
    }
    // 워치리스트 최근 추가
    for (const w of watchlist.slice(0, 5)) {
      events.push({ time: w.addedAt, type: 'WATCHLIST', stock: w.name, detail: `${w.addedBy} 추가` });
    }
    return events
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 8);
  }, [serverShadowTrades, watchlist]);

  const handleEngineToggle = async () => {
    if (engineToggling) return;
    setEngineToggling(true);
    try {
      const res = await fetch('/api/auto-trade/engine/toggle', { method: 'POST' });
      const data = await res.json();
      setEngineStatus((prev) => prev ? { ...prev, running: data.running, emergencyStop: data.emergencyStop } : prev);
    } catch (err) {
      console.error('[ERROR] 엔진 토글 실패:', err);
    } finally {
      setEngineToggling(false);
    }
  };

  useEffect(() => {
    const fetchServerData = () => {
      fetch('/api/auto-trade/shadow-trades').then(r => r.json()).then(setServerShadowTrades).catch((err) => console.error('[ERROR] Shadow trades 조회 실패:', err));
      fetch('/api/auto-trade/recommendations/stats').then(r => r.json()).then(setServerRecStats).catch((err) => console.error('[ERROR] Recommendation stats 조회 실패:', err));
      fetch('/api/auto-trade/watchlist').then(r => r.json()).then(setWatchlist).catch((err) => console.error('[ERROR] 워치리스트 조회 실패:', err));
      fetch('/api/kis/holdings').then(r => r.json()).then((data) => {
        if (Array.isArray(data)) setHoldings(data);
      }).catch((err) => console.error('[ERROR] 보유종목 조회 실패:', err));
      fetch('/api/system/buy-audit').then(r => r.json()).then(setBuyAudit).catch((err) => console.error('[ERROR] Buy audit 조회 실패:', err));
      fetch('/api/system/gate-audit').then(r => r.json()).then(setGateAudit).catch((err) => console.error('[ERROR] Gate audit 조회 실패:', err));
      fetch('/api/auto-trade/condition-weights/debug').then(r => r.json()).then(setConditionDebug).catch((err) => console.error('[ERROR] Condition debug 조회 실패:', err));
      fetch('/api/auto-trade/engine/status').then(r => r.json()).then(setEngineStatus).catch((err) => console.error('[ERROR] Engine status 조회 실패:', err));
      fetch('/api/auto-trade/oco-orders').then(r => r.json()).then(setOcoOrders).catch(() => {});
      fetch('/api/kis/balance').then(r => r.json()).then((data: any) => {
        // output2[0]에 계좌 총평가 정보가 있음
        const summary = data?.output2?.[0];
        const holdings = data?.output1 ?? [];
        if (summary) {
          const totalEvalAmt = Number(summary.tot_evlu_amt ?? 0);
          const purchaseAmt = Number(summary.pchs_amt_smtl_amt ?? 0);
          const pnlAmt = totalEvalAmt - purchaseAmt;
          const pnlRate = purchaseAmt > 0 ? (pnlAmt / purchaseAmt) * 100 : 0;
          const availableCash = Number(summary.dnca_tot_amt ?? summary.prvs_rcdl_excc_amt ?? 0);
          setAccountSummary({ totalEvalAmt, totalPnlAmt: pnlAmt, totalPnlRate: pnlRate, availableCash });
        }
      }).catch((err) => console.error('[ERROR] 계좌 잔고 조회 실패:', err));
    };
    fetchServerData();
    const interval = setInterval(fetchServerData, 60 * 1000); // 1분 간격 polling
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
        {/* 세션 복구 배너 */}
        <SessionRecoveryBanner />

        <PageHeader
          title="자동매매 센터"
          subtitle="KIS 모의계좌 연동 · Shadow Trading · OCO 자동 등록"
          accentColor="bg-violet-500"
        />

        {/* ① 자동매매 엔진 마스터 스위치 + 상태 패널 */}
        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center',
                engineStatus?.running ? 'bg-green-500/20' : 'bg-red-500/20'
              )}>
                <Power className={cn('w-5 h-5', engineStatus?.running ? 'text-green-400' : 'text-red-400')} />
              </div>
              <div>
                <span className="text-sm font-black text-theme-text">자동매매 엔진</span>
                <div className="flex items-center gap-3 text-[10px] text-theme-text-muted mt-0.5">
                  {engineStatus?.lastScanAt && (
                    <span>마지막 스캔: {new Date(engineStatus.lastScanAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  )}
                  {engineStatus?.currentState && (
                    <span className="px-1.5 py-0.5 rounded bg-white/5 font-bold">{engineStatus.currentState}</span>
                  )}
                  {engineStatus?.mode && (
                    <Badge variant={engineStatus.mode === 'LIVE' ? 'danger' : engineStatus.mode === 'VTS' ? 'warning' : 'info'} size="sm">
                      {engineStatus.mode}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            {/* 대형 ON/OFF 토글 */}
            <button
              onClick={handleEngineToggle}
              disabled={engineToggling}
              className={cn(
                'relative w-16 h-8 rounded-full transition-all duration-300 border-2 shrink-0',
                engineStatus?.running
                  ? 'bg-green-500/30 border-green-500/50'
                  : 'bg-red-500/20 border-red-500/30',
                engineToggling && 'opacity-50 cursor-not-allowed'
              )}
            >
              <div className={cn(
                'absolute top-0.5 w-6 h-6 rounded-full transition-all duration-300 shadow-lg',
                engineStatus?.running
                  ? 'left-[calc(100%-1.625rem)] bg-green-400'
                  : 'left-0.5 bg-red-400'
              )} />
              <span className="sr-only">{engineStatus?.running ? 'ON' : 'OFF'}</span>
            </button>
          </div>
          {/* 오늘 KPI 카드 3개 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-white/5 border border-theme-border/20 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Zap className="w-3 h-3 text-blue-400" />
                <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">오늘 실행</p>
              </div>
              <p className="text-xl font-black text-theme-text font-num">{engineStatus?.todayStats.scans ?? 0}<span className="text-xs font-bold text-theme-text-muted ml-0.5">회</span></p>
            </div>
            <div className="rounded-xl bg-white/5 border border-theme-border/20 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <TrendingUp className="w-3 h-3 text-green-400" />
                <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">오늘 매수</p>
              </div>
              <p className="text-xl font-black text-green-400 font-num">{engineStatus?.todayStats.buys ?? 0}<span className="text-xs font-bold text-theme-text-muted ml-0.5">건</span></p>
            </div>
            <div className="rounded-xl bg-white/5 border border-theme-border/20 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Activity className="w-3 h-3 text-amber-400" />
                <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">오늘 청산</p>
              </div>
              <p className="text-xl font-black text-amber-400 font-num">{engineStatus?.todayStats.exits ?? 0}<span className="text-xs font-bold text-theme-text-muted ml-0.5">건</span></p>
            </div>
          </div>
        </Card>

        {/* ② 실시간 포트폴리오 P&L 헤더 대시보드 */}
        {accountSummary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="border-2 rounded-xl p-4 text-center border-slate-600/40 bg-white/[0.02]">
              <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">평가금액</p>
              <p className="text-lg font-black text-theme-text mt-1 font-num">{accountSummary.totalEvalAmt.toLocaleString()}<span className="text-[10px] font-bold text-theme-text-muted ml-0.5">원</span></p>
            </div>
            <div className={cn(
              'border-2 rounded-xl p-4 text-center',
              accountSummary.totalPnlAmt >= 0
                ? 'border-green-500/40 bg-green-500/[0.06]'
                : 'border-red-500/40 bg-red-500/[0.06]'
            )}>
              <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">총 손익</p>
              <p className={cn('text-lg font-black mt-1 font-num', accountSummary.totalPnlAmt >= 0 ? 'text-green-400' : 'text-red-400')}>
                {accountSummary.totalPnlAmt >= 0 ? '+' : ''}{accountSummary.totalPnlAmt.toLocaleString()}<span className="text-[10px] font-bold text-theme-text-muted ml-0.5">원</span>
              </p>
            </div>
            <div className={cn(
              'border-2 rounded-xl p-4 text-center',
              accountSummary.totalPnlRate >= 0
                ? 'border-green-500/40 bg-green-500/[0.06]'
                : 'border-red-500/40 bg-red-500/[0.06]'
            )}>
              <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">수익률</p>
              <p className={cn('text-lg font-black mt-1 font-num', accountSummary.totalPnlRate >= 0 ? 'text-green-400' : 'text-red-400')}>
                {(accountSummary.totalPnlRate ?? 0) >= 0 ? '+' : ''}{(accountSummary.totalPnlRate ?? 0).toFixed(2)}<span className="text-[10px] font-bold text-theme-text-muted ml-0.5">%</span>
              </p>
            </div>
            <div className="border-2 rounded-xl p-4 text-center border-blue-500/30 bg-blue-500/[0.04]">
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <Wallet className="w-3 h-3 text-blue-400" />
                <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">가용현금</p>
              </div>
              <p className="text-lg font-black text-blue-400 mt-1 font-num">{accountSummary.availableCash.toLocaleString()}<span className="text-[10px] font-bold text-theme-text-muted ml-0.5">원</span></p>
            </div>
          </div>
        )}

        {/* KPI Strip — Neo-Brutalism Large Scoreboard */}
        <KpiStrip size="lg" items={[
          { label: 'Shadow 건수', value: serverShadowStats.count, status: 'neutral' },
          { label: '적중률', value: `${serverShadowStats.winRate}%`, status: serverShadowStats.winRate >= 60 ? 'pass' : serverShadowStats.winRate >= 40 ? 'warn' : 'fail', change: serverShadowStats.winRate >= 50 ? '목표 충족' : '목표 미달' },
          { label: '평균수익', value: `${(serverShadowStats.avgReturn ?? 0).toFixed(2)}%`, status: (serverShadowStats.avgReturn ?? 0) >= 0 ? 'pass' : 'fail', trend: (serverShadowStats.avgReturn ?? 0) >= 0 ? 'up' : 'down' },
        ]} />

        {/* Tab Switcher: 대시보드 / 트레이딩 설정 */}
        <div className="flex items-center gap-2 p-1 bg-white/5 rounded-xl border border-theme-border w-fit">
          {(['dashboard', 'settings'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-1.5 text-xs font-bold rounded-lg transition-all',
                activeTab === tab
                  ? 'bg-violet-500 text-white shadow-[0_0_12px_rgba(139,92,246,0.3)]'
                  : 'text-theme-text-muted hover:text-theme-text hover:bg-white/5'
              )}
            >
              {tab === 'dashboard' ? '대시보드' : '트레이딩 설정'}
            </button>
          ))}
        </div>

        {/* ── 트레이딩 설정 탭 ─────────────────────────────────────────── */}
        {activeTab === 'settings' && <TradingSettingsPanel />}

        {/* ── 대시보드 탭 ─────────────────────────────────────────────── */}
        {activeTab === 'dashboard' && <>

        {/* 아이디어 10: 매수 차단 원인 진단 패널 */}
        {buyAudit && (
          <Card padding="md">
            <div className="flex items-center gap-2 mb-4">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-bold text-theme-text">매수 진단 대시보드</span>
              {buyAudit.lastScanAt && (
                <span className="text-micro ml-auto">
                  마지막 스캔: {new Date(buyAudit.lastScanAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
            </div>

            {/* Pipeline 카운트 */}
            <div className="grid grid-cols-3 gap-3 mb-4 text-center">
              <div className="rounded-lg bg-white/5 p-2">
                <p className="text-micro">워치리스트</p>
                <p className="text-lg font-black text-theme-text">{buyAudit.watchlistCount}</p>
              </div>
              <div className="rounded-lg bg-white/5 p-2">
                <p className="text-micro">Focus</p>
                <p className="text-lg font-black text-violet-400">{buyAudit.focusCount}</p>
              </div>
              <div className="rounded-lg bg-white/5 p-2">
                <p className="text-micro">Buy List</p>
                <p className="text-lg font-black text-green-400">{buyAudit.buyListCount}</p>
              </div>
            </div>

            {/* Gate 상태 표시 */}
            <div className="space-y-2 mb-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-theme-text-muted">시장 레짐</span>
                <Badge variant={
                  buyAudit.regime.startsWith('R1') || buyAudit.regime.startsWith('R2') ? 'success' :
                  buyAudit.regime.startsWith('R3') || buyAudit.regime.startsWith('R4') ? 'warning' :
                  'danger'
                } size="sm">{REGIME_LABELS[buyAudit.regime] ?? buyAudit.regime}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-theme-text-muted">VIX 공포지수 게이트</span>
                <Badge variant={buyAudit.vixGating.noNewEntry ? 'danger' : 'success'} size="sm">
                  {buyAudit.vixGating.noNewEntry ? '차단됨' : `정상 (베팅 비율 x${(buyAudit.vixGating.kellyMultiplier ?? 1).toFixed(2)})`}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-theme-text-muted">FOMC 금리 발표 게이트</span>
                <Badge variant={buyAudit.fomcGating.noNewEntry ? 'danger' : 'success'} size="sm">
                  {buyAudit.fomcGating.noNewEntry ? `차단됨 (${buyAudit.fomcGating.phase})` : buyAudit.fomcGating.phase}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-theme-text-muted">비상정지</span>
                <Badge variant={buyAudit.emergencyStop ? 'danger' : 'success'} size="sm">
                  {buyAudit.emergencyStop ? '정지 중' : '해제'}
                </Badge>
              </div>
            </div>

            {/* 종합 차단 여부 */}
            {(buyAudit.vixGating.noNewEntry || buyAudit.fomcGating.noNewEntry || buyAudit.emergencyStop) && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 mb-4">
                <p className="text-sm font-bold text-red-400 mb-1">신규 매수 차단 중</p>
                <ul className="text-xs text-red-300/80 space-y-0.5">
                  {buyAudit.emergencyStop && <li>- 비상 정지 활성</li>}
                  {buyAudit.vixGating.noNewEntry && <li>- {buyAudit.vixGating.reason}</li>}
                  {buyAudit.fomcGating.noNewEntry && <li>- {buyAudit.fomcGating.description}</li>}
                </ul>
                {/* ③ FOMC 차단 해제 카운트다운 */}
                {buyAudit.fomcGating.noNewEntry && fomcCountdown && (
                  <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Timer className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-bold text-amber-300">FOMC 차단 해제까지</span>
                    </div>
                    <span className="text-2xl font-black text-amber-400 tabular-nums font-num">{fomcCountdown}</span>
                  </div>
                )}
                {/* VIX 차단 해제 조건 안내 */}
                {buyAudit.vixGating.noNewEntry && (
                  <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-bold text-amber-300">VIX 차단 해제 조건</span>
                    </div>
                    <span className="text-xs text-amber-300/80">VIX &lt; 30 또는 3일 연속 하락 시 자동 해제</span>
                  </div>
                )}
              </div>
            )}

            {/* 탈락 종목 리스트 */}
            {buyAudit.rejectedStocks.length > 0 && (
              <div>
                <p className="text-micro mb-2">최근 탈락 종목 ({buyAudit.rejectedStocks.length}건)</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {buyAudit.rejectedStocks.slice(0, 20).map((r) => (
                    <div key={r.code} className="flex items-center justify-between text-xs py-1 border-b border-theme-border/10 last:border-0">
                      <span className="text-theme-text">{r.name} <span className="text-theme-text-muted">{r.code}</span></span>
                      <span className="text-red-400 shrink-0 ml-2">{r.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* 자동매매 진입 조건 설정 현황 */}
        {conditionDebug && (
          <Card padding="md">
            <div className="flex items-center gap-2 mb-4">
              <Settings2 className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-bold text-theme-text">자동매매 진입 조건 설정 현황</span>
              {conditionDebug.recentRecordsCount > 0 && (
                <span className="text-micro ml-auto">
                  최근 30일 데이터 {conditionDebug.recentRecordsCount}건 ({conditionDebug.period.from} ~ {conditionDebug.period.to})
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {Object.entries(conditionDebug.globalWeights)
                .sort(([, a], [, b]) => b - a)
                .map(([key, weight]) => {
                  const label = CONDITION_LABELS[key] ?? key;
                  const defaultW = conditionDebug.defaults[key] ?? 1.0;
                  const stat = conditionDebug.conditionStats30d[key];
                  const isModified = Math.abs(weight - defaultW) > 0.01;
                  return (
                    <div key={key} className="flex items-center gap-2 py-1.5 border-b border-theme-border/10 last:border-0">
                      <span className="flex-1 text-xs text-theme-text truncate">{label}</span>
                      <Badge variant={weight >= 1.2 ? 'success' : weight <= 0.5 ? 'danger' : 'default'} size="sm">
                        가중치 {weight.toFixed(1)}{isModified ? ` (기본 ${defaultW.toFixed(1)})` : ''}
                      </Badge>
                      {stat && stat.totalAppearances > 0 && (
                        <span className={cn('text-[9px] font-bold', stat.hitRate >= 50 ? 'text-green-400' : 'text-red-400')}>
                          적중 {stat.hitRate}%
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
            <div className="mt-3 rounded-lg bg-white/5 p-2.5 text-micro text-theme-text-muted leading-relaxed">
              <strong className="text-theme-text">진입 판정 기준:</strong>{' '}
              Gate 점수 ≥ 7 → STRONG (12% 포지션) · ≥ 5 → NORMAL (8%) · &lt; 5 → SKIP.
              MTAS(다중시간프레임) ≤ 3이면 진입 금지.
              가중치는 30일 적중률 기반으로 자동 조정됩니다.
            </div>
          </Card>
        )}

        {/* Gate 조건 통과율 히트맵 */}
        {gateAudit && Object.keys(gateAudit).length > 0 && (
          <Card padding="md">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-bold text-theme-text">Gate 조건 통과율 히트맵</span>
              <span className="ml-auto flex items-center gap-1.5">
                {Object.entries(GATE_TOOLTIPS).map(([gate, desc]) => (
                  <span
                    key={gate}
                    title={desc}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/5 text-theme-text-muted cursor-help hover:bg-white/10 transition-colors"
                  >
                    <Info className="w-3 h-3" />G{gate}
                  </span>
                ))}
              </span>
            </div>
            <div className="space-y-2">
              {Object.entries(gateAudit)
                .sort(([, a], [, b]) => {
                  const rateA = a.passed + a.failed > 0 ? a.passed / (a.passed + a.failed) : 0;
                  const rateB = b.passed + b.failed > 0 ? b.passed / (b.passed + b.failed) : 0;
                  return rateA - rateB; // 통과율 낮은 순 (가장 타이트한 조건 먼저)
                })
                .map(([key, stats]) => {
                  const total = stats.passed + stats.failed;
                  const rate = total > 0 ? (stats.passed / total) * 100 : 0;
                  const barColor = rate >= 60 ? 'bg-green-500' : rate >= 30 ? 'bg-amber-500' : 'bg-red-500';
                  const label = CONDITION_LABELS[key] ?? key;
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-theme-text font-bold">{label}</span>
                        <span className="text-theme-text-muted">
                          {rate.toFixed(0)}% ({stats.passed}/{total})
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', barColor)}
                          style={{ width: `${rate}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </Card>
        )}

        {/* ④ 포지션 리스크 게이지 */}
        {riskGauge && (
          <Card padding="md">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-red-400" />
              <span className="text-sm font-bold text-theme-text">포지션 리스크 게이지</span>
            </div>
            <div className="space-y-4">
              {/* 총 익스포저 */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-theme-text font-bold">총 익스포저</span>
                  <span className={cn('font-bold font-num', riskGauge.exposureRate > 80 ? 'text-red-400' : riskGauge.exposureRate > 60 ? 'text-amber-400' : 'text-green-400')}>
                    {riskGauge.exposureRate.toFixed(1)}%
                  </span>
                </div>
                <div className="h-3 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', riskGauge.exposureRate > 80 ? 'bg-red-500' : riskGauge.exposureRate > 60 ? 'bg-amber-500' : 'bg-green-500')}
                    style={{ width: `${Math.min(riskGauge.exposureRate, 100)}%` }}
                  />
                </div>
              </div>
              {/* 최대 예상 손실 */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-theme-text font-bold">최대 예상 손실</span>
                  <span className="text-red-400 font-bold font-num">-{Math.round(riskGauge.maxLoss).toLocaleString()}원</span>
                </div>
                <div className="h-3 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-red-500 transition-all"
                    style={{ width: `${Math.min((riskGauge.maxLoss / ((accountSummary?.totalEvalAmt ?? 1) + (accountSummary?.availableCash ?? 0))) * 100, 100)}%` }}
                  />
                </div>
              </div>
              {/* 남은 투자여력 */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-theme-text font-bold">남은 투자여력</span>
                  <span className="text-blue-400 font-bold font-num">{riskGauge.cashRate.toFixed(1)}%</span>
                </div>
                <div className="h-3 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${Math.min(riskGauge.cashRate, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* ⑤ RRR 분포 막대차트 + ⑥ 매매 타임라인 */}
        <PageGrid columns="2" gap="sm">
          {rrrBuckets.some(b => b.value > 0) && (
            <Card padding="md">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-bold text-theme-text">손익비 분포</span>
                <span className="text-micro ml-auto">{serverShadowTrades.filter((t: any) => t.returnPct != null).length}건 결산</span>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={rrrBuckets} barSize={32}>
                  <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
                    formatter={(v) => [`${v}건`, '거래 수']}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {rrrBuckets.map((_: any, idx: number) => (
                      <Cell key={idx} fill={RRR_COLORS[idx]} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {timeline.length > 0 && (
            <Card padding="md">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-bold text-theme-text">최근 활동</span>
              </div>
              <div className="space-y-3">
                {timeline.map((evt, i) => {
                  const dotColor = evt.type === 'TARGET_HIT' ? 'bg-green-400' : evt.type === 'STOP_HIT' ? 'bg-red-400' : evt.type === 'BUY' ? 'bg-violet-400' : 'bg-blue-400';
                  const label = evt.type === 'TARGET_HIT' ? '익절' : evt.type === 'STOP_HIT' ? '손절' : evt.type === 'BUY' ? '매수' : '추가';
                  const timeStr = (() => {
                    try {
                      const d = new Date(evt.time);
                      const now = new Date();
                      if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                      return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
                    } catch { return ''; }
                  })();
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <div className="flex flex-col items-center">
                        <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', dotColor)} />
                        {i < timeline.length - 1 && <div className="w-px h-4 bg-white/10 mt-1" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-theme-text truncate">{evt.stock}</span>
                          <span className="text-[10px] text-theme-text-muted shrink-0 ml-2">{timeStr}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={cn('text-[10px] font-bold', evt.type === 'TARGET_HIT' ? 'text-green-400' : evt.type === 'STOP_HIT' ? 'text-red-400' : 'text-theme-text-muted')}>{label}</span>
                          <span className="text-[10px] text-theme-text-muted">{evt.detail}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </PageGrid>

        {/* ⑦ OCO 주문 현황 패널 */}
        {(ocoOrders.active.length > 0 || ocoOrders.history.length > 0) && (
          <Card padding="md">
            <div className="flex items-center gap-2 mb-4">
              <ArrowUpDown className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-bold text-theme-text">OCO 주문 현황</span>
              {ocoOrders.active.length > 0 && (
                <Badge variant="warning" size="sm">{ocoOrders.active.length}건 활성</Badge>
              )}
            </div>
            <div className="space-y-2">
              {[...ocoOrders.active, ...ocoOrders.history.slice(0, 5)].map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 py-2 border-b border-theme-border/20 last:border-0">
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-theme-text truncate">{o.stockName}</span>
                    <span className="text-micro ml-2">{o.stockCode}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs shrink-0">
                    <span className="text-red-400 font-num">손절 {o.stopPrice.toLocaleString()}</span>
                    <span className="text-theme-text-muted">/</span>
                    <span className="text-green-400 font-num">목표 {o.profitPrice.toLocaleString()}</span>
                    <Badge
                      variant={o.status === 'ACTIVE' ? 'warning' : o.status === 'PROFIT_FILLED' ? 'success' : o.status === 'STOP_FILLED' ? 'danger' : 'default'}
                      size="sm"
                    >
                      {o.status === 'ACTIVE' ? '대기중' : o.status === 'PROFIT_FILLED' ? '익절' : o.status === 'STOP_FILLED' ? '손절' : o.status === 'BOTH_CANCELLED' ? '취소' : o.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

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
                          <span
                            className="text-theme-text-muted cursor-help"
                            title={`Gate Score: ${w.gateScore}점\n${GATE_TOOLTIPS[1]}\n${GATE_TOOLTIPS[2]}\n${GATE_TOOLTIPS[3]}`}
                          >G{w.gateScore}</span>
                        )}
                        <span className="text-theme-text-muted">{w.entryPrice.toLocaleString()}</span>
                        <Badge variant={w.addedBy === 'AUTO' ? 'success' : w.addedBy === 'DART' ? 'violet' : 'default'} size="sm">
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

        </>}
      </Stack>
    </motion.div>
  );
}
