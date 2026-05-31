// @responsibility analysis 영역 SentimentSection 컴포넌트
import React from 'react';
import { TrendingUp, TrendingDown, Minus, Users, Newspaper } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { toKoLabel } from '../../../utils/displayLabels';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

function resolveAnalystConsensusClass(consensus: string | undefined): string {
  if (consensus?.toLowerCase().includes('buy') ?? false) return 'bg-green-500/20 text-green-400';
  if (consensus?.toLowerCase().includes('sell') ?? false) return 'bg-red-500/20 text-red-400';
  return 'bg-gray-500/20 text-gray-400';
}

function AnalystRatingStat({ label, value, className }: { label: string; value: number | undefined; className: string }) {
  return (
    <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
      <span className="text-[10px] font-black text-white/40 uppercase block mb-1">{label}</span>
      <span className={cn('text-xl font-black', className)}>{value}</span>
    </div>
  );
}

function AnalystTargetPriceRange({ stock }: Props) {
  return (
    <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
      <span className="text-[10px] font-black text-white/40 uppercase block mb-2">목표주가 범위</span>
      <div className="flex justify-between items-center">
        <span className="text-sm font-black text-white/60">₩{stock.analystRatings?.targetPriceLow?.toLocaleString() || '0'}</span>
        <div className="flex-1 h-1 bg-white/10 mx-4 rounded-full relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-blue-400 rounded-full shadow-[0_0_10px_rgba(96,165,250,0.5)]" />
        </div>
        <span className="text-sm font-black text-white/60">₩{stock.analystRatings?.targetPriceHigh?.toLocaleString() || '0'}</span>
      </div>
      <div className="text-center mt-2">
        <span className="text-xs font-black text-blue-400">평균: ₩{stock.analystRatings?.targetPriceAvg?.toLocaleString() || '0'}</span>
      </div>
    </div>
  );
}

function AnalystSentimentCard({ stock }: Props) {
  return (
    <div className="bg-white/5 rounded-2xl p-6 border border-white/[0.07]">
      <div className="flex items-center gap-3 mb-4">
        <Users className="w-5 h-5 text-blue-400" />
        <h3 className="text-lg font-black text-white uppercase tracking-tight">애널리스트 심리</h3>
      </div>
      {stock.analystRatings ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-black text-white/60 tracking-tight">컨센서스</span>
            <span className={cn('text-sm px-3 py-1 rounded-full font-black tracking-widest', resolveAnalystConsensusClass(stock.analystRatings.consensus))}>
              {toKoLabel(stock.analystRatings.consensus)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <AnalystRatingStat label="적극 매수" value={stock.analystRatings?.strongBuy} className="text-red-500" />
            <AnalystRatingStat label="매수" value={stock.analystRatings?.buy} className="text-orange-400" />
            <AnalystRatingStat label="적극 매도" value={stock.analystRatings?.strongSell} className="text-blue-600" />
            <AnalystRatingStat label="매도" value={stock.analystRatings?.sell} className="text-blue-400" />
          </div>

          <AnalystTargetPriceRange stock={stock} />

          {stock.analystSentiment && (
            <p className="text-sm text-white/70 leading-relaxed font-bold italic border-l-2 border-blue-500/30 pl-4 break-words">
              "{stock.analystSentiment}"
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-white/30 font-bold">애널리스트 데이터 없음</p>
      )}
    </div>
  );
}

function resolveNewsStatusClass(status: string): string {
  if (status === 'POSITIVE') return 'bg-emerald-500/20 text-emerald-400';
  if (status === 'NEGATIVE') return 'bg-red-500/20 text-red-400';
  return 'bg-gray-500/20 text-gray-400';
}

function NewsStatusIcon({ status }: { status: string }) {
  return (
    <>
      {status === 'POSITIVE' && <TrendingUp className="w-4 h-4" />}
      {status === 'NEGATIVE' && <TrendingDown className="w-4 h-4" />}
      {status === 'NEUTRAL' && <Minus className="w-4 h-4" />}
    </>
  );
}

function NewsSentimentScore({ score }: { score: number }) {
  return (
    <div className="bg-black/20 p-6 rounded-3xl border border-white/5 relative overflow-hidden">
      <div className="relative z-10 flex flex-col items-center">
        <span className="text-[10px] font-black text-white/40 tracking-tight mb-2">심리 점수</span>
        <div className="text-5xl font-black mb-2" style={{
          color: score >= 60 ? '#34d399' : score <= 40 ? '#f87171' : '#9ca3af',
        }}>
          {score}
        </div>
        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mt-4">
          <div
            className={cn('h-full rounded-full transition-all duration-1000',
              score >= 60 ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]' :
                score <= 40 ? 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.5)]' : 'bg-gray-400'
            )}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
    </div>
  );
}

function NewsSentimentCard({ stock }: Props) {
  return (
    <div className="bg-white/5 rounded-2xl p-6 border border-white/[0.07]">
      <div className="flex items-center gap-3 mb-4">
        <Newspaper className="w-5 h-5 text-emerald-400" />
        <h3 className="text-lg font-black text-white uppercase tracking-tight">뉴스 심리</h3>
      </div>
      {stock.newsSentiment ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-black text-white/60 tracking-tight">상태</span>
            <span className={cn('text-sm px-3 py-1 rounded-full font-black tracking-widest flex items-center gap-2', resolveNewsStatusClass(stock.newsSentiment.status))}>
              <NewsStatusIcon status={stock.newsSentiment.status} />
              {toKoLabel(stock.newsSentiment.status)}
            </span>
          </div>

          <NewsSentimentScore score={stock.newsSentiment.score} />

          <p className="text-sm text-white/80 leading-relaxed font-bold bg-white/5 p-5 rounded-2xl border border-white/5 break-words">
            {stock.newsSentiment.summary}
          </p>
        </div>
      ) : (
        <p className="text-sm text-white/30 font-bold">뉴스 심리 데이터 없음</p>
      )}
    </div>
  );
}

export function SentimentSection({ stock }: Props) {
  return (
    <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-6">
      <AnalystSentimentCard stock={stock} />
      <NewsSentimentCard stock={stock} />
    </div>
  );
}
