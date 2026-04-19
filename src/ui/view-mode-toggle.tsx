/**
 * ViewModeToggle — 점진적 공개(Progressive disclosure) 를 위한 Simple ↔ Pro 토글.
 * 정보 과부하를 줄이기 위해 페이지 단위로 세그먼트형 전환을 제공한다.
 */
import React from 'react';
import { Gauge, LayoutGrid } from 'lucide-react';
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
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap';

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
        className={cn(
          baseItem,
          value === 'simple'
            ? 'bg-gradient-to-r from-blue-500/[0.15] to-indigo-500/[0.08] text-blue-300 shadow-sm shadow-blue-500/10'
            : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-white/[0.04]',
        )}
      >
        <Gauge className="h-3.5 w-3.5" />
        {simpleLabel}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'pro'}
        onClick={() => onChange('pro')}
        className={cn(
          baseItem,
          value === 'pro'
            ? 'bg-gradient-to-r from-orange-500/[0.18] to-amber-500/[0.1] text-orange-300 shadow-sm shadow-orange-500/10'
            : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-white/[0.04]',
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        {proLabel}
      </button>
    </div>
  );
}
