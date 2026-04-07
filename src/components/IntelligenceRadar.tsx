import React, { useMemo } from 'react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Radar, ResponsiveContainer, Tooltip,
} from 'recharts';
import type {
  Gate0Result, SmartMoneyData, ExportMomentumData, GeopoliticalRiskData,
  CreditSpreadData, GlobalCorrelationMatrix, GlobalMultiSourceData,
  SupplyChainIntelligence, SectorOrderIntelligence, FinancialStressIndex,
  FomcSentimentAnalysis,
} from '../types/quant';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  gate0?: Gate0Result;
  smartMoney?: SmartMoneyData | null;
  exportMomentum?: ExportMomentumData | null;
  geoRisk?: GeopoliticalRiskData | null;
  creditSpread?: CreditSpreadData | null;
  correlation?: GlobalCorrelationMatrix | null;
  multiSource?: GlobalMultiSourceData | null;
  supplyChain?: SupplyChainIntelligence | null;
  sectorOrders?: SectorOrderIntelligence | null;
  fsi?: FinancialStressIndex | null;
  fomcSentiment?: FomcSentimentAnalysis | null;
}

interface RadarPoint {
  layer: string;
  label: string;
  score: number;        // 0-100
  raw: string;          // 원본 값 표시
  status: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNAVAILABLE';
}

// ─── Score Functions ─────────────────────────────────────────────────────────

function scoreMHS(gate0?: Gate0Result): RadarPoint {
  if (!gate0) return { layer: 'A', label: 'MHS 거시건전성', score: 0, raw: 'N/A', status: 'UNAVAILABLE' };
  return {
    layer: 'A', label: 'MHS 거시건전성',
    score: gate0.macroHealthScore,
    raw: `${gate0.macroHealthScore}/100 (${gate0.mhsLevel})`,
    status: gate0.mhsLevel === 'HIGH' ? 'BULLISH' : gate0.mhsLevel === 'MEDIUM' ? 'NEUTRAL' : 'BEARISH',
  };
}

function scoreSmartMoney(data?: SmartMoneyData | null): RadarPoint {
  if (!data) return { layer: 'B', label: 'Smart Money', score: 0, raw: 'N/A', status: 'UNAVAILABLE' };
  const inflowCount = data.etfFlows.filter((f: any) => f.flow === 'INFLOW').length;
  const s = Math.min(100, inflowCount * 20 + (data.isEwyMtumBothInflow ? 20 : 0));
  return { layer: 'B', label: 'Smart Money', score: s, raw: `${inflowCount}/5 유입${data.isEwyMtumBothInflow ? ' + EWY·MTUM 동시' : ''}`, status: s >= 60 ? 'BULLISH' : s >= 30 ? 'NEUTRAL' : 'BEARISH' };
}

function scoreExport(data?: ExportMomentumData | null): RadarPoint {
  if (!data) return { layer: 'C', label: '수출 모멘텀', score: 0, raw: 'N/A', status: 'UNAVAILABLE' };
  const s = Math.min(100, Math.max(0, 50 + (data.hotSectors?.length ?? 0) * 15));
  return { layer: 'C', label: '수출 모멘텀', score: s, raw: `Hot ${data.hotSectors?.length ?? 0}개 섹터`, status: s >= 60 ? 'BULLISH' : s >= 30 ? 'NEUTRAL' : 'BEARISH' };
}

function scoreGeoRisk(data?: GeopoliticalRiskData | null): RadarPoint {
  if (!data) return { layer: 'D', label: '지정학 리스크', score: 0, raw: 'N/A', status: 'UNAVAILABLE' };
  // GOS 높으면 리스크 높음 → 점수 반전 (낮을수록 좋음)
  const s = Math.max(0, 100 - data.score * 10);
  return { layer: 'D', label: '지정학 리스크', score: s, raw: `GOS ${data.score}/10`, status: s >= 60 ? 'BULLISH' : s >= 30 ? 'NEUTRAL' : 'BEARISH' };
}

function scoreCredit(data?: CreditSpreadData | null): RadarPoint {
  if (!data) return { layer: 'E', label: '크레딧 스프레드', score: 0, raw: 'N/A', status: 'UNAVAILABLE' };
  const s = data.isCrisisAlert ? 10 : data.isLiquidityExpanding ? 90 : 60;
  return { layer: 'E', label: '크레딧 스프레드', score: s, raw: data.isCrisisAlert ? '위기 경보' : data.isLiquidityExpanding ? '유동성 확장' : '정상', status: s >= 60 ? 'BULLISH' : s >= 30 ? 'NEUTRAL' : 'BEARISH' };
}

