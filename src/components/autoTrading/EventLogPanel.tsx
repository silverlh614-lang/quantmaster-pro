import React from 'react';
import { Section } from '../../ui/section';
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
    <Section title="이벤트 로그" subtitle="Event Log Panel">
      <div className="space-y-2">
        {logs.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
            로그가 없습니다.
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className={`text-sm font-medium ${levelStyle(log.level)}`}>
                  [{log.level}] {log.message}
                </div>
                <div className="text-xs text-white/40">{log.createdAt}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </Section>
  );
}
