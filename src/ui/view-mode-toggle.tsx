/**
 * ViewModeToggle — 점진적 공개(Progressive disclosure) 를 위한 Simple ↔ Pro 토글.
 *
 * 전문가 체감 강화:
 *   - Simple  = 요약 KPI + 포지션·주문 (비전문가·간편 모니터링)
 *   - Pro     = 풀 관제 콘솔 — 신호 큐·게이트 히트맵·진단·응급 조치
 *   - 활성 상태 시 각 모드에 해당하는 부가 설명(보조 레이블)을 노출해
 *     모드 전환이 어떤 시각적 변화를 동반하는지 1초 안에 식별할 수 있게 한다.
 */
import React from 'react';
import { Gauge, Terminal } from 'lucide-react';
import { cn } from './cn';
import type { ViewDensity } from '../stores/useSettingsStore';

interface ViewModeToggleProps {
  value: ViewDensity;
  onChange: (mode: ViewDensity) => void;
  className?: string;
  simpleLabel?: string;
  proLabel?: string;
}

const baseItem =
  'relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap';

export function ViewModeToggle({
  value,
  onChange,
  className,
  simpleLabel = '간단',
  proLabel = '프로',
}: ViewModeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="뷰 모드 전환"
      className={cn(
        'inline-flex items-center gap-1 p-1 bg-white/[0.02] rounded-xl border border-white/[0.06]',
        className,
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === 'simple'}
        onClick={() => onChange('simple')}
        title="요약 KPI · 포지션 · 주문만 표시"
        className={cn(
          baseItem,
          value === 'simple'
            ? 'bg-gradient-to-r from-sky-500/[0.18] to-blue-500/[0.08] text-sky-200 shadow-sm shadow-sky-500/10 ring-1 ring-sky-400/30'
            : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-white/[0.04]',
        )}
      >
        <Gauge className="h-3.5 w-3.5" />
        {simpleLabel}
        {value === 'simple' && (
          <span className="hidden sm:inline text-[9px] font-medium tracking-wider text-sky-200/70 uppercase">
            요약
          </span>
        )}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'pro'}
        onClick={() => onChange('pro')}
        title="신호 큐 · 게이트 히트맵 · 진단 · 응급 조치 · 5-서브시스템 평결 전체 공개"
        className={cn(
          baseItem,
          value === 'pro'
            ? 'bg-gradient-to-r from-amber-500/[0.22] via-orange-500/[0.18] to-rose-500/[0.12] text-amber-200 shadow-[0_0_10px_rgba(251,146,60,0.18)] ring-1 ring-amber-400/40 font-black uppercase tracking-wider'
            : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-white/[0.04]',
        )}
      >
        <Terminal className="h-3.5 w-3.5" />
        {proLabel}
        {value === 'pro' && (
          <span className="hidden sm:inline text-[9px] font-black tracking-[0.2em] text-amber-200/90 uppercase">
            풀 콘솔
          </span>
        )}
      </button>
    </div>
  );
}
