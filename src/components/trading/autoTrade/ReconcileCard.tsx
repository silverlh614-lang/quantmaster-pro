import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { Card } from '../../../ui/card';
import type { ReconcileResponse } from '../../../api';

interface Props {
  data: ReconcileResponse;
  running: boolean;
  onRun: () => void;
}

export function ReconcileCard({ data, running, onRun }: Props) {
  return (
    <Card padding="sm" className={data.dataIntegrityBlocked
      ? '!border-red-500/40 !bg-red-500/[0.04]'
      : data.last && !data.last.integrityOk
        ? '!border-amber-500/40 !bg-amber-500/[0.03]'
        : '!border-green-500/20 !bg-green-500/[0.02]'
    }>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className={cn('w-4 h-4', data.dataIntegrityBlocked ? 'text-red-400' : 'text-green-400')} />
          <span className="font-bold text-sm">이중 기록 Reconciliation</span>
          {data.dataIntegrityBlocked && (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
              매수 차단
            </span>
          )}
        </div>
        <button
          onClick={onRun}
          disabled={running}
          className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-theme-text-muted hover:text-theme-text border border-theme-border/20 transition-colors disabled:opacity-50"
        >
          {running ? '실행중…' : '수동 실행'}
        </button>
      </div>

      {data.last ? (() => {
        const r = data.last!;
        return (
          <div className="space-y-2">
            {/* 대조 수치 3열 */}
            <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
              <div className="rounded-lg bg-white/[0.03] border border-theme-border/15 p-2">
                <p className="text-theme-text-muted text-[9px] uppercase font-bold mb-0.5">shadow-log</p>
                <p className="font-black font-num text-theme-text">{r.shadowLogCloses}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-theme-border/15 p-2">
                <p className="text-theme-text-muted text-[9px] uppercase font-bold mb-0.5">TradeEvent</p>
                <p className="font-black font-num text-theme-text">{r.tradeEventCloses}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-theme-border/15 p-2">
                <p className="text-theme-text-muted text-[9px] uppercase font-bold mb-0.5">ShadowTrades</p>
                <p className="font-black font-num text-theme-text">{r.shadowTradeCloses}</p>
              </div>
            </div>

            {/* 정합성 결과 */}
            <div className="flex items-center justify-between text-xs">
              <span className={cn('font-bold', r.integrityOk ? 'text-green-400' : 'text-red-400')}>
                {r.integrityOk ? `✅ 정합성 ${r.mismatchCount === 0 ? '100%' : '양호'}` : `🚨 불일치 ${r.mismatchCount}건`}
              </span>
              <span className="text-theme-text-muted text-[10px]">
                {r.date} · {new Date(r.ranAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* 불일치 상세 */}
            {r.mismatches.length > 0 && (
              <div className="space-y-1">
                {r.mismatches.slice(0, 3).map((m, mi) => (
                  <div key={mi} className="text-[10px] flex gap-2 items-start">
                    <span className="text-red-400 shrink-0">•</span>
                    <span className="text-theme-text-muted">
                      <span className="font-bold text-theme-text">{m.stockCode}{m.stockName ? `(${m.stockName})` : ''}</span>
                      {' '}{m.issue}
                    </span>
                  </div>
                ))}
                {r.mismatches.length > 3 && (
                  <p className="text-[10px] text-theme-text-muted">외 {r.mismatches.length - 3}건…</p>
                )}
              </div>
            )}
          </div>
        );
      })() : (
        <p className="text-xs text-theme-text-muted text-center py-2">
          Reconciliation 이력 없음 — 수동 실행 또는 KST 23:30 자동 실행 대기
        </p>
      )}
    </Card>
  );
}
