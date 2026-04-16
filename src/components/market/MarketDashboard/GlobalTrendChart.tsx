import React, { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { fetchHistoricalData } from '../../../services/stock/historicalData';

interface MarketDataPoint {
  name: string;
  value: number;
  change: number;
  changePercent: number;
  history?: { date: string; value: number }[];
}

interface GlobalTrendChartProps {
  indices?: MarketDataPoint[];
}

type ChartRow = { date: string; KOSPI?: number; NASDAQ?: number; SP500?: number };

async function fetchNormalizedSeries(symbol: string): Promise<{ date: string; value: number }[]> {
  try {
    const data = await fetchHistoricalData(symbol, '3mo');
    const timestamps: number[] = data?.timestamp ?? [];
    const quote = data?.indicators?.quote?.[0];
    const closes: (number | null)[] = quote?.close ?? [];
    const first = closes.find((c): c is number => typeof c === 'number' && c > 0);
    if (!first || timestamps.length === 0) return [];
    return timestamps.reduce<{ date: string; value: number }[]>((acc, ts, i) => {
      const close = closes[i];
      if (typeof close !== 'number' || !Number.isFinite(close)) return acc;
      acc.push({
        date: new Date(ts * 1000).toISOString().slice(5, 10),
        value: Number(((close / first) * 100).toFixed(2)),
      });
      return acc;
    }, []);
  } catch {
    return [];
  }
}

export const GlobalTrendChart: React.FC<GlobalTrendChartProps> = React.memo(({ indices }) => {
  const kospi = indices?.find(idx =>
    (idx.name || '').toUpperCase().includes('KOSPI') || (idx.name || '').includes('코스피')
  );
  const nasdaq = indices?.find(idx =>
    (idx.name || '').toUpperCase().includes('NASDAQ') || (idx.name || '').includes('나스닥')
  );
  const sp500 = indices?.find(idx =>
    (idx.name || '').toUpperCase().includes('S&P 500') ||
    (idx.name || '').toUpperCase().includes('SP500') ||
    (idx.name || '').includes('S&P500')
  );

  const [chartData, setChartData] = useState<ChartRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Fallback to server-provided history when present
    const baseHistory = kospi?.history ?? nasdaq?.history ?? sp500?.history;
    if (baseHistory && baseHistory.length > 0) {
      setChartData(
        baseHistory.map((h, i) => ({
          date: h.date,
          KOSPI: kospi?.history?.[i]?.value,
          NASDAQ: nasdaq?.history?.[i]?.value,
          SP500: sp500?.history?.[i]?.value,
        })),
      );
      return () => { cancelled = true; };
    }

    setLoading(true);
    (async () => {
      const [ks, nq, sp] = await Promise.all([
        fetchNormalizedSeries('^KS11'),
        fetchNormalizedSeries('^IXIC'),
        fetchNormalizedSeries('^GSPC'),
      ]);
      if (cancelled) return;
      const dates = ks.length ? ks : nq.length ? nq : sp;
      const rows: ChartRow[] = dates.map((row, i) => ({
        date: row.date,
        KOSPI: ks[i]?.value,
        NASDAQ: nq[i]?.value,
        SP500: sp[i]?.value,
      }));
      setChartData(rows);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [kospi, nasdaq, sp500]);

  return (
    <div className="glass-3d p-10 rounded-[3rem] border border-white/10 shadow-2xl">
      <div className="flex items-center justify-between mb-10">
        <h3 className="text-xl font-black text-white uppercase tracking-tighter">글로벌 지수 통합 추이</h3>
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">KOSPI</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">NASDAQ</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">S&P 500</span>
          </div>
        </div>
      </div>
      <div className="h-96 w-full">
        {chartData.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-white/40">
            <TrendingUp className="w-8 h-8" />
            <p className="text-[11px] font-bold uppercase tracking-widest">
              {loading ? '글로벌 지수 히스토리 로딩 중...' : '히스토리 데이터를 불러올 수 없습니다'}
            </p>
            <p className="text-[10px] text-white/30">3개월 시계열을 100 기준으로 정규화하여 표시합니다.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.2)', fontWeight: 900 }}
                dy={10}
              />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(15, 23, 42, 0.9)',
                  borderRadius: '24px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.5)',
                }}
                itemStyle={{ fontWeight: 900, fontSize: '12px' }}
              />
              <Line type="monotone" dataKey="KOSPI" stroke="#ef4444" strokeWidth={4} dot={false} activeDot={{ r: 6, fill: '#ef4444', strokeWidth: 0 }} connectNulls />
              <Line type="monotone" dataKey="NASDAQ" stroke="#3b82f6" strokeWidth={4} dot={false} activeDot={{ r: 6, fill: '#3b82f6', strokeWidth: 0 }} connectNulls />
              <Line type="monotone" dataKey="SP500" stroke="#10b981" strokeWidth={4} dot={false} activeDot={{ r: 6, fill: '#10b981', strokeWidth: 0 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
});
