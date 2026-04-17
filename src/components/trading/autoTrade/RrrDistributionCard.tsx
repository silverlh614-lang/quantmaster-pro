import React from 'react';
import { BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card } from '../../../ui/card';
import { RRR_COLORS } from './constants';

export interface RrrBucket { name: string; value: number; }

interface Props {
  buckets: RrrBucket[];
  settledCount: number;
}

export function RrrDistributionCard({ buckets, settledCount }: Props) {
  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-bold text-theme-text">손익비 분포</span>
        <span className="text-micro ml-auto">{settledCount}건 결산</span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={buckets} barSize={32}>
          <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip
            contentStyle={{ background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
            formatter={(v) => [`${v}건`, '거래 수']}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {buckets.map((_, idx) => (
              <Cell key={idx} fill={RRR_COLORS[idx]} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
