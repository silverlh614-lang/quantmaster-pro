// @responsibility 6-layer 매크로 인텔리전스 대시보드 페이지 — global intel store 통합 노출 (ADR-0034 PR-G)

import React from 'react';
import { Activity, Globe, TrendingUp, Truck, AlertTriangle, BarChart3 } from 'lucide-react';
import { cn } from '../ui/cn';
import { useGlobalIntelStore } from '../stores';
import { GlobalCorrelationCard } from '../components/macro/GlobalCorrelationCard';
import { PortfolioCorrelationMatrix } from '../components/macro/PortfolioCorrelationMatrix';

// ─── 공통 카드 ─────────────────────────────────────────────────────────────

interface LayerCardProps {
  title: string;
  icon: React.ReactNode;
  available: boolean;
  children?: React.ReactNode;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}

function LayerCard({ title, icon, available, children, tone = 'neutral' }: LayerCardProps) {
  const toneCls =
    tone === 'good' ? 'border-green-500/30 bg-green-950/30' :
    tone === 'warn' ? 'border-amber-500/30 bg-amber-950/30' :
    tone === 'bad'  ? 'border-red-500/30 bg-red-950/30' :
                      'border-white/10 bg-white/5';
  return (
    <div className={cn('rounded border p-3 sm:p-4 min-h-[120px]', toneCls)} role="region" aria-label={title}>
      <div className="flex items-center gap-1.5 mb-2 text-[10px] font-black uppercase tracking-widest opacity-70">
        {icon}
        <span>{title}</span>
      </div>
      {available ? children : <p className="text-xs opacity-50">데이터 부재 — 매크로 cron 미실행 또는 store 적재 대기</p>}
    </div>
  );
}

