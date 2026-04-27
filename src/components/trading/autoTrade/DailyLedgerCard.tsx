// @responsibility trading 영역 DailyLedgerCard 컴포넌트
import React, { useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { Card } from '../../../ui/card';
import type { ServerShadowTrade } from '../../../api';

interface Props { trades: ServerShadowTrade[]; }

const STARTING_CAPITAL = 100_000_000;

export function DailyLedgerCard({ trades }: Props) {
  const [date, setDate] = useState<string>(
    () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
  );

  const ledger = useMemo(() => {
    const yyyymm = date.slice(0, 7);
    type Row = { stockName: string; stockCode: string; tpPnl: number; slPnl: number; net: number };
    const rows: Row[] = [];
    let mtdNet = 0;

    for (const t of trades) {
      const dayFills = (t.fills ?? []).filter((f) => {
        if (f.type !== 'SELL') return false;
        return new Date(new Date(f.timestamp).getTime() + 9 * 3_600_000).toISOString().slice(0, 10) === date;
      });
      if (dayFills.length > 0) {
        const tpPnl = dayFills
          .filter((f) => f.subType !== 'STOP_LOSS' && f.subType !== 'EMERGENCY')
          .reduce((s, f) => s + (f.pnl ?? 0), 0);
        const slPnl = dayFills
          .filter((f) => f.subType === 'STOP_LOSS' || f.subType === 'EMERGENCY')
          .reduce((s, f) => s + (f.pnl ?? 0), 0);
        rows.push({ stockName: t.stockName, stockCode: t.stockCode, tpPnl, slPnl, net: tpPnl + slPnl });
      }
      // MTD 합산
      const mtdFills = (t.fills ?? []).filter((f) =>
        f.type === 'SELL' &&
        new Date(new Date(f.timestamp).getTime() + 9 * 3_600_000).toISOString().slice(0, 7) === yyyymm
      );
      mtdNet += mtdFills.reduce((s, f) => s + (f.pnl ?? 0), 0);
    }
    rows.sort((a, b) => b.net - a.net);
    const dayNet = rows.reduce((s, r) => s + r.net, 0);
    return { date, rows, dayNet, mtdNet };
  }, [trades, date]);

  const exportCSV = () => {
    const header = '날짜,종목명,종목코드,익절PnL,손절PnL,순손익';
    const lines = ledger.rows.map(r =>
      `${ledger.date},${r.stockName},${r.stockCode},${r.tpPnl},${r.slPnl},${r.net}`
    );
    lines.push(`${ledger.date},Day Net,,,, ${ledger.dayNet}`);
    const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-${ledger.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const maxDate = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

  return (
    <Card padding="sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-cyan-400" />
          <span className="font-bold text-sm">실현 현금흐름 장부</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={maxDate}
            onChange={e => setDate(e.target.value)}
            className="text-[11px] bg-white/5 border border-theme-border/20 rounded px-2 py-1 text-theme-text font-num focus:outline-none"
          />
          {ledger.rows.length > 0 && (
            <button
              onClick={exportCSV}
              className="text-[10px] px-2 py-1 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 transition-colors"
            >
              CSV
            </button>
          )}
        </div>
      </div>

      {ledger.rows.length === 0 ? (
        <p className="text-xs text-center py-4 text-theme-text-muted">
          {date} — 실현된 SELL fill 없음
        </p>
      ) : (
        <div className="space-y-1.5">
          {ledger.rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-theme-text truncate">{r.stockName}</span>
                <span className="text-theme-text-muted text-[10px] shrink-0">{r.stockCode}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] shrink-0 font-num">
                {r.tpPnl !== 0 && (
                  <span className="text-green-400/80">TP {r.tpPnl >= 0 ? '+' : ''}{Math.round(r.tpPnl).toLocaleString()}</span>
                )}
                {r.slPnl !== 0 && (
                  <span className="text-red-400/80">SL {r.slPnl >= 0 ? '+' : ''}{Math.round(r.slPnl).toLocaleString()}</span>
                )}
                <span className={cn('font-black', r.net >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {r.net >= 0 ? '+' : ''}{Math.round(r.net).toLocaleString()}원
                </span>
              </div>
            </div>
          ))}
          {/* 구분선 + 합계 */}
          <div className="pt-2 mt-1 border-t border-theme-border/20 space-y-1">
            <div className="flex justify-between text-[11px] font-bold">
              <span className="text-theme-text-muted">Day Net ({ledger.date})</span>
              <span className={cn('font-black font-num', ledger.dayNet >= 0 ? 'text-green-400' : 'text-red-400')}>
                {ledger.dayNet >= 0 ? '+' : ''}{Math.round(ledger.dayNet).toLocaleString()}원
                <span className="text-theme-text-muted font-normal ml-1 text-[9px]">
                  ({(ledger.dayNet / STARTING_CAPITAL * 100).toFixed(3)}% / 1억)
                </span>
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-theme-text-muted">MTD Net ({ledger.date.slice(0, 7)})</span>
              <span className={cn('font-bold font-num', ledger.mtdNet >= 0 ? 'text-green-400/80' : 'text-red-400/80')}>
                {ledger.mtdNet >= 0 ? '+' : ''}{Math.round(ledger.mtdNet).toLocaleString()}원
                <span className="text-theme-text-muted font-normal ml-1">
                  ({(ledger.mtdNet / STARTING_CAPITAL * 100).toFixed(2)}%)
                </span>
              </span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
