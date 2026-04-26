// @responsibility 글로벌 상관관계 4축 카드 (ADR-0035 PR-H)

import React from 'react';
import { GitMerge, AlertTriangle } from 'lucide-react';
import { cn } from '../../ui/cn';
import { useGlobalIntelStore } from '../../stores';

function correlationTone(coef: number): 'green' | 'amber' | 'red' | 'gray' {
  if (!Number.isFinite(coef)) return 'gray';
  const abs = Math.abs(coef);
  if (abs >= 0.7) return 'red';
  if (abs >= 0.4) return 'amber';
  return 'green';
}

function fmtCoef(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2);
}

interface CorrRowProps {
  label: string;
  coef: number;
}

function CorrRow({ label, coef }: CorrRowProps) {
  const tone = correlationTone(coef);
  const colorCls =
    tone === 'red'   ? 'bg-red-500/60'   :
    tone === 'amber' ? 'bg-amber-500/60' :
    tone === 'green' ? 'bg-green-500/60' :
                       'bg-white/20';
  // 막대 width: -1 ~ +1 → 0~100% 매핑
  const widthPct = Math.min(100, Math.max(0, ((coef + 1) / 2) * 100));
  return (
    <div className="grid grid-cols-[5rem_1fr_3rem] gap-2 items-center text-[11px] py-1">
      <span className="opacity-70 truncate">{label}</span>
      <div className="relative h-2 bg-white/5 rounded">
        {/* 중심선 (0) */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/30" />
        <div
          className={cn('absolute top-0 bottom-0 h-2 rounded', colorCls)}
          style={{
            left: coef >= 0 ? '50%' : `${widthPct}%`,
            width: `${Math.abs(widthPct - 50)}%`,
          }}
        />
      </div>
      <span className={cn(
        'text-right font-num font-black',
        tone === 'red'   ? 'text-red-300'   :
        tone === 'amber' ? 'text-amber-300' :
        tone === 'green' ? 'text-green-300' : 'text-white/70',
      )}>
        {fmtCoef(coef)}
      </span>
    </div>
  );
}

/**
 * 글로벌 상관관계 4축 카드 — KOSPI 대비 S&P500 / Nikkei / Shanghai / DXY.
 * - 데이터 부재 시 placeholder.
 * - isDecoupling / isGlobalSync 알림 배지.
 */
export function GlobalCorrelationCard() {
  const data = useGlobalIntelStore(s => s.globalCorrelation);

  if (!data) {
    return (
      <div className="rounded border border-white/10 bg-white/5 p-3 sm:p-4 min-h-[120px]">
        <div className="flex items-center gap-1.5 mb-2 text-[10px] font-black uppercase tracking-widest opacity-70">
          <GitMerge className="w-3 h-3" />
          <span>글로벌 상관관계</span>
        </div>
        <p className="text-xs opacity-50">데이터 부재 — globalCorrelation cron 미실행</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded border p-3 sm:p-4 min-h-[120px]',
        data.isDecoupling ? 'border-amber-500/30 bg-amber-950/30' :
        data.isGlobalSync ? 'border-red-500/30 bg-red-950/30' :
        'border-white/10 bg-white/5',
      )}
      role="region"
      aria-label="글로벌 상관관계"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest opacity-70">
          <GitMerge className="w-3 h-3" />
          <span>글로벌 상관관계</span>
        </div>
        {data.isDecoupling && (
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded border bg-amber-500/30 border-amber-500/50 text-amber-200 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> 디커플링
          </span>
        )}
        {data.isGlobalSync && !data.isDecoupling && (
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded border bg-red-500/30 border-red-500/50 text-red-200">
            글로벌 동조화
          </span>
        )}
      </div>
      <CorrRow label="S&P500" coef={data.kospiSp500} />
      <CorrRow label="닛케이" coef={data.kospiNikkei} />
      <CorrRow label="상해종합" coef={data.kospiShanghai} />
      <CorrRow label="달러인덱스" coef={data.kospiDxy} />
      <p className="mt-1 text-[9px] opacity-50 leading-snug">
        KOSPI 대비 4축 — |0.7|↑ 위험, |0.4|↑ 주의
      </p>
    </div>
  );
}
