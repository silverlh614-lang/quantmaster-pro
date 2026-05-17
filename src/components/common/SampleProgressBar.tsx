// @responsibility Sample completion progress bar rendering.
import React from 'react';
import { cn } from '../../ui/cn';

export interface SampleProgress {
  current: number;
  target: number;
  eta?: string | null;
}

interface SampleProgressBarProps {
  progress: SampleProgress;
  className?: string;
  label?: string;
}

function formatEta(eta?: string | null): string {
  if (!eta) return '예상 산정 중';
  if (eta === 'complete') return '표본 충분';
  const days = /^(\d+)d$/.exec(eta)?.[1];
  if (days) return `예상 완성 ${days}일`;
  return `예상 완성 ${eta}`;
}

export function SampleProgressBar({
  progress,
  className,
  label = '표본',
}: SampleProgressBarProps): React.ReactElement {
  const current = Math.max(0, Math.floor(progress.current));
  const target = Math.max(1, Math.floor(progress.target));
  const pct = Math.min(100, Math.round((current / target) * 100));

  return (
    <div className={cn('space-y-1.5', className)} data-testid="sample-progress-bar">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="font-semibold text-zinc-300">{label} {current}/{target}</span>
        <span className="shrink-0 text-zinc-500">{formatEta(progress.eta)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800" aria-hidden="true">
        <div
          className="h-full rounded-full bg-emerald-400 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