function scoreCorrelation(data?: GlobalCorrelationMatrix | null): RadarPoint {
  if (!data) return { layer: 'F', label: '글로벌 상관관계', score: 0, raw: 'N/A', status: 'UNAVAILABLE' };
  const s = data.isDecoupling ? 30 : data.isGlobalSync ? 50 : 70;
  return { layer: 'F', label: '글로벌 상관관계', score: s, raw: `KOSPI-S&P ${data.kospiSp500?.toFixed(2)}`, status: s >= 60 ? 'BULLISH' : s >= 30 ? 'NEUTRAL' : 'BEARISH' };
}

function scoreMultiSource(data?: GlobalMultiSourceData | null): RadarPoint {
  if (!data) return { layer: 'G', label: '멀티소스 인텔', score: 0, raw: 'N/A', status: 'UNAVAILABLE' };
  let s = 50;
  if (data.fedWatch?.cutProbability > 50) s += 15;
  if (data.chinaPmi?.manufacturing > 50) s += 10;
  if (data.tsmcRevenue?.yoyGrowth > 0) s += 10;
  if (data.usIsm?.manufacturing > 50) s += 10;
  s = Math.min(100, Math.max(0, s));
  return { layer: 'G', label: '멀티소스 인텔', score: s, raw: `Fed Cut ${data.fedWatch?.cutProbability ?? '?'}% / China PMI ${data.chinaPmi?.manufacturing ?? '?'}`, status: s >= 60 ? 'BULLISH' : s >= 30 ? 'NEUTRAL' : 'BEARISH' };
}

function scoreSupplyChain(data?: SupplyChainIntelligence | null): RadarPoint {
  if (!data) return { layer: 'I', label: '공급망 물동량', score: 0, raw: 'N/A', status: 'UNAVAILABLE' };
  let s = 50;
  if (data.bdi.trend === 'SURGING') s += 25;
  else if (data.bdi.trend === 'RISING') s += 15;
  else if (data.bdi.trend === 'FALLING') s -= 15;
  else if (data.bdi.trend === 'COLLAPSING') s -= 25;
  if (data.semiBillings.bookToBill >= 1.1) s += 15;
  s = Math.min(100, Math.max(0, s));
  return { layer: 'I', label: '공급망 물동량', score: s, raw: `BDI ${data.bdi.current.toLocaleString()} / B2B ${data.semiBillings.bookToBill}`, status: s >= 60 ? 'BULLISH' : s >= 30 ? 'NEUTRAL' : 'BEARISH' };
}

function scoreSectorOrders(data?: SectorOrderIntelligence | null): RadarPoint {
  if (!data) return { layer: 'J', label: '글로벌 수주', score: 0, raw: 'N/A', status: 'UNAVAILABLE' };
  let s = 50;
  if (data.globalDefense.trend === 'EXPANDING') s += 15;
  if (data.lngOrders.orderBookMonths > 36) s += 15;
  if (data.smrContracts.timing === 'OPTIMAL') s += 10;
  s = Math.min(100, Math.max(0, s));
  return { layer: 'J', label: '글로벌 수주', score: s, raw: `방산 ${data.globalDefense.trend} / LNG ${data.lngOrders.newOrdersYTD}척`, status: s >= 60 ? 'BULLISH' : s >= 30 ? 'NEUTRAL' : 'BEARISH' };
}

function scoreFSI(data?: FinancialStressIndex | null): RadarPoint {
  if (!data) return { layer: 'K', label: 'FSI 스트레스', score: 0, raw: 'N/A', status: 'UNAVAILABLE' };
  // 반전: 스트레스 낮을수록 점수 높음
  const s = Math.max(0, 100 - data.compositeScore);
  return { layer: 'K', label: 'FSI 스트레스', score: s, raw: `FSI ${data.compositeScore}/100 (${data.systemAction})`, status: s >= 60 ? 'BULLISH' : s >= 30 ? 'NEUTRAL' : 'BEARISH' };
}

function scoreFOMC(data?: FomcSentimentAnalysis | null): RadarPoint {
  if (!data) return { layer: 'L', label: 'FOMC 감성', score: 0, raw: 'N/A', status: 'UNAVAILABLE' };
  // -10~+10 → 0~100 (비둘기=높은 점수)
  const s = Math.round((-data.hawkDovishScore + 10) / 20 * 100);
  return { layer: 'L', label: 'FOMC 감성', score: Math.max(0, Math.min(100, s)), raw: `H/D ${data.hawkDovishScore > 0 ? '+' : ''}${data.hawkDovishScore} → ${data.kospiImpact}`, status: data.kospiImpact === 'BULLISH' ? 'BULLISH' : data.kospiImpact === 'BEARISH' ? 'BEARISH' : 'NEUTRAL' };
}

// ─── Component ───────────────────────────────────────────────────────────────

