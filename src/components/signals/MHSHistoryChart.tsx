// @responsibility signals 영역 MHSHistoryChart 컴포넌트
import React, { useEffect, useRef, useMemo } from 'react';
import { createChart, createSeriesMarkers, LineSeries, HistogramSeries, IChartApi, Time, LineData, HistogramData } from 'lightweight-charts';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MHSRecord {
  date: string;         // YYYY-MM-DD
  mhs: number;          // 0-100
  mhsLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  interestRate: number;  // 0-25
  liquidity: number;     // 0-25
  economic: number;      // 0-25
  risk: number;          // 0-25
}

interface Props {
  records?: MHSRecord[] | null;
  height?: number;
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

const MHS_HISTORY_KEY = 'k-stock-mhs-history';

export function loadMHSHistory(): MHSRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MHS_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveMHSRecord(record: MHSRecord): MHSRecord[] {
  const history = loadMHSHistory();
  // Deduplicate by date
  const existing = history.findIndex(r => r.date === record.date);
  if (existing >= 0) history[existing] = record;
  else history.push(record);
  // Keep last 365 days
  const trimmed = history.slice(-365);
  localStorage.setItem(MHS_HISTORY_KEY, JSON.stringify(trimmed));
  return trimmed;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const MHSHistoryChart: React.FC<Props> = ({ records, height = 280 }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);

  const sortedRecords = useMemo(() =>
    [...(records ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [records]
  );

  useEffect(() => {
    if (!chartRef.current || sortedRecords.length === 0) return;

    if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height,
      layout: { background: { color: '#0a0a0a' }, textColor: '#999', fontSize: 10 },
      grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#333' },
      timeScale: { borderColor: '#333' },
    });
    chartInstance.current = chart;

    // MHS Line
    const mhsSeries = chart.addSeries(LineSeries,{
      color: '#f59e0b',
      lineWidth: 2,
      priceLineVisible: false,
    });
    mhsSeries.setData(sortedRecords.map(r => ({
      time: r.date as Time,
      value: r.mhs,
    })) as LineData[]);

    // 40/70 threshold lines
    const line40 = chart.addSeries(LineSeries,{ color: 'rgba(239,68,68,0.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    const line70 = chart.addSeries(LineSeries,{ color: 'rgba(34,197,94,0.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    line40.setData(sortedRecords.map(r => ({ time: r.date as Time, value: 40 })) as LineData[]);
    line70.setData(sortedRecords.map(r => ({ time: r.date as Time, value: 70 })) as LineData[]);

    // 4-axis breakdown as stacked area (histogram)
    const axisSeries = chart.addSeries(HistogramSeries,{
      priceFormat: { type: 'volume' },
      priceScaleId: 'axis',
    });
    chart.priceScale('axis').applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    });
    axisSeries.setData(sortedRecords.map(r => ({
      time: r.date as Time,
      value: r.mhs,
      color: r.mhsLevel === 'HIGH' ? 'rgba(34,197,94,0.2)' :
             r.mhsLevel === 'MEDIUM' ? 'rgba(245,158,11,0.2)' :
             'rgba(239,68,68,0.2)',
    })) as HistogramData[]);

    // Transition markers (MEDIUM→HIGH = optimal entry)
    const markers: any[] = [];
    for (let i = 1; i < sortedRecords.length; i++) {
      const prev = sortedRecords[i - 1];
      const curr = sortedRecords[i];
      if (prev.mhsLevel === 'MEDIUM' && curr.mhsLevel === 'HIGH') {
        markers.push({
          time: curr.date as Time,
          position: 'belowBar',
          color: '#22c55e',
          shape: 'arrowUp',
          text: 'ENTRY',
        });
      }
      if (prev.mhsLevel !== 'LOW' && curr.mhsLevel === 'LOW') {
        markers.push({
          time: curr.date as Time,
          position: 'aboveBar',
          color: '#ef4444',
          shape: 'arrowDown',
          text: 'HALT',
        });
      }
    }
    if (markers.length > 0) createSeriesMarkers(mhsSeries, markers);

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (chartRef.current && chartInstance.current) {
        chartInstance.current.applyOptions({ width: chartRef.current.clientWidth });
      }
    });
    ro.observe(chartRef.current);

    return () => {
      ro.disconnect();
      if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
    };
  }, [sortedRecords, height]);

  // Current stats
  const latest = sortedRecords[sortedRecords.length - 1];
  const prevWeek = sortedRecords[Math.max(0, sortedRecords.length - 8)];
  const mhsDelta = latest && prevWeek ? latest.mhs - prevWeek.mhs : 0;

  return (
    <div className="border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-black uppercase tracking-widest text-gray-700">
          MHS 히스토리 (Gate 0 Macro Health Score)
        </h3>
        {latest && (
          <div className="flex items-center gap-3">
            <span className={`text-lg font-black ${
              latest.mhsLevel === 'HIGH' ? 'text-green-600' :
              latest.mhsLevel === 'MEDIUM' ? 'text-amber-600' : 'text-red-600'
            }`}>{latest.mhs}</span>
            <span className={`text-[9px] font-bold px-2 py-0.5 border ${
              mhsDelta > 0 ? 'border-green-300 text-green-600' :
              mhsDelta < 0 ? 'border-red-300 text-red-600' :
              'border-gray-300 text-gray-500'
            }`}>{mhsDelta >= 0 ? '+' : ''}{mhsDelta.toFixed(0)} (1W)</span>
          </div>
        )}
      </div>

      {sortedRecords.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm font-bold">MHS 기록이 없습니다</p>
          <p className="text-[10px] mt-1">매일 앱 실행 시 Gate 0 MHS 점수가 자동 기록됩니다.</p>
        </div>
      ) : (
        <>
          <div ref={chartRef} className="rounded-lg overflow-hidden" />

          {/* 4-Axis breakdown for latest */}
          {latest && (
            <div className="grid grid-cols-4 gap-2 mt-3">
              {[
                { label: '금리', value: latest.interestRate, max: 25, color: 'bg-blue-400' },
                { label: '유동성', value: latest.liquidity, max: 25, color: 'bg-green-400' },
                { label: '경기', value: latest.economic, max: 25, color: 'bg-amber-400' },
                { label: '리스크', value: latest.risk, max: 25, color: 'bg-red-400' },
              ].map(axis => (
                <div key={axis.label} className="text-center">
                  <p className="text-[8px] font-bold text-gray-400 uppercase">{axis.label}</p>
                  <div className="w-full h-1.5 bg-gray-100 mt-1">
                    <div className={`h-full ${axis.color}`} style={{ width: `${(axis.value / axis.max) * 100}%` }} />
                  </div>
                  <p className="text-[9px] font-mono text-gray-500 mt-0.5">{axis.value}/{axis.max}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 mt-3 text-[8px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-400/40" /> HIGH (≥70) 정상 매수</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-400/40" /> MEDIUM (40-69) Kelly 축소</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-400/40" /> LOW (&lt;40) 매수 중단</span>
            <span className="flex items-center gap-1"><span className="text-green-500">▲</span> ENTRY = MEDIUM→HIGH 전환</span>
          </div>
        </>
      )}
    </div>
  );
};
