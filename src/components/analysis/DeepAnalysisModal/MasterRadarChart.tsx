// @responsibility DeepAnalysisModal 27단계 마스터 레이더 차트 sub-component (cc 분해)
import { Radar } from 'lucide-react';
import {
  Radar as RechartsRadar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import type { StockRecommendation } from '../../../services/stockService';
import { buildStockAnalysisCanon } from '../../../services/stock/stockAnalysisCanon';

// 레이더·카운트는 모두 분석 표시 정본(stockAnalysisCanon)에서 파생 — 위젯 간 소스 통일(SSOT).
export function getRadarData(stock: StockRecommendation): Array<{ subject: string; A: number; fullMark: number }> {
  return buildStockAnalysisCanon(stock).radar;
}

export function getPassedConditionCount(stock: StockRecommendation): number {
  return buildStockAnalysisCanon(stock).verifiedPassCount;
}

interface MasterRadarChartProps {
  stock: StockRecommendation;
}

export function MasterRadarChart({ stock }: MasterRadarChartProps) {
  const canon = buildStockAnalysisCanon(stock);
  return (
    <div className="glass-3d rounded-2xl p-5 sm:p-6 border border-white/[0.07] flex flex-col">
      <div className="w-full flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Radar className="w-5 h-5 text-orange-500" />
          <span className="text-[10px] font-black text-white/30 tracking-tight">
            27단계 마스터 레이더
          </span>
        </div>
        <div className="px-3 py-1 bg-orange-500/10 rounded-lg border border-orange-500/20" title="검증=실데이터(DART/KRX/계산) 확인 · 충족=AI 추정 포함">
          <span className="text-[11px] font-black text-orange-500">
            검증 {canon.verifiedPassCount} · 충족 {canon.metCount}
          </span>
        </div>
      </div>

      <div className="w-full h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="78%" data={canon.radar}>
            <PolarGrid stroke="rgba(255,255,255,0.1)" />
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 800 }}
            />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
            <RechartsRadar
              name={stock.name}
              dataKey="A"
              stroke="#f97316"
              fill="#f97316"
              fillOpacity={0.5}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
