// @responsibility MarketRegime 근거 패널 표시 컴포넌트
import { DatabaseZap, LineChart, MinusCircle, RefreshCcw } from 'lucide-react';
import { cn } from '../../ui/cn';
import { formatRegimeUpdatedAt, splitRegimeEvidence, type RegimeEvidenceItem } from '../../lib/marketRegimeViewModel';

const DIRECTION_STYLE: Record<NonNullable<RegimeEvidenceItem['direction']>, string> = {
  BULLISH: 'text-emerald-200 bg-emerald-500/15 border-emerald-500/25',
  BEARISH: 'text-red-200 bg-red-500/15 border-red-500/25',
  NEUTRAL: 'text-zinc-200 bg-zinc-500/10 border-zinc-500/20',
  MIXED: 'text-amber-200 bg-amber-500/15 border-amber-500/25',
  UNKNOWN: 'text-zinc-300 bg-zinc-700/20 border-zinc-600/25',
};

const CONFIDENCE_STYLE: Record<NonNullable<RegimeEvidenceItem['confidence']>, string> = {
  VERIFIED: 'text-emerald-200',
  DEGRADED: 'text-orange-200',
  STALE: 'text-amber-200',
  MISSING: 'text-zinc-300',
  AI_ESTIMATED: 'text-sky-200',
  UNKNOWN: 'text-zinc-300',
};

function EvidenceRow({ item }: { item: RegimeEvidenceItem }) {
  const direction = item.direction ?? 'UNKNOWN';
  const confidence = item.confidence ?? 'UNKNOWN';
  return (
    <li className="grid grid-cols-1 gap-2 rounded-lg border border-white/10 bg-black/15 p-2 sm:grid-cols-[1.2fr_1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="text-xs font-bold text-white/90">{item.label}</div>
        <div className="text-[10px] text-white/45">{item.source ?? 'source unavailable'} · {formatRegimeUpdatedAt(item.updatedAt)}</div>
      </div>
      <div className="truncate text-xs font-num text-white/75">{item.value ?? '—'}</div>
      <div className="flex flex-wrap gap-1.5">
        <span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-black', DIRECTION_STYLE[direction])}>{direction}</span>
        <span className={cn('rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-black', CONFIDENCE_STYLE[confidence])}>{confidence}</span>
      </div>
    </li>
  );
}

function EvidenceGroup({ title, items, icon }: { title: string; items: RegimeEvidenceItem[]; icon: 'provider' | 'signal' | 'missing' | 'mixed' }) {
  const Icon = icon === 'provider' ? DatabaseZap : icon === 'signal' ? LineChart : icon === 'missing' ? RefreshCcw : MinusCircle;
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/55">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {title} <span className="font-num">({items.length})</span>
      </h4>
      {items.length > 0 ? <ul className="space-y-1.5">{items.map(item => <EvidenceRow key={item.key} item={item} />)}</ul> : <p className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-xs text-white/35">No entries.</p>}
    </section>
  );
}

export function RegimeEvidencePanel({ evidence }: { evidence: RegimeEvidenceItem[] }) {
  const groups = splitRegimeEvidence(evidence);
  const remaining = evidence.filter(item => !groups.providerIssues.includes(item) && !groups.marketSignals.includes(item) && !groups.missingData.includes(item) && !groups.mixedSignals.includes(item));
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <EvidenceGroup title="Provider Issues" icon="provider" items={groups.providerIssues} />
      <EvidenceGroup title="Market Signals" icon="signal" items={groups.marketSignals} />
      <EvidenceGroup title="Missing / Stale Data" icon="missing" items={groups.missingData} />
      <EvidenceGroup title="Mixed Signals" icon="mixed" items={groups.mixedSignals} />
      {remaining.length > 0 && <EvidenceGroup title="Supporting Evidence" icon="signal" items={remaining} />}
    </div>
  );
}
