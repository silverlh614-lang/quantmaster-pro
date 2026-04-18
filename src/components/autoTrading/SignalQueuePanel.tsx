import React from 'react';
import { Section } from '../../ui/section';
import type { SignalItem } from '../../services/autoTrading/autoTradingTypes';

interface SignalQueuePanelProps {
  signals: SignalItem[];
}

function gradeStyle(grade: SignalItem['grade']) {
  switch (grade) {
    case 'STRONG_BUY':
      return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
    case 'BUY':
      return 'bg-blue-500/15 text-blue-300 border border-blue-500/30';
    default:
      return 'bg-slate-500/15 text-slate-300 border border-slate-500/30';
  }
}

export function SignalQueuePanel({ signals }: SignalQueuePanelProps) {
  return (
    <Section title="신호 큐" subtitle="Signal Queue Panel">
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-white/5 text-white/60">
            <tr>
              <th className="px-4 py-3 text-left">시각</th>
              <th className="px-4 py-3 text-left">종목</th>
              <th className="px-4 py-3 text-left">등급</th>
              <th className="px-4 py-3 text-center">Gate1</th>
              <th className="px-4 py-3 text-center">Gate2</th>
              <th className="px-4 py-3 text-center">Gate3</th>
              <th className="px-4 py-3 text-right">RRR</th>
              <th className="px-4 py-3 text-left">상태</th>
              <th className="px-4 py-3 text-left">차단사유</th>
            </tr>
          </thead>
          <tbody>
            {signals.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-white/50">
                  현재 신호가 없습니다.
                </td>
              </tr>
            ) : (
              signals.map((signal) => (
                <tr key={signal.id} className="border-t border-white/10">
                  <td className="px-4 py-3 text-white/80">{signal.createdAt}</td>
                  <td className="px-4 py-3 text-white">
                    {signal.name} ({signal.symbol})
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${gradeStyle(signal.grade)}`}>
                      {signal.grade}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-white/80">{signal.gate1Passed}</td>
                  <td className="px-4 py-3 text-center text-white/80">{signal.gate2Passed}</td>
                  <td className="px-4 py-3 text-center text-white/80">{signal.gate3Passed}</td>
                  <td className="px-4 py-3 text-right text-white/80">{signal.rrr?.toFixed(2) ?? '-'}</td>
                  <td className="px-4 py-3 text-white/80">{signal.status}</td>
                  <td className="px-4 py-3 text-amber-300">{signal.blockedReason ?? '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
