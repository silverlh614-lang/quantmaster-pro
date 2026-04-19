/**
 * Neo-Brutalism Badge System
 * Signal badges with pulsing dots + color glow + semantic color unification.
 * Colors: green(pass/profit), red(fail/loss), yellow(warn), blue(info), violet(AI)
 */
import React from 'react';
import { cn } from './cn';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'violet';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  neo?: boolean;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-white/10 text-white/60 border-white/10',
  success: 'bg-green-500/15 text-green-400 border-green-500/25',
  warning: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  danger: 'bg-red-500/15 text-red-400 border-red-500/25',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  accent: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  violet: 'bg-violet-500/15 text-violet-400 border-violet-500/25',
};

const neoVariantClasses: Record<BadgeVariant, string> = {
  default: 'bg-white/10 text-white/60 border-white/20',
  success: 'bg-green-500/12 text-green-400 border-green-500/35',
  warning: 'bg-yellow-500/12 text-yellow-400 border-yellow-500/35',
  danger: 'bg-red-500/12 text-red-400 border-red-500/35',
  info: 'bg-blue-500/12 text-blue-400 border-blue-500/35',
  accent: 'bg-orange-500/12 text-orange-400 border-orange-500/35',
  violet: 'bg-violet-500/12 text-violet-400 border-violet-500/35',
};

const glowClasses: Record<BadgeVariant, string> = {
  default: '',
  success: 'shadow-[0_0_12px_rgba(34,197,94,0.2)]',
  warning: 'shadow-[0_0_12px_rgba(234,179,8,0.2)]',
  danger: 'shadow-[0_0_12px_rgba(239,68,68,0.2)]',
  info: 'shadow-[0_0_12px_rgba(59,130,246,0.2)]',
  accent: 'shadow-[0_0_12px_rgba(249,115,22,0.2)]',
  violet: 'shadow-[0_0_12px_rgba(139,92,246,0.2)]',
};

const dotColors: Record<BadgeVariant, string> = {
  default: 'bg-white/40',
  success: 'bg-green-400',
  warning: 'bg-yellow-400',
  danger: 'bg-red-400',
  info: 'bg-blue-400',
  accent: 'bg-orange-400',
  violet: 'bg-violet-400',
};

const sizeClasses = {
  sm: 'px-1.5 py-0.5 text-[9px]',
  md: 'px-2.5 py-1 text-[10px]',
  lg: 'px-3 py-1.5 text-[11px]',
};

export function Badge({ variant = 'default', size = 'md', pulse = false, neo = false, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-black uppercase tracking-wider rounded-md',
        neo ? 'border-2' : 'border',
        neo ? neoVariantClasses[variant] : variantClasses[variant],
        glowClasses[variant],
        sizeClasses[size],
        neo && 'shadow-[2px_2px_0px_rgba(0,0,0,0.3)]',
        className
      )}
      {...props}
    >
      {pulse && (
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span className={cn(
            'absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping',
            dotColors[variant]
          )} />
          <span className={cn(
            'relative inline-flex rounded-full h-2 w-2',
            dotColors[variant]
          )} />
        </span>
      )}
      {children}
    </span>
  );
}

/* Signal-specific badge for stock recommendations */
type SignalType = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

interface SignalBadgeProps {
  signal: string;
  className?: string;
}

const signalConfig: Record<SignalType, { label: string; variant: BadgeVariant; glow: string }> = {
  STRONG_BUY: {
    label: 'STRONG BUY',
    variant: 'success',
    glow: 'shadow-[0_0_16px_rgba(34,197,94,0.35)] ring-1 ring-green-500/30',
  },
  BUY: {
    label: 'BUY',
    variant: 'success',
    glow: 'shadow-[0_0_10px_rgba(74,222,128,0.2)]',
  },
  NEUTRAL: {
    label: 'NEUTRAL',
    variant: 'default',
    glow: '',
  },
  SELL: {
    label: 'SELL',
    variant: 'danger',
    glow: 'shadow-[0_0_10px_rgba(248,113,113,0.2)]',
  },
  STRONG_SELL: {
    label: 'STRONG SELL',
    variant: 'danger',
    glow: 'shadow-[0_0_16px_rgba(239,68,68,0.35)] ring-1 ring-red-500/30',
  },
};

export function SignalBadge({ signal, className }: SignalBadgeProps) {
  const config = signalConfig[signal as SignalType] || signalConfig.NEUTRAL;
  const isPulsing = signal === 'STRONG_BUY' || signal === 'STRONG_SELL';

  return (
    <Badge
      variant={config.variant}
      size="md"
      pulse={isPulsing}
      className={cn(
        'text-[11px] py-1.5 px-3 rounded-lg font-num',
        config.glow,
        className
      )}
    >
      {config.label}
    </Badge>
  );
}
