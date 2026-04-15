import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Activity, Eye, Briefcase, ShieldAlert, BarChart3, Settings2, Sliders } from 'lucide-react';
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
import { useShadowTradeStore, useShadowWinRate, useShadowAvgReturn } from '../stores/useShadowTradeStore';

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
  fomcGating: { noNewEntry: boolean; phase: string; kellyMultiplier: number; description: string };
  emergencyStop: boolean;
  lastScanAt: string | null;
  rejectedStocks: { code: string; name: string; reason: string }[];
}

// 아이디어 11: Gate 조건 통과율 히트맵
type GateAuditData = Record<string, { passed: number; failed: number }>;

export function AutoTradePage() {
  const { shadowTrades } = useShadowTradeStore();
  const winRate = useShadowWinRate();
  const avgReturn = useShadowAvgReturn();

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

        {/* KPI Strip — Neo-Brutalism Large Scoreboard */}
        <KpiStrip size="lg" items={[
          { label: 'Shadow 건수', value: shadowTrades.length, status: 'neutral' },
          { label: '적중률', value: `${winRate}%`, status: winRate >= 60 ? 'pass' : winRate >= 40 ? 'warn' : 'fail', change: winRate >= 50 ? '목표 충족' : '목표 미달' },
          { label: '평균수익', value: `${avgReturn.toFixed(2)}%`, status: avgReturn >= 0 ? 'pass' : 'fail', trend: avgReturn >= 0 ? 'up' : 'down' },
        ]} />

        {/* Tab Switcher: 대시보드 / 트레이딩 설정 */}
        <div className="flex items-center gap-2 p-1 bg-white/5 rounded-xl border border-theme-border w-fit">

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
                  {buyAudit.vixGating.noNewEntry ? '차단됨' : `정상 (베팅 비율 x${buyAudit.vixGating.kellyMultiplier.toFixed(2)})`}
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

        </>}
      </Stack>
    </motion.div>
  );
}
