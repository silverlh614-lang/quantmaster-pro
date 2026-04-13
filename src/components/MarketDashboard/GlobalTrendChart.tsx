import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

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

export const GlobalTrendChart: React.FC<GlobalTrendChartProps> = ({ indices }) => {
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

  const baseIndex = kospi || nasdaq || sp500 || indices?.[0];
  const chartData = baseIndex?.history
    ? baseIndex.history.map((h, i) => ({
        date: h.date,
        KOSPI: kospi?.history?.[i]?.value ?? 0,
        NASDAQ: nasdaq?.history?.[i]?.value ?? 0,
        SP500: sp500?.history?.[i]?.value ?? 0,
      }))
    : [];

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
            <Line type="monotone" dataKey="KOSPI" stroke="#ef4444" strokeWidth={4} dot={false} activeDot={{ r: 6, fill: '#ef4444', strokeWidth: 0 }} />
            <Line type="monotone" dataKey="NASDAQ" stroke="#3b82f6" strokeWidth={4} dot={false} activeDot={{ r: 6, fill: '#3b82f6', strokeWidth: 0 }} />
            <Line type="monotone" dataKey="SP500" stroke="#10b981" strokeWidth={4} dot={false} activeDot={{ r: 6, fill: '#10b981', strokeWidth: 0 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
