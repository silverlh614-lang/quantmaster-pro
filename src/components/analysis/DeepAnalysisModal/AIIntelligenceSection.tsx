import React from 'react';
import {
  TrendingUp, TrendingDown, Info, Zap, Star, ArrowUpRight, ArrowDownRight,
  Brain, Target, Flame, FileText, CheckCircle2, Clock, History,
  Sparkles, Radar, Hash, Lightbulb
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../../ui/cn';
import { getMarketPhaseInfo } from '../../../constants/checklist';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function AIIntelligenceSection({ stock }: Props) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-6 px-4">
        <div className="w-1.5 h-6 bg-orange-500 rounded-full" />
        <h3 className="text-xl font-black text-white uppercase tracking-tighter">AI Advanced Intelligence</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* AI Conviction Score */}
        <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
            <Brain className="w-12 h-12 text-orange-500" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
              <Target className="w-5 h-5 text-orange-500" />
            </div>
            <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">AI Conviction Score</span>
          </div>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-4xl font-black text-white tracking-tighter">{stock.aiConvictionScore?.totalScore || 0}</span>
            <span className="text-sm font-bold text-white/20">/ 100</span>
          </div>
          <div className="bg-orange-500/10 p-3 rounded-xl border border-orange-500/20 mb-4">
            <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest block mb-1">Market Context Weighting</span>
            <p className="text-[11px] text-orange-400/80 font-bold leading-tight">
              {stock.aiConvictionScore?.description}
            </p>
          </div>
          <div className="space-y-2 mb-4">
            {(stock.aiConvictionScore?.factors || []).map((f, i) => (
              <div key={i} className="flex items-center justify-between text-[10px]">
                <span className="text-white/40 font-bold">{f.name}</span>
                <div className="flex items-center gap-2 flex-1 mx-4">
                  <div className="h-1 bg-white/5 flex-1 rounded-full overflow-hidden">
                    <div className="h-full bg-orange-500/50" style={{ width: `${f.score}%` }} />
                  </div>
                </div>
                <span className="text-white/60 font-black">{f.score}</span>
              </div>
            ))}
          </div>
          <div className="pt-4 border-t border-white/5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className={cn(
                "px-2 py-0.5 rounded text-[8px] font-black uppercase",
                stock.aiConvictionScore?.marketPhase === 'RISK_ON' || stock.aiConvictionScore?.marketPhase === 'BULL' ? "bg-green-500/20 text-green-400" :
                stock.aiConvictionScore?.marketPhase === 'RISK_OFF' || stock.aiConvictionScore?.marketPhase === 'BEAR' ? "bg-red-500/20 text-red-400" :
                stock.aiConvictionScore?.marketPhase === 'SIDEWAYS' ? "bg-blue-500/20 text-blue-400" :
                stock.aiConvictionScore?.marketPhase === 'TRANSITION' ? "bg-purple-500/20 text-purple-400" :
                "bg-white/10 text-white/40"
              )}>
                {getMarketPhaseInfo(stock.aiConvictionScore?.marketPhase).label}
              </div>
              <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Phase Analysis</span>
            </div>

            <div className="bg-white/5 rounded-xl p-3 border border-white/5 mb-3">
              <div className="flex items-center gap-2 mb-1">
                <Lightbulb className="w-3 h-3 text-yellow-500" />
                <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Recommendation</span>
              </div>
              <p className="text-[11px] text-white/80 font-bold leading-relaxed">
                {getMarketPhaseInfo(stock.aiConvictionScore?.marketPhase).recommendation}
              </p>
            </div>

            <p className="text-[11px] text-white/40 leading-relaxed font-medium italic break-words">
              {stock.aiConvictionScore?.description}
            </p>
          </div>
        </div>

        {/* Catalyst Analysis */}
        <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
            <Zap className="w-12 h-12 text-orange-500" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
              <Flame className="w-5 h-5 text-orange-500" />
            </div>
            <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Catalyst Analysis</span>
          </div>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-4xl font-black text-white tracking-tighter">{stock.catalystDetail?.score || 0}</span>
            <span className="text-sm font-bold text-white/20">/ 20 bonus</span>
            {stock.catalystSummary && (
              <span className="ml-auto px-3 py-1 rounded-full bg-yellow-500/20 border border-yellow-500/30 text-[10px] font-black text-yellow-500 uppercase tracking-widest">
                {stock.catalystSummary}
              </span>
            )}
          </div>
          <div className="space-y-4">
            <div>
              <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-2">Key Catalyst</span>
              <p className="text-xs text-white/70 font-bold leading-relaxed">
                {stock.catalystDetail?.description || '발굴된 촉매제가 없습니다.'}
              </p>
            </div>
            {stock.catalystDetail?.upcomingEvents && stock.catalystDetail.upcomingEvents.length > 0 && (
              <div>
                <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-2">Upcoming Events</span>
                <div className="space-y-1.5">
                  {(stock.catalystDetail?.upcomingEvents || []).map((event, i) => (
                    <div key={i} className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
                      <Clock className="w-3 h-3 text-orange-500" />
                      <span className="text-[10px] font-bold text-white/60">{event}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Visual Report Summary */}
        <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
            <FileText className="w-12 h-12 text-orange-500" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
              <CheckCircle2 className="w-5 h-5 text-orange-500" />
            </div>
            <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Visual Report</span>
          </div>
          <div className="grid grid-cols-1 gap-3 mb-4">
            {[
              { label: 'Financial', grade: stock.visualReport?.financial, color: 'text-blue-400' },
              { label: 'Technical', grade: stock.visualReport?.technical, color: 'text-orange-400' },
              { label: 'Supply', grade: stock.visualReport?.supply, color: 'text-green-400' }
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">{item.label}</span>
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map(star => (
                      <Star
                        key={star}
                        className={cn(
                          "w-2.5 h-2.5",
                          star <= (6 - (item.grade || 5)) ? item.color + " fill-current" : "text-white/10"
                        )}
                      />
                    ))}
                  </div>
                  <span className={cn("text-xs font-black", item.color)}>{item.grade}등급</span>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">AI Verdict</span>
            <p className="text-[11px] text-white/70 font-bold leading-tight italic">
              "{stock.visualReport?.summary}"
            </p>
          </div>
        </div>

        {/* KIS 실시간 수급 카드 */}
        {stock.supplyData && (
          <div className="glass-3d rounded-[2.5rem] p-8 border border-white/10 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                <TrendingUp className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <span className="text-[10px] font-black text-blue-400/60 uppercase tracking-widest block">KIS 실계산</span>
                <h3 className="text-sm font-black text-white uppercase tracking-tight">외국인 / 기관 수급</h3>
              </div>
              <span className="ml-auto text-[9px] font-black text-blue-400/50 bg-blue-500/10 px-2 py-1 rounded-lg border border-blue-500/20 uppercase tracking-widest">
                실데이터
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">외국인 5일 순매수</span>
                <span className={cn(
                  "text-xl font-black",
                  stock.supplyData.foreignNet > 0 ? "text-red-400" : "text-blue-400"
                )}>
                  {stock.supplyData.foreignNet > 0 ? '+' : ''}
                  {stock.supplyData.foreignNet.toLocaleString()}주
                </span>
                <span className="text-[10px] text-white/30 block mt-1">
                  연속 {stock.supplyData.foreignConsecutive}일 순매수
                </span>
              </div>
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">기관 5일 순매수</span>
                <span className={cn(
                  "text-xl font-black",
                  stock.supplyData.institutionNet > 0 ? "text-red-400" : "text-blue-400"
                )}>
                  {stock.supplyData.institutionNet > 0 ? '+' : ''}
                  {stock.supplyData.institutionNet.toLocaleString()}주
                </span>
                <span className="text-[10px] text-white/30 block mt-1">
                  {stock.supplyData.individualNet < 0 ? '개인 매도' : '개인 매수'} 동반
                </span>
              </div>
            </div>

            <div className={cn(
              "p-4 rounded-2xl border",
              stock.supplyData.isPassiveAndActive
                ? "bg-red-500/10 border-red-500/20"
                : "bg-white/5 border-white/10"
            )}>
              <div className="flex items-center gap-2">
                {stock.supplyData.isPassiveAndActive
                  ? <Zap className="w-4 h-4 text-red-400 fill-current" />
                  : <Info className="w-4 h-4 text-white/30" />
                }
                <span className={cn(
                  "text-xs font-black uppercase tracking-widest",
                  stock.supplyData.isPassiveAndActive ? "text-red-400" : "text-white/30"
                )}>
                  {stock.supplyData.isPassiveAndActive
                    ? 'P+A 동반매수 — 가장 강한 수급 신호'
                    : '단일 주체 매수 — 수급 신호 보통'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Short Selling */}
        <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
            <TrendingDown className="w-12 h-12 text-red-500" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
              <TrendingDown className="w-5 h-5 text-red-500" />
            </div>
            <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Short Selling</span>
          </div>
          {stock.shortSelling ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/10">
                <div>
                  <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">공매도 비율</span>
                  <span className="text-2xl font-black text-white">{stock.shortSelling.ratio}%</span>
                </div>
                <div className={cn("flex items-center gap-2 font-black",
                  stock.shortSelling.trend === 'DECREASING' ? "text-green-400" : "text-red-400"
                )}>
                  {stock.shortSelling.trend === 'DECREASING'
                    ? <ArrowDownRight className="w-5 h-5" />
                    : <ArrowUpRight className="w-5 h-5" />}
                  <span className="text-sm">{stock.shortSelling.trend}</span>
                </div>
              </div>
              <div className="bg-orange-500/10 p-4 rounded-2xl border border-orange-500/20">
                <p className="text-[11px] text-orange-400/90 font-bold leading-relaxed">
                  {stock.shortSelling.implication}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-white/20">
              <Info className="w-8 h-8 mb-3 opacity-20" />
              <p className="text-xs font-black uppercase tracking-widest">데이터 분석 중...</p>
            </div>
          )}
        </div>

        {/* Tenbagger DNA */}
        <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
            <Sparkles className="w-12 h-12 text-blue-400" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
              <Sparkles className="w-5 h-5 text-blue-400" />
            </div>
            <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Tenbagger DNA</span>
          </div>
          {stock.tenbaggerDNA ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/10">
                <div>
                  <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">매칭 패턴</span>
                  <span className="text-sm font-black text-white">{stock.tenbaggerDNA.matchPattern}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">유사도</span>
                  <span className="text-2xl font-black text-blue-400">{stock.tenbaggerDNA.similarity}%</span>
                </div>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${stock.tenbaggerDNA.similarity}%` }}
                  className="h-full bg-gradient-to-r from-blue-600 to-blue-400"
                />
              </div>
              <div className="bg-blue-500/10 p-4 rounded-2xl border border-blue-500/20">
                <p className="text-[11px] text-blue-400/90 font-bold leading-relaxed">
                  {stock.tenbaggerDNA.reason}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-white/20">
              <Info className="w-8 h-8 mb-3 opacity-20" />
              <p className="text-xs font-black uppercase tracking-widest">패턴 분석 중...</p>
            </div>
          )}
        </div>

        {/* Historical Analogy */}
        <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
            <History className="w-12 h-12 text-blue-500" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
              <History className="w-5 h-5 text-blue-500" />
            </div>
            <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Historical Analogy</span>
          </div>
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg font-black text-blue-400">{stock.historicalAnalogy?.stockName}</span>
              <span className="text-xs font-bold text-white/30">({stock.historicalAnalogy?.period})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500" style={{ width: `${stock.historicalAnalogy?.similarity}%` }} />
              </div>
              <span className="text-xs font-black text-blue-400">{stock.historicalAnalogy?.similarity}%</span>
            </div>
            <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Similarity Match</span>
          </div>
          <p className="text-[12px] text-white/70 leading-relaxed font-bold break-words">
            {stock.historicalAnalogy?.reason}
          </p>
        </div>

        {/* Anomaly Detection */}
        <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
            <Radar className="w-12 h-12 text-purple-500" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
              <Radar className="w-5 h-5 text-purple-500" />
            </div>
            <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Anomaly Detection</span>
          </div>
          <div className="mb-4">
            <div className={cn(
              "inline-block px-3 py-1 rounded-full text-[10px] font-black mb-3 border",
              stock.anomalyDetection?.type === 'FUNDAMENTAL_DIVERGENCE' ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
              stock.anomalyDetection?.type === 'SMART_MONEY_ACCUMULATION' ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
              "bg-white/5 text-white/30 border-white/10"
            )}>
              {stock.anomalyDetection?.type?.replace('_', ' ') || 'NONE DETECTED'}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black text-white tracking-tighter">{stock.anomalyDetection?.score || 0}</span>
              <span className="text-[10px] font-bold text-white/20 uppercase">Intensity</span>
            </div>
          </div>
          <p className="text-[12px] text-white/70 leading-relaxed font-bold break-words">
            {stock.anomalyDetection?.description}
          </p>
        </div>

        {/* Semantic Mapping */}
        <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
            <Hash className="w-12 h-12 text-emerald-500" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Hash className="w-5 h-5 text-emerald-500" />
            </div>
            <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Semantic Mapping</span>
          </div>
          <div className="mb-4">
            <span className="text-sm font-black text-emerald-400 block mb-2">{stock.semanticMapping?.theme}</span>
            <div className="flex flex-wrap gap-1.5">
              {(stock.semanticMapping?.keywords || []).map((k, i) => (
                <span key={i} className="text-[9px] font-black px-2 py-0.5 bg-emerald-500/10 text-emerald-400/70 rounded-md border border-emerald-500/20">
                  #{k}
                </span>
              ))}
            </div>
          </div>
          <p className="text-[12px] text-white/70 leading-relaxed font-bold break-words">
            {stock.semanticMapping?.description}
          </p>
        </div>
      </div>
    </div>
  );
}