export const IntelligenceRadar: React.FC<Props> = (props) => {
  const points = useMemo<RadarPoint[]>(() => [
    scoreMHS(props.gate0),
    scoreSmartMoney(props.smartMoney),
    scoreExport(props.exportMomentum),
    scoreGeoRisk(props.geoRisk),
    scoreCredit(props.creditSpread),
    scoreCorrelation(props.correlation),
    scoreMultiSource(props.multiSource),
    scoreSupplyChain(props.supplyChain),
    scoreSectorOrders(props.sectorOrders),
    scoreFSI(props.fsi),
    scoreFOMC(props.fomcSentiment),
  ], [props]);

  const available = points.filter(p => p.status !== 'UNAVAILABLE');
  const avgScore = available.length > 0
    ? Math.round(available.reduce((s, p) => s + p.score, 0) / available.length) : 0;

  const bullish = available.filter(p => p.status === 'BULLISH').length;
  const bearish = available.filter(p => p.status === 'BEARISH').length;

  const radarData = points.map(p => ({
    subject: `${p.layer}. ${p.label}`,
    score: p.score,
    fullMark: 100,
  }));

  const statusColor = (status: RadarPoint['status']) =>
    status === 'BULLISH' ? 'text-green-600 border-green-300 bg-green-50' :
    status === 'BEARISH' ? 'text-red-600 border-red-300 bg-red-50' :
    status === 'NEUTRAL' ? 'text-amber-600 border-amber-300 bg-amber-50' :
    'text-gray-400 border-gray-200 bg-gray-50';

  return (
    <div className="border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-black uppercase tracking-widest text-gray-700">
          글로벌 인텔리전스 통합 레이더 (A~L)
        </h3>
        <div className="flex items-center gap-3">
          <span className={`text-xl font-black ${avgScore >= 60 ? 'text-green-600' : avgScore >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
            {avgScore}
          </span>
          <span className="text-[9px] text-gray-400">/100 AVG</span>
          <span className="text-[9px] px-2 py-0.5 border border-green-300 text-green-600 bg-green-50 font-bold">{bullish}B</span>
          <span className="text-[9px] px-2 py-0.5 border border-red-300 text-red-600 bg-red-50 font-bold">{bearish}R</span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_1.2fr] gap-4">
        {/* Radar Chart */}
        <div className="flex items-center justify-center">
          <ResponsiveContainer width="100%" height={340}>
            <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
              <PolarGrid stroke="rgba(0,0,0,0.08)" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: '#666', fontSize: 9, fontWeight: 700 }}
              />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar
                name="Intelligence"
                dataKey="score"
                stroke={avgScore >= 60 ? '#22c55e' : avgScore >= 40 ? '#f59e0b' : '#ef4444'}
                fill={avgScore >= 60 ? '#22c55e' : avgScore >= 40 ? '#f59e0b' : '#ef4444'}
                fillOpacity={0.25}
                strokeWidth={2}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', fontSize: 11, fontWeight: 700 }}
                formatter={(value: any) => [`${value}/100`, 'Score']}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Detail Table */}
        <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 340 }}>
          {points.map(p => (
            <div key={p.layer} className="flex items-center gap-2 py-1.5 border-b border-gray-50">
              <span className="w-5 text-[9px] font-black text-gray-400">{p.layer}</span>
              <span className="flex-1 text-[10px] font-bold text-gray-700 truncate">{p.label}</span>
              <div className="w-16 h-1.5 bg-gray-100 flex-shrink-0">
                <div className={`h-full ${
                  p.status === 'BULLISH' ? 'bg-green-400' :
                  p.status === 'BEARISH' ? 'bg-red-400' :
                  p.status === 'NEUTRAL' ? 'bg-amber-400' : 'bg-gray-200'
                }`} style={{ width: `${p.score}%` }} />
              </div>
              <span className="w-8 text-[9px] font-mono text-gray-500 text-right">{p.score}</span>
              <span className={`text-[8px] font-bold px-1.5 py-0.5 border ${statusColor(p.status)}`}>
                {p.status === 'UNAVAILABLE' ? 'N/A' : p.status}
              </span>
            </div>
          ))}
          {/* 종합 판정 */}
          <div className={`mt-3 p-3 border-2 text-center ${
            avgScore >= 65 ? 'border-green-400 bg-green-50' :
            avgScore >= 45 ? 'border-amber-400 bg-amber-50' :
            'border-red-400 bg-red-50'
          }`}>
            <p className="text-xs font-black">
              {avgScore >= 65 ? '글로벌 환경 양호 — 적극 매수 구간' :
               avgScore >= 45 ? '글로벌 환경 중립 — 선별 매수, 현금 비중 유지' :
               '글로벌 환경 경고 — 방어적 운용, 신규 매수 자제'}
            </p>
          </div>
        </div>
      </div>

      {/* Raw data tooltip row */}
      <div className="flex flex-wrap gap-1 mt-3">
        {points.filter(p => p.status !== 'UNAVAILABLE').map(p => (
          <span key={p.layer} className="text-[8px] text-gray-400 px-1.5 py-0.5 bg-gray-50 border border-gray-100">
            {p.layer}: {p.raw}
          </span>
        ))}
      </div>
    </div>
  );
};
