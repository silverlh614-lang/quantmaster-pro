/**
 * GatePassRateHeatmap — 27조건 개별 통과율 시각화 그리드.
 *
 * 각 조건의 passed/failed 비율을 색상 gradient 로 표현한다:
 *   - 90% 초과:   cyan (과도하게 느슨 — 필터 효과 없음)
 *   - 60~90%:    emerald (정상 작동 구간)
 *   - 30~60%:    amber (선택성 있음)
 *   - 10~30%:    orange (엄격 — 의도적이면 OK)
 *   - 10% 미만:  red (사실상 사어 — 재검토 필요)
 *
 * 메모리 참조: "Gate 2·24 중복 로직 감지" 이슈 — 통과율 0% 인 조건은
 * 더 이상 작동하지 않는 dead logic 일 가능성이 높다.
 */

import React from 'react';
import { Section } from '../../ui/section';
import type { GateAuditData } from '../../api';

interface GatePassRateHeatmapProps {
  data: GateAuditData | null;
}

interface CellStat {
  key: string;
  passed: number;
  failed: number;
  total: number;
  rate: number; // 0~1
}

function toneFor(rate: number, total: number): {
  bg: string;
  label: string;
  text: string;
} {
  if (total === 0) return { bg: 'bg-white/[0.03] border border-white/10', label: 'N/A', text: 'text-white/30' };
  if (rate > 0.9)  return { bg: 'bg-cyan-500/60',   label: '느슨', text: 'text-cyan-50' };
  if (rate >= 0.6) return { bg: 'bg-emerald-500/60', label: '정상', text: 'text-emerald-50' };
  if (rate >= 0.3) return { bg: 'bg-amber-500/60',   label: '선택적', text: 'text-amber-50' };
  if (rate >= 0.1) return { bg: 'bg-orange-500/70',  label: '엄격',  text: 'text-orange-50' };
  return { bg: 'bg-red-500/70', label: '사어(死語)', text: 'text-red-50' };
}

export function GatePassRateHeatmap({ data }: GatePassRateHeatmapProps) {
  const cells: CellStat[] = data
    ? Object.entries(data).map(([key, v]) => {
        const total = (v.passed ?? 0) + (v.failed ?? 0);
        return {
          key,
          passed: v.passed ?? 0,
          failed: v.failed ?? 0,
          total,
          rate: total > 0 ? v.passed / total : 0,
        };
      }).sort((a, b) => a.key.localeCompare(b.key))
    : [];

  return (
    <Section
      title="Gate 통과율 히트맵"
      subtitle="Gate Pass Rate · 27 Conditions"
    >
      {cells.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
          아직 Gate 감사 데이터가 없습니다.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.1em] text-white/50">
            <span>범례:</span>
            <span className="rounded px-2 py-0.5 bg-cyan-500/60 text-cyan-50">90%+ 느슨</span>
            <span className="rounded px-2 py-0.5 bg-emerald-500/60 text-emerald-50">60-90% 정상</span>
            <span className="rounded px-2 py-0.5 bg-amber-500/60 text-amber-50">30-60% 선택적</span>
            <span className="rounded px-2 py-0.5 bg-orange-500/70 text-orange-50">10-30% 엄격</span>
            <span className="rounded px-2 py-0.5 bg-red-500/70 text-red-50">&lt;10% 사어</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {cells.map((c) => {
              const tone = toneFor(c.rate, c.total);
              return (
                <div
                  key={c.key}
                  title={`${c.key} — passed: ${c.passed} / failed: ${c.failed} (${(c.rate * 100).toFixed(1)}%)`}
                  className={`flex flex-col rounded-lg px-3 py-2.5 ${tone.bg} ${tone.text}`}
                >
                  <div className="truncate text-[10px] font-black uppercase tracking-[0.1em] opacity-80">
                    {c.key}
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-1">
                    <span className="text-base font-black">
                      {c.total > 0 ? `${Math.round(c.rate * 100)}%` : '—'}
                    </span>
                    <span className="text-[9px] opacity-70">({c.total})</span>
                  </div>
                  <div className="text-[9px] opacity-70">{tone.label}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Section>
  );
}
