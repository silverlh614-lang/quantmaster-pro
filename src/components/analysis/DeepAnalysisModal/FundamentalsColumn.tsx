// @responsibility analysis 영역 FundamentalsColumn 컴포넌트
import React from 'react';
import { BarChart3, ShieldCheck } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { usePriceCanon } from '../../../hooks/usePriceCanon';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

// 0 / 미정의 값은 "—" 로 표시. AI 플레이스홀더와 실데이터 0 을 구분하기 어려워
// "데이터 없음"은 dash, 값이 있으면 그대로 렌더한다.
function fmtRatio(v: number, suffix: string): string {
  return v > 0 ? `${v.toFixed(v >= 10 ? 1 : 2)}${suffix}` : '—';
}

function fmtPct(v: number): string {
  return v !== 0 ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : '—';
}

function fmtDebt(v: number): string {
  return v > 0 ? `${v.toFixed(1)}%` : '—';
}

function FundamentalMetricCard({
  label,
  description,
  value,
  valueClassName = 'text-white',
}: {
  label: string;
  description: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="bg-white/5 p-5 rounded-3xl border border-white/5 group/fund hover:bg-white/10 transition-all">
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">{label}</span>
          <p className="text-[10px] text-white/40 font-bold leading-tight max-w-[200px]">{description}</p>
        </div>
        <span className={cn('text-2xl font-black', valueClassName)}>{value}</span>
      </div>
    </div>
  );
}

function EconomicMoatCard({ stock }: Props) {
  if (!stock.economicMoat) return null;
  return (
    <div className="bg-blue-500/5 p-5 rounded-3xl border border-blue-500/10 group/moat hover:bg-blue-500/10 transition-all">
      <div className="flex items-center gap-3 mb-2">
        <ShieldCheck className="w-4 h-4 text-blue-400" />
        <span className="text-[10px] font-black text-blue-400/60 uppercase tracking-widest">Economic Moat: {stock.economicMoat.type}</span>
      </div>
      <p className="text-xs text-white/70 font-bold leading-relaxed">
        {stock.economicMoat.description}
      </p>
    </div>
  );
}

function FundamentalMetricGrid({ stock }: Props) {
  // PER/PBR 정본 — stock.valuation(AI 채움, 종목마다 누락) 우선, 없으면 Naver 스냅샷 fallback.
  // usePriceCanon 이 같은 스냅샷에서 파생하므로 후보 대시보드/검색 어느 경로든 동일 표시.
  const { per: naverPer, pbr: naverPbr } = usePriceCanon(stock.code);
  const per = Number(stock.valuation?.per) || naverPer || 0;
  const pbr = Number(stock.valuation?.pbr) || naverPbr || 0;
  const epsGrowth = Number(stock.valuation?.epsGrowth) || 0;
  const debtRatio = Number(stock.valuation?.debtRatio) || 0;

  return (
    <div className="grid grid-cols-1 gap-4 mb-8">
      <FundamentalMetricCard
        label="P/E Ratio (PER)"
        description="주가수익비율: 이익 대비 주가 수준 (낮을수록 저평가)"
        value={fmtRatio(per, 'x')}
      />
      <FundamentalMetricCard
        label="P/B Ratio (PBR)"
        description="주가순자산비율: 자산 가치 대비 주가 (1미만 시 장부가 미달)"
        value={fmtRatio(pbr, 'x')}
      />
      <FundamentalMetricCard
        label="EPS Growth"
        description="주당순이익 성장률: 기업의 수익성 성장 속도"
        value={fmtPct(epsGrowth)}
        valueClassName={epsGrowth > 0 ? 'text-green-400' : epsGrowth < 0 ? 'text-red-400' : 'text-white/40'}
      />
      <FundamentalMetricCard
        label="Debt Ratio"
        description="부채비율: 재무 건전성 및 리스크 지표 (낮을수록 안전)"
        value={fmtDebt(debtRatio)}
      />
      <EconomicMoatCard stock={stock} />
    </div>
  );
}

function RoeMetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
      <span className="text-[8px] font-black text-white/20 uppercase block mb-1">{label}</span>
      <span className="text-xs font-black text-white">{value}</span>
    </div>
  );
}

