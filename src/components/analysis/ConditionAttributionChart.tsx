// @responsibility 27 조건별 수익률 귀인 막대 차트 (ADR-0025 PR-H)

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { cn } from '../../ui/cn';
import {
  fetchAttributionStats,
  type ClientAttributionConditionStat,
} from '../../api/attributionClient';

const CONDITION_NAMES: Record<number, string> = {
  1: '주도주 사이클', 2: '모멘텀', 3: 'ROE 유형 3', 4: '수급 질',
  5: '시장 환경 Risk-On', 6: '일목균형표', 7: '기계적 손절', 8: '경제적 해자',
  9: '신규 주도주', 10: '기술적 정배열', 11: '거래량', 12: '기관/외인 수급',
  13: '목표가 여력', 14: '실적 서프라이즈', 15: '실체적 펀더멘털', 16: '정책/매크로',
  17: '심리적 객관성', 18: '터틀 돌파', 19: '피보나치', 20: '엘리엇 파동',
  21: '이익의 질 OCF', 22: '마진 가속도', 23: '재무 방어력 ICR', 24: '상대강도 RS',
  25: 'VCP', 26: '다이버전스', 27: '촉매제',
};

function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

interface RowProps {
  stat: ClientAttributionConditionStat;
  maxAbsReturn: number;
}

function AttributionRow({ stat, maxAbsReturn }: RowProps) {
  const name = CONDITION_NAMES[stat.conditionId] ?? `조건 ${stat.conditionId}`;
  const ret = stat.avgReturn;
  const isPositive = ret >= 0;
  const barWidth = maxAbsReturn > 0
    ? Math.min(100, (Math.abs(ret) / maxAbsReturn) * 100)
    : 0;
  return (
    <div className="grid grid-cols-[8rem_1fr_4rem_3.5rem] gap-2 items-center text-[11px] py-1">
      <span className="font-bold opacity-80 truncate" title={name}>
        {name}
      </span>
      <div className="relative h-3 bg-white/5 rounded">
        {/* 양/음 분리 — 중심선 기준 */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20" />
        <div
          className={cn(
            'absolute top-0 bottom-0 rounded',
            isPositive ? 'left-1/2 bg-green-500/60' : 'right-1/2 bg-red-500/60',
          )}
          style={{ width: `${barWidth / 2}%` }}
        />
      </div>
      <span className={cn(
        'text-right font-num font-black',
        isPositive ? 'text-green-300' : 'text-red-300',
      )}>
        {fmtPct(ret)}
      </span>
      <span className="text-right font-num text-white/60 text-[10px]">
        {stat.winRate.toFixed(0)}%
      </span>
    </div>
  );
}

interface ConditionAttributionChartProps {
  className?: string;
}

/**
 * 27 조건별 평균 수익률 + 승률 막대 차트.
 * 정렬: avgReturn 내림차순 (긍정 기여 큰 조건 먼저).
 */
export function ConditionAttributionChart({ className }: ConditionAttributionChartProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['attribution', 'stats'],
    queryFn: fetchAttributionStats,
    staleTime: 60_000,
    retry: 2,
  });

  if (isLoading) {
    return (
      <div className={cn('rounded border border-white/10 bg-black/20 p-3', className)}>
        <div className="text-xs opacity-50">귀인 통계 로드 중…</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={cn('rounded border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-300', className)}>
        조건별 귀인 로드 실패
      </div>
    );
  }

  if (!data || data.stats.length === 0) {
    return (
      <div className={cn('rounded border border-white/10 bg-black/20 p-3 text-xs opacity-60', className)}>
        조건별 귀인 데이터 없음 — closed trade 가 누적되면 점진적으로 채워집니다.
      </div>
    );
  }

  const sorted = [...data.stats].sort((a, b) => b.avgReturn - a.avgReturn);
  const maxAbsReturn = Math.max(...sorted.map(s => Math.abs(s.avgReturn)), 1);

  return (
    <div
      className={cn('rounded border border-white/10 bg-black/20 p-3 sm:p-4', className)}
      role="region"
      aria-label="조건별 수익률 귀인"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-black uppercase tracking-widest opacity-70 flex items-center gap-1.5">
          <BarChart3 className="w-3 h-3" /> 조건별 수익률 귀인
        </span>
        <span className="text-[10px] text-white/50 font-num">
          {sorted.length} 조건 · {data.totalRecords} 레코드
        </span>
      </div>
      <div className="grid grid-cols-[8rem_1fr_4rem_3.5rem] gap-2 text-[10px] uppercase tracking-widest opacity-50 pb-1 border-b border-white/10 mb-1">
        <span>조건</span>
        <span className="text-center">기여도</span>
        <span className="text-right">avg</span>
        <span className="text-right">승률</span>
      </div>
      <div className="divide-y divide-white/5">
        {sorted.map(stat => (
          <AttributionRow key={stat.conditionId} stat={stat} maxAbsReturn={maxAbsReturn} />
        ))}
      </div>
    </div>
  );
}
