// @responsibility MarketRegime 위험 요약 문구 컴포넌트
import { Info, ShieldAlert } from 'lucide-react';
import { cn } from '../../ui/cn';
import { deriveRegimeSummary, getMarketRegimeTone, type MarketRegimeView } from '../../lib/marketRegimeViewModel';

const TONE_STYLE = {
  stable: 'border-emerald-500/20 bg-emerald-950/30 text-emerald-50',
  neutral: 'border-sky-500/20 bg-sky-950/30 text-sky-50',
  warning: 'border-amber-500/30 bg-amber-950/40 text-amber-50',
  danger: 'border-red-500/40 bg-red-950/50 text-red-50',
  unknown: 'border-zinc-500/25 bg-zinc-900/50 text-zinc-100',
} as const;

const HINT_LABEL: Record<MarketRegimeView['executionHint'], string> = {
  NORMAL_OPERATION: 'Display-only hint: normal interpretation',
  TIGHTEN_GATE_DISPLAY_ONLY: 'Display-only hint: 박스권 돌파 신호 해석 주의',
  REDUCE_CONFIDENCE_DISPLAY_ONLY: 'Display-only hint: 신호 확신도 낮게 해석',
  BUY_STOP_RECOMMENDED_DISPLAY_ONLY: 'Display-only hint: 신규 매수 보수적 해석 권고',
  OBSERVE_ONLY_DISPLAY: 'Display-only hint: 관찰 우선, 데이터 연결 필요',
};

export function RegimeRiskBanner({ view }: { view: MarketRegimeView }) {
  const tone = getMarketRegimeTone(view.state, view.confidence);
  const Icon = tone === 'danger' || tone === 'warning' ? ShieldAlert : Info;
  return (
    <div className={cn('rounded-xl border p-3', TONE_STYLE[tone])}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-bold leading-snug">{deriveRegimeSummary(view)}</p>
          <p className="mt-1 text-[11px] opacity-70">{HINT_LABEL[view.executionHint]} · 실제 Gate/Scoring/주문 정책은 변경하지 않습니다.</p>
        </div>
      </div>
    </div>
  );
}
