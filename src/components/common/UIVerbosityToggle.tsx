// @responsibility UI 정보 밀도 토글 컴포넌트 (3-way segmented control, ADR-0099 PR-Verbose 사용자 #12)

/**
 * 사용자가 UI 정보 밀도 (minimal / balanced / verbose) 를 직접 토글.
 *
 * 3-way segmented control — 사용자 인지 부하 직접 제어:
 * - minimal: Verdict 만 (신규 사용자, 빠른 결정)
 * - balanced: V-E-R 3 슬롯 (기본 디폴트)
 * - verbose: ConfluenceMeter + 축 사유 + Ribbon (시스템 운영자)
 *
 * 사용처: Settings 모달 또는 페이지 헤더. 본 PR 은 컴포넌트만 도입, 사용처 임베드는 후속 PR.
 */
import type { ReactElement } from 'react';
import { Eye, EyeOff, Layers } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { UIVerbosity } from '../../stores/useSettingsStore';
import { useUIVerbosity } from '../../hooks/useUIVerbosity';

interface UIVerbosityToggleProps {
  className?: string;
  /** 컴팩트 (배지 스타일) — 페이지 헤더용 */
  compact?: boolean;
}

interface OptionMeta {
  value: UIVerbosity;
  label: string;
  description: string;
  icon: typeof EyeOff;
}

const OPTIONS: OptionMeta[] = [
  {
    value: 'minimal',
    label: '간결',
    description: 'Verdict 만 표시 (신규 사용자)',
    icon: EyeOff,
  },
  {
    value: 'balanced',
    label: '균형',
    description: 'V-E-R 3 슬롯 (기본)',
    icon: Eye,
  },
  {
    value: 'verbose',
    label: '상세',
    description: '합치도 + 결손 사유 + 신뢰도 띠 (운영자)',
    icon: Layers,
  },
];

export function UIVerbosityToggle({ className, compact = false }: UIVerbosityToggleProps): ReactElement {
  const v = useUIVerbosity();

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-white/[0.07] bg-zinc-900/60 p-0.5',
        className,
      )}
      role="radiogroup"
      aria-label="UI 정보 밀도"
      data-ui-verbosity-toggle
    >
      {OPTIONS.map((opt) => {
        const active = v.verbosity === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${opt.label} — ${opt.description}`}
            title={`${opt.label}: ${opt.description}`}
            onClick={() => v.setVerbosity(opt.value)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors',
              active
                ? 'bg-emerald-500/20 text-emerald-100 border border-emerald-400/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40',
            )}
            data-ui-verbosity-option={opt.value}
            data-ui-verbosity-active={active ? 'true' : 'false'}
          >
            <Icon className="w-3 h-3" aria-hidden />
            {!compact && <span>{opt.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
