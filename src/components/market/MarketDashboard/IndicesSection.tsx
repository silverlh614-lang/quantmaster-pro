// @responsibility market 영역 IndicesSection 컴포넌트
import React from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { TrendIndicator } from '../../../ui/trend-indicator';

interface MarketDataPoint {
  name: string;
  value: number;
  change: number;
  changePercent: number;
  history?: { date: string; value: number }[];
}

interface IndicesSectionProps {
  indices: MarketDataPoint[];
}

const MarketCard = ({ item }: { item: MarketDataPoint }) => {
  const isPositive = item.change >= 0;
  return (
    <div className="glass-3d p-6 rounded-[2rem] border border-white/10 shadow-xl hover:bg-white/[0.05] transition-all group">
      <div className="flex justify-between items-start mb-4 gap-2">
        <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] truncate" title={item.name}>{item.name}</span>
        <div className={`px-2 py-1 rounded-lg ${isPositive ? 'bg-red-500/10' : 'bg-blue-500/10'}`}>
          <TrendIndicator
            value={item.changePercent ?? 0}
            size="sm"
            koreanPalette
          />
        </div>
      </div>
      <div className="text-fluid-3xl font-black text-white tracking-tighter mb-6">
        {item.value?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
      </div>
      {item.history && (
        <div className="h-20 w-full opacity-50 group-hover:opacity-100 transition-opacity">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={item.history}>
              <defs>
                <linearGradient id={`color-${item.name.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isPositive ? '#ef4444' : '#3b82f6'} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={isPositive ? '#ef4444' : '#3b82f6'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={isPositive ? '#ef4444' : '#3b82f6'}
                fillOpacity={1}
                fill={`url(#color-${item.name.replace(/\s+/g, '-')})`}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export const IndicesSection: React.FC<IndicesSectionProps> = React.memo(({ indices }) => (
  <section>
    <div className="flex items-center gap-4 mb-8">
      <div className="w-2 h-8 bg-indigo-500 rounded-full" />
      <h3 className="text-xl font-black text-white uppercase tracking-tighter">주요 시장 지수</h3>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {indices?.map((idx, i) => (
        <MarketCard key={`${idx.name}-${i}`} item={idx} />
      ))}
    </div>
  </section>
));