function RoeAnalysisSection({ stock }: Props) {
  if (!stock?.roeAnalysis) {
    return <p className="text-sm text-white/30">ROE 분석 데이터 없음</p>;
  }
  return (
    <div className="space-y-4 border-t border-white/5 pt-6">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">ROE Analysis & DuPont</span>
        <span className="text-xs font-black text-orange-400">{stock.roeType}</span>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
          <span className="text-[9px] font-black text-white/30 uppercase block mb-2">Historical Trend</span>
          <p className="text-xs text-white/70 font-bold leading-relaxed">{stock.roeAnalysis.historicalTrend}</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <RoeMetricBox label="Margin" value={`${(stock.roeAnalysis.metrics.netProfitMargin * 100).toFixed(1)}%`} />
          <RoeMetricBox label="Turnover" value={`${stock.roeAnalysis.metrics.assetTurnover.toFixed(2)}x`} />
          <RoeMetricBox label="Leverage" value={`${stock.roeAnalysis.metrics.equityMultiplier.toFixed(2)}x`} />
        </div>

        <div className="bg-orange-500/5 p-4 rounded-2xl border border-orange-500/10">
          <span className="text-[9px] font-black text-orange-500/40 uppercase block mb-2">Strategic Drivers</span>
          <div className="flex flex-wrap gap-2">
            {(stock.roeAnalysis.drivers || []).map((driver, i) => (
              <span key={i} className="text-[10px] px-2 py-1 rounded-md bg-orange-500/10 text-orange-400 font-black border border-orange-500/10">
                {driver}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-orange-500/5 p-4 rounded-2xl border border-orange-500/10">
          <span className="text-[9px] font-black text-orange-500/40 uppercase block mb-2">DuPont Strategy</span>
          <p className="text-xs text-orange-500/80 font-bold leading-relaxed italic">{stock.roeAnalysis.strategy}</p>
        </div>
      </div>
    </div>
  );
}

function PriceActionCard({
  label,
  value,
  subValue,
  className,
  valueClassName,
  labelClassName,
  subValueClassName,
}: {
  label: string;
  value: string;
  subValue?: string;
  className: string;
  valueClassName: string;
  labelClassName: string;
  subValueClassName?: string;
}) {
  return (
    <div className={cn('rounded-2xl p-4 border text-center', className)}>
      <span className={cn('text-[9px] font-black uppercase tracking-widest block mb-1', labelClassName)}>{label}</span>
      <span className={valueClassName}>{value}</span>
      {subValue && <span className={cn('text-[10px] block', subValueClassName)}>{subValue}</span>}
    </div>
  );
}

function PriceActionCards({ stock }: Props) {
  return (
    <div className="grid grid-cols-3 gap-3 mt-4">
      <PriceActionCard
        label="Entry"
        value={`₩${stock.entryPrice?.toLocaleString() || stock.currentPrice?.toLocaleString() || '---'}`}
        subValue={stock.entryPrice2 ? `~ ₩${stock.entryPrice2.toLocaleString()}` : undefined}
        className="bg-blue-500/10 border-blue-500/20"
        labelClassName="text-blue-400/60"
        valueClassName="text-lg font-black text-white"
        subValueClassName="text-blue-400/50"
      />
      <PriceActionCard
        label="Target"
        value={`₩${stock.targetPrice?.toLocaleString() || '---'}`}
        subValue={`+${Math.round(((stock.targetPrice || 0) / (stock.currentPrice || 1) - 1) * 100)}%`}
        className="bg-orange-500/10 border-orange-500/20"
        labelClassName="text-orange-400/60"
        valueClassName="text-lg font-black text-orange-400"
        subValueClassName="text-orange-400/50"
      />
      <PriceActionCard
        label="Stop"
        value={`₩${stock.stopLoss?.toLocaleString() || '---'}`}
        subValue={`${Math.round(((stock.stopLoss || 0) / (stock.currentPrice || 1) - 1) * 100)}%`}
        className="bg-red-500/10 border-red-500/20"
        labelClassName="text-red-400/60"
        valueClassName="text-lg font-black text-red-400"
        subValueClassName="text-red-400/50"
      />
    </div>
  );
}

export function FundamentalsColumn({ stock }: Props) {
  return (
    <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="w-5 h-5 text-orange-400" />
        <h3 className="text-lg font-black text-white uppercase tracking-tight">Fundamental Insights</h3>
      </div>

      <FundamentalMetricGrid stock={stock} />
      <RoeAnalysisSection stock={stock} />
      <PriceActionCards stock={stock} />
    </div>
  );
}
