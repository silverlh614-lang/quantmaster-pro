import React from 'react';
import { BarChart3, ShieldCheck } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function FundamentalsColumn({ stock }: Props) {
  // 0 / 미정의 값은 "—" 로 표시. AI 플레이스홀더와 실데이터 0 을 구분하기 어려워
  // "데이터 없음"은 dash, 값이 있으면 그대로 렌더한다.
  const per = Number(stock.valuation?.per) || 0;
  const pbr = Number(stock.valuation?.pbr) || 0;
  const epsGrowth = Number(stock.valuation?.epsGrowth) || 0;
  const debtRatio = Number(stock.valuation?.debtRatio) || 0;
  const fmtRatio = (v: number, suffix: string) => (v > 0 ? `${v.toFixed(v >= 10 ? 1 : 2)}${suffix}` : '—');
  const fmtPct = (v: number) => (v !== 0 ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : '—');
  const fmtDebt = (v: number) => (v > 0 ? `${v.toFixed(1)}%` : '—');

  return (
    <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="w-5 h-5 text-orange-400" />
        <h3 className="text-lg font-black text-white uppercase tracking-tight">Fundamental Insights</h3>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8">
        <div className="bg-white/5 p-5 rounded-3xl border border-white/5 group/fund hover:bg-white/10 transition-all">
          <div className="flex justify-between items-start mb-2">
            <div>
              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">P/E Ratio (PER)</span>
              <p className="text-[10px] text-white/40 font-bold leading-tight max-w-[200px]">주가수익비율: 이익 대비 주가 수준 (낮을수록 저평가)</p>
            </div>
            <span className="text-2xl font-black text-white">{fmtRatio(per, 'x')}</span>
          </div>
        </div>

        <div className="bg-white/5 p-5 rounded-3xl border border-white/5 group/fund hover:bg-white/10 transition-all">
          <div className="flex justify-between items-start mb-2">
            <div>
              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">P/B Ratio (PBR)</span>
              <p className="text-[10px] text-white/40 font-bold leading-tight max-w-[200px]">주가순자산비율: 자산 가치 대비 주가 (1미만 시 장부가 미달)</p>
            </div>
            <span className="text-2xl font-black text-white">{fmtRatio(pbr, 'x')}</span>
          </div>
        </div>

        <div className="bg-white/5 p-5 rounded-3xl border border-white/5 group/fund hover:bg-white/10 transition-all">
          <div className="flex justify-between items-start mb-2">
            <div>
              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">EPS Growth</span>
              <p className="text-[10px] text-white/40 font-bold leading-tight max-w-[200px]">주당순이익 성장률: 기업의 수익성 성장 속도</p>
            </div>
            <span className={cn("text-2xl font-black", epsGrowth > 0 ? "text-green-400" : epsGrowth < 0 ? "text-red-400" : "text-white/40")}>
              {fmtPct(epsGrowth)}
            </span>
          </div>
        </div>

        <div className="bg-white/5 p-5 rounded-3xl border border-white/5 group/fund hover:bg-white/10 transition-all">
          <div className="flex justify-between items-start mb-2">
            <div>
              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">Debt Ratio</span>
              <p className="text-[10px] text-white/40 font-bold leading-tight max-w-[200px]">부채비율: 재무 건전성 및 리스크 지표 (낮을수록 안전)</p>
            </div>
            <span className="text-2xl font-black text-white">{fmtDebt(debtRatio)}</span>
          </div>
        </div>

        {stock.economicMoat && (
          <div className="bg-blue-500/5 p-5 rounded-3xl border border-blue-500/10 group/moat hover:bg-blue-500/10 transition-all">
            <div className="flex items-center gap-3 mb-2">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              <span className="text-[10px] font-black text-blue-400/60 uppercase tracking-widest">Economic Moat: {stock.economicMoat.type}</span>
            </div>
            <p className="text-xs text-white/70 font-bold leading-relaxed">
              {stock.economicMoat.description}
            </p>
          </div>
        )}
      </div>

      {stock?.roeAnalysis ? (
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
              <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
                <span className="text-[8px] font-black text-white/20 uppercase block mb-1">Margin</span>
                <span className="text-xs font-black text-white">{(stock.roeAnalysis.metrics.netProfitMargin * 100).toFixed(1)}%</span>
              </div>
              <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
                <span className="text-[8px] font-black text-white/20 uppercase block mb-1">Turnover</span>
                <span className="text-xs font-black text-white">{stock.roeAnalysis.metrics.assetTurnover.toFixed(2)}x</span>
              </div>
              <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
                <span className="text-[8px] font-black text-white/20 uppercase block mb-1">Leverage</span>
                <span className="text-xs font-black text-white">{stock.roeAnalysis.metrics.equityMultiplier.toFixed(2)}x</span>
              </div>
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
      ) : (
        <p className="text-sm text-white/30">ROE 분석 데이터 없음</p>
      )}

      {/* Price Action Cards */}
      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="bg-blue-500/10 rounded-2xl p-4 border border-blue-500/20 text-center">
          <span className="text-[9px] font-black text-blue-400/60 uppercase tracking-widest block mb-1">Entry</span>
          <span className="text-lg font-black text-white">
            ₩{stock.entryPrice?.toLocaleString() || stock.currentPrice?.toLocaleString() || '---'}
          </span>
          {stock.entryPrice2 && (
            <span className="text-[10px] text-blue-400/50 block">~ ₩{stock.entryPrice2.toLocaleString()}</span>
          )}
        </div>
        <div className="bg-orange-500/10 rounded-2xl p-4 border border-orange-500/20 text-center">
          <span className="text-[9px] font-black text-orange-400/60 uppercase tracking-widest block mb-1">Target</span>
          <span className="text-lg font-black text-orange-400">
            ₩{stock.targetPrice?.toLocaleString() || '---'}
          </span>
          <span className="text-[10px] text-orange-400/50 block">
            +{Math.round(((stock.targetPrice || 0) / (stock.currentPrice || 1) - 1) * 100)}%
          </span>
        </div>
        <div className="bg-red-500/10 rounded-2xl p-4 border border-red-500/20 text-center">
          <span className="text-[9px] font-black text-red-400/60 uppercase tracking-widest block mb-1">Stop</span>
          <span className="text-lg font-black text-red-400">
            ₩{stock.stopLoss?.toLocaleString() || '---'}
          </span>
          <span className="text-[10px] text-red-400/50 block">
            {Math.round(((stock.stopLoss || 0) / (stock.currentPrice || 1) - 1) * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
