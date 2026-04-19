import React from 'react';
import { ScrollText } from 'lucide-react';
import { Section } from '../../ui/section';
import { EmptyState } from '../../ui/empty-state';
import type { TradingLogItem } from '../../services/autoTrading/autoTradingTypes';

interface EventLogPanelProps {
  logs: TradingLogItem[];
}

function levelStyle(level: TradingLogItem['level']) {
  switch (level) {
    case 'SUCCESS':
      return 'text-emerald-300';
    case 'WARNING':
      return 'text-amber-300';
    case 'ERROR':
      return 'text-red-300';
    default:
      return 'text-blue-300';
  }
}

export function EventLogPanel({ logs }: EventLogPanelProps) {
  return (
    <Section title="체결 추적 분석" subtitle="Execution Event Timeline">
      {logs.length === 0 ? (
        <EmptyState
          variant="minimal"
          icon={<ScrollText className="h-6 w-6" />}
          title="로그가 없습니다"
          description="실행 이벤트가 기록되면 이곳에 시간순으로 나타납니다."
        />
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className={`text-sm font-medium ${levelStyle(log.level)}`}>
                  [{log.level}] {log.message}
                </div>
                <div className="text-xs text-white/40">{log.createdAt}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
