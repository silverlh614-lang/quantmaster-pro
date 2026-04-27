// @responsibility 추천 일별 시계열 차트 — 어제/오늘 비교 + 7~30일 분포 (PR-M)

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar } from 'lucide-react';
import { cn } from '../../ui/cn';
import {
  fetchRecommendationTimeseries,
  type ClientDailyTimeseriesPoint,
} from '../../api/recommendationsClient';

const DAYS_OPTIONS = [
  { id: 7, label: '7일' },
  { id: 14, label: '14일' },
  { id: 30, label: '30일' },
] as const;

function fmtPct(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

function deltaCls(curr: number | null, prev: number | null): string {
  if (curr == null || prev == null) return 'text-white/60';
  if (curr > prev) return 'text-green-300';
  if (curr < prev) return 'text-red-300';
  return 'text-white/60';
}

interface RowProps {
  point: ClientDailyTimeseriesPoint;
  maxTotal: number;
  isLast: boolean;
}

function TimeseriesRow({ point, maxTotal, isLast }: RowProps) {
  const widthPct = maxTotal > 0 ? Math.min(100, (point.total / maxTotal) * 100) : 0;
  const winsPct = point.total > 0 ? (point.wins / point.total) * 100 : 0;
  const lossesPct = point.total > 0 ? (point.losses / point.total) * 100 : 0;
  return (
    <div className={cn(
      'grid grid-cols-[5rem_1fr_3rem_3.5rem] gap-2 items-center text-[11px] py-1',
      isLast && 'bg-violet-500/5 rounded',
    )}>
      <span className={cn('font-num shrink-0', isLast ? 'text-violet-200 font-black' : 'text-white/70')}>
        {point.date.slice(5)}{isLast && ' (오늘)'}
      </span>
      <div className="relative h-2 bg-white/5 rounded">
        <div className="absolute top-0 bottom-0 left-0 bg-white/15 rounded" style={{ width: `${widthPct}%` }} />
        {/* 승/패 비율 오버레이 */}
        <div className="absolute top-0 bottom-0 left-0 bg-green-500/50 rounded-l" style={{ width: `${(widthPct * winsPct) / 100}%` }} />
        <div
          className="absolute top-0 bottom-0 bg-red-500/50"
          style={{
            left: `${(widthPct * winsPct) / 100}%`,
            width: `${(widthPct * lossesPct) / 100}%`,
          }}
        />
      </div>
      <span className="text-right font-num font-black text-white/80 shrink-0">
        {point.total}
      </span>
      <span className={cn(
        'text-right font-num text-[10px] shrink-0',
        point.winRate == null ? 'text-white/40' :
        point.winRate >= 0.6 ? 'text-green-300' :
        point.winRate <= 0.4 ? 'text-red-300' : 'text-white/70',
      )}>
        {point.winRate != null ? `${(point.winRate * 100).toFixed(0)}%` : '—'}
      </span>
    </div>
  );
}

interface RecommendationTimeseriesChartProps {
  className?: string;
}

/**
 * 추천 일별 시계열 차트 — 7/14/30일 슬라이서 + 오늘 vs 어제 델타 표시.
 */
export function RecommendationTimeseriesChart({ className }: RecommendationTimeseriesChartProps) {
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['recommendations', 'timeseries', days],
    queryFn: () => fetchRecommendationTimeseries(days),
    staleTime: 60_000,
    retry: 2,
  });

  const series = data?.series ?? [];
  const today = series[series.length - 1] ?? null;
  const yesterday = series.length >= 2 ? series[series.length - 2] : null;
  const maxTotal = Math.max(...series.map(p => p.total), 1);

  return (
    <div
      className={cn('rounded border border-white/10 bg-black/20 p-3 sm:p-4', className)}
      role="region"
      aria-label="추천 일별 시계열"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <span className="text-[11px] font-black uppercase tracking-widest opacity-70 flex items-center gap-1.5">
          <Calendar className="w-3 h-3" /> 추천 시계열
        </span>
        <div role="tablist" className="flex gap-1">
          {DAYS_OPTIONS.map(opt => (
            <button
              key={opt.id}
              role="tab"
              aria-selected={days === opt.id}
              onClick={() => setDays(opt.id)}
              className={cn(
                'text-[10px] font-black px-2 py-1 rounded border transition-colors',
                days === opt.id
                  ? 'bg-violet-500/30 border-violet-500/50 text-violet-100'
                  : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 어제 vs 오늘 비교 */}
      {today && (
        <div className="grid grid-cols-3 gap-2 mb-3 text-[11px]">
          <div className="rounded border border-white/10 bg-white/5 p-2">
            <div className="text-[10px] opacity-60">오늘 추천</div>
            <div className={cn('text-lg font-black font-num', deltaCls(today.total, yesterday?.total ?? null))}>
              {today.total}
            </div>
            {yesterday && (
              <div className="text-[9px] opacity-50 mt-0.5">
                어제 {yesterday.total} ({today.total - yesterday.total >= 0 ? '+' : ''}{today.total - yesterday.total})
              </div>
            )}
          </div>
          <div className="rounded border border-white/10 bg-white/5 p-2">
            <div className="text-[10px] opacity-60">오늘 승률</div>
            <div className={cn('text-lg font-black font-num',
              today.winRate == null ? 'text-white/40' :
              today.winRate >= 0.6 ? 'text-green-300' :
              today.winRate <= 0.4 ? 'text-red-300' : 'text-white/80')}>
              {today.winRate != null ? `${(today.winRate * 100).toFixed(0)}%` : '—'}
            </div>
            <div className="text-[9px] opacity-50 mt-0.5">
              {today.wins}승 / {today.losses}패
            </div>
          </div>
          <div className="rounded border border-white/10 bg-white/5 p-2">
            <div className="text-[10px] opacity-60">오늘 평균 수익률</div>
            <div className={cn('text-lg font-black font-num',
              today.avgReturn == null ? 'text-white/40' :
              today.avgReturn > 0 ? 'text-green-300' :
              today.avgReturn < 0 ? 'text-red-300' : 'text-white/80')}>
              {fmtPct(today.avgReturn)}
            </div>
            <div className="text-[9px] opacity-50 mt-0.5">
              closed 만 평균
            </div>
          </div>
        </div>
      )}

      {/* 일별 막대 */}
      {isLoading ? (
        <p className="text-xs opacity-50">시계열 로드 중…</p>
      ) : isError ? (
        <p className="text-xs text-red-300">시계열 로드 실패</p>
      ) : series.length === 0 ? (
        <p className="text-xs opacity-60">시계열 데이터 없음</p>
      ) : (
        <>
          <div className="grid grid-cols-[5rem_1fr_3rem_3.5rem] gap-2 text-[10px] uppercase tracking-widest opacity-50 pb-1 border-b border-white/10 mb-1">
            <span>날짜</span>
            <span className="text-center">분포 (승/패)</span>
            <span className="text-right">건수</span>
            <span className="text-right">승률</span>
          </div>
          <div className="divide-y divide-white/5">
            {series.map((point, i) => (
              <TimeseriesRow
                key={point.date}
                point={point}
                maxTotal={maxTotal}
                isLast={i === series.length - 1}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
