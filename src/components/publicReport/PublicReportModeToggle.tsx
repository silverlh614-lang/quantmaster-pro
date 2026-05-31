// @responsibility ViewMode segmented control for Operation/Public/Paid report layers.

import React from 'react';
import { FileText, LockKeyhole, MonitorCog } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { ViewMode } from '../../public-report/reportTypes';

interface PublicReportModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const modes: Array<{ value: ViewMode; label: string; icon: React.ElementType; title: string }> = [
  { value: 'OPERATION_MODE', label: 'Operation', icon: MonitorCog, title: '내부 운영 콘솔' },
  { value: 'PUBLIC_REPORT_MODE', label: 'Public', icon: FileText, title: '블로그/Telegram 공개 카드' },
  { value: 'PAID_PREVIEW_MODE', label: 'Paid Preview', icon: LockKeyhole, title: '유료 대시보드 미리보기' },
];

export function PublicReportModeToggle({ value, onChange }: PublicReportModeToggleProps) {
  return (
    <div
      className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.07] bg-black/20 p-1"
      role="radiogroup"
      aria-label="Report view mode"
    >
      {modes.map((mode) => {
        const Icon = mode.icon;
        const active = value === mode.value;
        return (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={mode.title}
            onClick={() => onChange(mode.value)}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-black transition-colors',
              active
                ? 'bg-blue-500/18 text-blue-100 ring-1 ring-blue-400/30'
                : 'text-white/50 hover:bg-white/5 hover:text-white/80',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
