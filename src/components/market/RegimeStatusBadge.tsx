// @responsibility MarketRegime 상태 배지 표시 컴포넌트
import { AlertTriangle, CircleHelp, ShieldCheck, Siren, Waves } from 'lucide-react';
import { cn } from '../../ui/cn';
import { getMarketRegimeTone, getRegimeConfidenceLabel, type MarketRegimeView } from '../../lib/marketRegimeViewModel';

const TONE_STYLE = {
  stable: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-100',
  neutral: 'border-sky-500/30 bg-sky-500/15 text-sky-100',
  warning: 'border-amber-500/40 bg-amber-500/15 text-amber-100',
  danger: 'border-red-500/50 bg-red-500/20 text-red-100',
  unknown: 'border-zinc-500/40 bg-zinc-500/15 text-zinc-100',
} as const;

function StatusIcon({ state }: { state: MarketRegimeView['state'] }) {
  if (state === 'CRISIS') return <Siren className="h-4 w-4" aria-hidden />;
  if (state === 'UNCERTAIN') return <AlertTriangle className="h-4 w-4" aria-hidden />;
  if (state === 'RANGE_BOUND') return <Waves className="h-4 w-4" aria-hidden />;
  if (state === 'NORMAL') return <ShieldCheck className="h-4 w-4" aria-hidden />;
  return <CircleHelp className="h-4 w-4" aria-hidden />;
}

export function RegimeStatusBadge({ view }: { view: MarketRegimeView }) {
  const tone = getMarketRegimeTone(view.state, view.confidence);
  return (
    <div className={cn('inline-flex items-center gap-2 rounded-lg border px-3 py-2', TONE_STYLE[tone])} data-regime-state={view.state}>
      <StatusIcon state={view.state} />
      <div className="leading-tight">
        <div className="text-xs font-black tracking-tight font-num">{view.state}</div>
        <div className="text-[10px] font-bold opacity-75">{getRegimeConfidenceLabel(view.confidence)}</div>
      </div>
    </div>
  );
}