function StatRow({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between text-[11px] py-0.5">
      <span className="opacity-70">{label}</span>
      <span className="font-num">
        <span className="font-black text-white/90">{value}</span>
        {sub && <span className="opacity-60 ml-1 text-[10px]">{sub}</span>}
      </span>
    </div>
  );
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

// ─── Layer 1: 매크로 환경 (VKOSPI / DXY / 환율 / IRI) ─────────────────────

function MacroOverviewCard() {
  const macroEnv = useGlobalIntelStore(s => s.macroEnv);
  const tone: LayerCardProps['tone'] =
    !macroEnv ? 'neutral' :
    macroEnv.vkospi >= 30 || macroEnv.samsungIri < 0.7 ? 'bad' :
    macroEnv.vkospi >= 25 ? 'warn' : 'good';
  return (
    <LayerCard
      title="매크로 환경"
      icon={<Activity className="w-3 h-3" />}
      available={!!macroEnv}
      tone={tone}
    >
      {macroEnv && (
        <>
          <StatRow label="VKOSPI" value={fmtNum(macroEnv.vkospi)} sub={macroEnv.vkospi >= 25 ? '경계' : '안정'} />
          <StatRow label="USD/KRW" value={fmtNum(macroEnv.usdKrw, 0)} />
          <StatRow label="VIX" value={fmtNum(macroEnv.vix)} />
          <StatRow label="삼성 IRI" value={fmtNum(macroEnv.samsungIri, 2)} sub={macroEnv.samsungIri < 0.7 ? '매도압력' : ''} />
          <StatRow label="US 10Y" value={fmtNum(macroEnv.us10yYield, 2)} sub="%" />
          <StatRow label="BOK 방향" value={macroEnv.bokRateDirection} />
        </>
      )}
    </LayerCard>
  );
}

// ─── Layer 2: 경기 사이클 (extendedRegimeData) ─────────────────────────────

const REGIME_LABEL_KO: Record<string, string> = {
  RECOVERY: '회복', EXPANSION: '확장', SLOWDOWN: '둔화',
  RECESSION: '침체', UNCERTAIN: '불확실', CRISIS: '위기', RANGE_BOUND: '횡보',
};

function EconomicRegimeCard() {
  const data = useGlobalIntelStore(s => s.extendedRegimeData);
  const tone: LayerCardProps['tone'] =
    !data ? 'neutral' :
    data.regime === 'EXPANSION' || data.regime === 'RECOVERY' ? 'good' :
    data.regime === 'CRISIS' || data.regime === 'RECESSION' ? 'bad' :
    'warn';
  return (
    <LayerCard
      title="경기 사이클"
      icon={<BarChart3 className="w-3 h-3" />}
      available={!!data}
      tone={tone}
    >
      {data && (
        <>
          <StatRow label="레짐" value={REGIME_LABEL_KO[data.regime] ?? data.regime} sub={`${data.confidence}% 신뢰`} />
          <StatRow label="현금 비중 권장" value={`${data.systemAction?.cashRatio ?? '—'}%`} />
          <StatRow label="시스템 모드" value={data.systemAction?.mode ?? '—'} />
          {data.rationale && (
            <p className="mt-2 text-[10px] opacity-60 leading-snug">
              {data.rationale}
            </p>
          )}
        </>
      )}
    </LayerCard>
  );
}

// ─── Layer 3: 외인 수급 (smartMoneyData) ───────────────────────────────────

function SmartMoneyCard() {
  const data = useGlobalIntelStore(s => s.smartMoneyData);
  const tone: LayerCardProps['tone'] =
    !data ? 'neutral' :
    data.signal === 'BULLISH' ? 'good' :
    data.signal === 'BEARISH' ? 'bad' : 'warn';
  return (
    <LayerCard
      title="스마트 머니"
      icon={<TrendingUp className="w-3 h-3" />}
      available={!!data}
      tone={tone}
    >
      {data && (
        <>
          <StatRow label="종합 점수" value={fmtNum(data.score, 1)} sub="/ 10" />
          <StatRow label="시그널" value={data.signal} />
          <StatRow label="EWY+MTUM 동반" value={data.isEwyMtumBothInflow ? '✅' : '⏳'} />
          <StatRow label="선행 시간" value={data.leadTimeWeeks} />
          {data.etfFlows?.length > 0 && (
            <p className="mt-2 text-[10px] opacity-60">
              ETF 흐름 {data.etfFlows.length}건 추적 중
            </p>
          )}
        </>
      )}
    </LayerCard>
  );
}

// ─── Layer 4: 수출 모멘텀 (exportMomentumData) ─────────────────────────────

function ExportMomentumCard() {
  const data = useGlobalIntelStore(s => s.exportMomentumData);
  const tone: LayerCardProps['tone'] =
    !data ? 'neutral' :
    data.hotSectors?.length >= 2 ? 'good' :
    data.hotSectors?.length >= 1 ? 'warn' : 'neutral';
  return (
    <LayerCard
      title="수출 모멘텀"
      icon={<Truck className="w-3 h-3" />}
      available={!!data}
      tone={tone}
    >
      {data && (
        <>
          <StatRow label="Hot 섹터" value={data.hotSectors?.length ?? 0} sub="개" />
          <StatRow label="조선 보너스" value={data.shipyardBonus ? '✅' : '⏳'} />
          <StatRow label="반도체 Gate2 완화" value={data.semiconductorGate2Relax ? '✅' : '⏳'} />
          {data.hotSectors?.length > 0 && (
            <p className="mt-2 text-[10px] opacity-70 leading-snug">
              {data.hotSectors.slice(0, 3).join(' / ')}
            </p>
          )}
        </>
      )}
    </LayerCard>
  );
}

// ─── Layer 5: 지정학 리스크 (geoRiskData) ──────────────────────────────────

function GeopoliticalCard() {
  const data = useGlobalIntelStore(s => s.geoRiskData);
  const tone: LayerCardProps['tone'] =
    !data ? 'neutral' :
    data.level === 'OPPORTUNITY' ? 'good' :
    data.level === 'RISK' ? 'bad' : 'warn';
  return (
    <LayerCard
      title="지정학 리스크"
      icon={<AlertTriangle className="w-3 h-3" />}
      available={!!data}
      tone={tone}
    >
      {data && (
        <>
          <StatRow label="GOS 점수" value={fmtNum(data.score, 1)} sub="/ 10" />
          <StatRow label="등급" value={data.level} />
          <StatRow label="영향 섹터" value={data.affectedSectors?.length ?? 0} sub="개" />
          {data.headlines?.length > 0 && (
            <p className="mt-2 text-[10px] opacity-70 leading-snug truncate" title={data.headlines.join('\n')}>
              {data.headlines[0]}
            </p>
          )}
        </>
      )}
    </LayerCard>
  );
}

// ─── Layer 6: 신용 스프레드 (creditSpreadData) ─────────────────────────────

function CreditSpreadCard() {
  const data = useGlobalIntelStore(s => s.creditSpreadData);
  const tone: LayerCardProps['tone'] =
    !data ? 'neutral' :
    data.isCrisisAlert ? 'bad' :
    data.isLiquidityExpanding ? 'good' : 'warn';
  return (
    <LayerCard
      title="신용 스프레드"
      icon={<Globe className="w-3 h-3" />}
      available={!!data}
      tone={tone}
    >
      {data && (
        <>
          <StatRow label="KR AA-" value={fmtNum(data.krCorporateSpread, 0)} sub="bp" />
          <StatRow label="US HY" value={fmtNum(data.usHySpread, 0)} sub="bp" />
          <StatRow label="EMBI+" value={fmtNum(data.embiSpread, 0)} sub="bp" />
          <StatRow label="추세" value={data.trend} />
          {data.isCrisisAlert && (
            <p className="mt-2 text-[10px] text-red-300 font-bold">⚠️ 신용 위기 경보</p>
          )}
          {data.isLiquidityExpanding && (
            <p className="mt-2 text-[10px] text-green-300 font-bold">✅ 유동성 확장</p>
          )}
        </>
      )}
    </LayerCard>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export function MacroIntelligencePage() {
  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">매크로 인텔리전스</h1>
        <p className="text-xs sm:text-sm text-white/60 mt-1">
          시장 환경 + 경기 사이클 + 외인 수급 + 수출 모멘텀 + 지정학 + 신용 스프레드 6-Layer
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <MacroOverviewCard />
        <EconomicRegimeCard />
        <SmartMoneyCard />
        <ExportMomentumCard />
        <GeopoliticalCard />
        <CreditSpreadCard />
        <GlobalCorrelationCard />
      </section>

      <p className="text-[10px] text-white/40 leading-snug">
        각 카드는 데이터 부재 시 자동 placeholder. 매크로 cron 갱신 주기에 따라 1~24h 차이 가능.
      </p>

      {/* PR-N: 보유 종목 직접 상관관계 매트릭스 */}
      <PortfolioCorrelationMatrix />
    </div>
  );
}
