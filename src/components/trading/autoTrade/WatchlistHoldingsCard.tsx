import React, { useState } from 'react';
import { Eye, Briefcase } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { Card } from '../../../ui/card';
import { Badge } from '../../../ui/badge';
import type { WatchlistEntry, KisHolding } from '../../../api';
import { GATE_TOOLTIPS } from './constants';

interface Props {
  watchlist: WatchlistEntry[];
  holdings: KisHolding[];
}

export function WatchlistHoldingsCard({ watchlist, holdings }: Props) {
  const [tab, setTab] = useState<'watchlist' | 'holdings'>('watchlist');

  return (
    <Card padding="md">
      {/* Tab Header */}
      <div className="flex items-center gap-4 mb-4 border-b border-theme-border/40 pb-3">
        <button
          onClick={() => setTab('watchlist')}
          className={cn(
            'flex items-center gap-1.5 text-sm font-bold pb-1 border-b-2 transition-colors',
            tab === 'watchlist'
              ? 'border-violet-400 text-violet-300'
              : 'border-transparent text-theme-text-muted hover:text-theme-text'
          )}
        >
          <Eye className="w-4 h-4" />
          워치리스트 <span className="text-xs opacity-70">({watchlist.length})</span>
        </button>
        <button
          onClick={() => setTab('holdings')}
          className={cn(
            'flex items-center gap-1.5 text-sm font-bold pb-1 border-b-2 transition-colors',
            tab === 'holdings'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-theme-text-muted hover:text-theme-text'
          )}
        >
          <Briefcase className="w-4 h-4" />
          보유종목 <span className="text-xs opacity-70">({holdings.length})</span>
        </button>
      </div>

      {tab === 'watchlist' && (
        watchlist.length === 0 ? (
          <p className="text-micro text-center py-6">워치리스트가 비어 있습니다.</p>
        ) : (
          <div className="space-y-2">
            {watchlist.map((w) => (
              <div key={w.code} className="flex items-center justify-between gap-3 py-2 border-b border-theme-border/20 last:border-0">
                <div className="min-w-0">
                  <span className="text-sm font-bold text-theme-text truncate">{w.name}</span>
                  <span className="text-micro ml-2">{w.code}</span>
                  {w.isFocus && <Badge variant="violet" size="sm" className="ml-2">FOCUS</Badge>}
                </div>
                <div className="flex items-center gap-3 text-xs shrink-0">
                  {w.gateScore != null && (
                    <span
                      className="text-theme-text-muted cursor-help"
                      title={`Gate Score: ${w.gateScore}점\n${GATE_TOOLTIPS[1]}\n${GATE_TOOLTIPS[2]}\n${GATE_TOOLTIPS[3]}`}
                    >G{w.gateScore}</span>
                  )}
                  <span className="text-theme-text-muted">{w.entryPrice.toLocaleString()}</span>
                  <Badge variant={w.addedBy === 'AUTO' ? 'success' : w.addedBy === 'DART' ? 'violet' : 'default'} size="sm">
                    {w.addedBy}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'holdings' && (
        holdings.length === 0 ? (
          <p className="text-micro text-center py-6">보유 중인 종목이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {holdings.map((h) => {
              const pfRate = parseFloat(h.evlu_pfls_rt ?? '0');
              return (
                <div key={h.pdno} className="flex items-center justify-between gap-3 py-2 border-b border-theme-border/20 last:border-0">
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-theme-text truncate">{h.prdt_name}</span>
                    <span className="text-micro ml-2">{h.pdno}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    <span className="text-theme-text-muted">{Number(h.hldg_qty).toLocaleString()}주</span>
                    <span className="text-theme-text-muted">평단 {Number(h.pchs_avg_pric).toLocaleString()}</span>
                    <span className={cn('font-bold', pfRate >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {pfRate >= 0 ? '+' : ''}{pfRate.toFixed(2)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </Card>
  );
}
