import React from 'react';
import { Clock } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { Card } from '../../../ui/card';

export interface TimelineEvent {
  time: string;
  type: string;
  stock: string;
  detail: string;
}

interface Props { events: TimelineEvent[]; }

export function TradingTimelineCard({ events }: Props) {
  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-bold text-theme-text">최근 활동</span>
      </div>
      <div className="space-y-3">
        {events.map((evt, i) => {
          const dotColor = evt.type === 'TARGET_HIT' ? 'bg-green-400' : evt.type === 'STOP_HIT' ? 'bg-red-400' : evt.type === 'BUY' ? 'bg-violet-400' : 'bg-blue-400';
          const label = evt.type === 'TARGET_HIT' ? '익절' : evt.type === 'STOP_HIT' ? '손절' : evt.type === 'BUY' ? '매수' : '추가';
          const timeStr = (() => {
            try {
              const d = new Date(evt.time);
              const now = new Date();
              if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
              return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
            } catch { return ''; }
          })();
          return (
            <div key={i} className="flex items-center gap-3">
              <div className="flex flex-col items-center">
                <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', dotColor)} />
                {i < events.length - 1 && <div className="w-px h-4 bg-white/10 mt-1" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-theme-text truncate">{evt.stock}</span>
                  <span className="text-[10px] text-theme-text-muted shrink-0 ml-2">{timeStr}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={cn('text-[10px] font-bold', evt.type === 'TARGET_HIT' ? 'text-green-400' : evt.type === 'STOP_HIT' ? 'text-red-400' : 'text-theme-text-muted')}>{label}</span>
                  <span className="text-[10px] text-theme-text-muted">{evt.detail}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
