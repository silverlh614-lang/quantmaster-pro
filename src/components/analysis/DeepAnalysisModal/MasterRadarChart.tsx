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

const RADAR_CATEGORIES: Array<{ name: string; keys: string[] }> = [
  { name: '기본적 분석', keys: ['roeType3', 'earningsSurprise', 'performanceReality', 'ocfQuality', 'marginAcceleration', 'interestCoverage', 'economicMoatVerified'] },
  { name: '기술적 분석', keys: ['momentumRanking', 'ichimokuBreakout', 'technicalGoldenCross', 'volumeSurgeVerified', 'turtleBreakout', 'fibonacciLevel', 'elliottWaveVerified', 'vcpPattern', 'divergenceCheck'] },
  { name: '수급 분석', keys: ['supplyInflow', 'institutionalBuying', 'consensusTarget'] },
  { name: '시장 주도력', keys: ['cycleVerified', 'riskOnEnvironment', 'notPreviousLeader', 'policyAlignment'] },
  { name: '전략/심리', keys: ['mechanicalStop', 'psychologicalObjectivity', 'catalystAnalysis'] },
];

export function getRadarData(stock: StockRecommendation): Array<{ subject: string; A: number; fullMark: number }> {
  return RADAR_CATEGORIES.map((cat) => {
    const passed = cat.keys.filter((key) =>
      stock.checklist ? stock.checklist[key as keyof StockRecommendation['checklist']] : 0
    ).length;
    const total = cat.keys.length;
    return { subject: cat.name, A: Math.round((passed / total) * 100), fullMark: 100 };
  });
}

export function getPassedConditionCount(stock: StockRecommendation): number {
  return Object.values(stock?.checklist || {}).filter(Boolean).length;
}

interface MasterRadarChartProps {
  stock: StockRecommendation;
}

export function MasterRadarChart({ stock }: MasterRadarChartProps) {
  return (
    <div className="glass-3d rounded-2xl p-5 sm:p-6 border border-white/10 flex flex-col">
      <div className="w-full flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Radar className="w-5 h-5 text-orange-500" />
          <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.25em]">
            27단계 마스터 레이더
          </span>
        </div>
        <div className="px-3 py-1 bg-orange-500/10 rounded-lg border border-orange-500/20">
          <span className="text-[11px] font-black text-orange-500">
            {getPassedConditionCount(stock)} / 27
          </span>
        </div>
      </div>

      <div className="w-full h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="78%" data={getRadarData(stock)}>
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
