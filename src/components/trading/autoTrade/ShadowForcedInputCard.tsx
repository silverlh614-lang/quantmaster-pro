import React, { useMemo, useState } from 'react';
import { Wrench, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Card } from '../../../ui/card';
import { cn } from '../../../ui/cn';
import { autoTradeApi, type ServerShadowTrade } from '../../../api';
import { getRemainingQty } from './shadowTradeFills';

interface Props {
  trades: ServerShadowTrade[];
  /** 서버 저장 성공 후 상위 캐시를 재동기화할 훅(선택). */
  onSynced?: () => void;
}

type EditableKey = 'quantity' | 'shadowEntryPrice' | 'signalPrice' | 'stopLoss' | 'targetPrice';

const EDITABLE_LABELS: Record<EditableKey, string> = {
  quantity: '수량',
  shadowEntryPrice: '진입가',
  signalPrice: '신호가',
  stopLoss: '손절가',
  targetPrice: '목표가',
};

type Draft = Partial<Record<EditableKey, string>>;

function currentValue(trade: ServerShadowTrade, key: EditableKey): number {
  if (key === 'quantity') return getRemainingQty(trade) || trade.quantity || 0;
  return (trade[key] as number | undefined) ?? 0;
}

/**
 * Shadow Forced Input Card
 *
 * Shadow 레코드와 실제 체결·브로커 잔고 사이에 불일치가 발생했을 때,
 * 운영자가 UI에서 수량·가격 등을 강제로 덮어쓰고 서버 상태와 즉시
 * 동기화할 수 있도록 한다.
 *
 * 허용 필드: quantity / shadowEntryPrice / signalPrice / stopLoss / targetPrice.
 * fills·originalQuantity 같은 파생·감사 필드는 서버가 무시한다.
 */
export function ShadowForcedInputCard({ trades, onSynced }: Props) {
  const openTrades = useMemo(
    () => trades
      .filter((t) => t.status !== 'HIT_TARGET' && t.status !== 'HIT_STOP' && t.status !== 'REJECTED')
      .sort((a, b) => new Date(b.signalTime).getTime() - new Date(a.signalTime).getTime()),
    [trades],
  );

  const [selectedId, setSelectedId] = useState<string>('');
  const [draft, setDraft] = useState<Draft>({});
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const selected = openTrades.find((t) => (t.id ?? '') === selectedId) ?? null;

  const pick = (id: string) => {
    setSelectedId(id);
    setDraft({});
    setFlash(null);
  };

  const setField = (key: EditableKey, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const buildPatch = (): Record<string, number | string> | null => {
    if (!selected) return null;
    const patch: Record<string, number | string> = {};
    for (const key of Object.keys(EDITABLE_LABELS) as EditableKey[]) {
      const raw = draft[key];
      if (raw === undefined || raw === '') continue;
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 0) return null;
      if (num === currentValue(selected, key)) continue;
      patch[key] = num;
    }
    if (reason.trim()) patch.reason = reason.trim();
    return patch;
  };

  const submit = async () => {
    if (!selected?.id) return;
    const patch = buildPatch();
    if (!patch) {
      setFlash({ kind: 'err', msg: '입력 값이 유효하지 않습니다 (음수 또는 숫자 오류).' });
      return;
    }
    const numericKeys = Object.keys(patch).filter((k) => k !== 'reason');
    if (numericKeys.length === 0) {
      setFlash({ kind: 'err', msg: '변경된 값이 없습니다.' });
      return;
    }
    setSubmitting(true);
    setFlash(null);
    try {
      const res = await autoTradeApi.forceUpdateShadowTrade(selected.id, patch);
      if (res.changed) {
        const summary = Object.entries(res.applied ?? {})
          .map(([k, v]) => `${EDITABLE_LABELS[k as EditableKey] ?? k}: ${v.before} → ${v.after}`)
          .join(' · ');
        setFlash({ kind: 'ok', msg: `동기화 완료 — ${summary}` });
        setDraft({});
        setReason('');
        onSynced?.();
      } else {
        setFlash({ kind: 'ok', msg: '변경 없음 (서버 값이 이미 동일).' });
      }
    } catch (err) {
      setFlash({ kind: 'err', msg: `동기화 실패: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card padding="sm" className="!border-amber-500/30 !bg-amber-500/[0.03]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-amber-400" />
          <span className="font-bold text-sm">Shadow 강제 입력 · 수동 동기화</span>
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
            불일치 보정 전용
          </span>
        </div>
      </div>

      <div className="flex items-start gap-1.5 text-[10px] text-amber-200/80 leading-relaxed mb-3">
        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
        <p>
          Reconcile 불일치 등 Shadow 레코드가 실제와 어긋날 때만 사용하세요. 입력한 값은 즉시 서버에
          저장되며 shadow 로그에 <span className="font-bold">FORCED_INPUT</span>으로 기록됩니다.
        </p>
      </div>

      {openTrades.length === 0 ? (
        <p className="text-xs text-theme-text-muted text-center py-3">
          미결 Shadow 포지션이 없습니다.
        </p>
      ) : (
        <>
          <label className="block text-[10px] font-black text-theme-text-muted uppercase tracking-[0.15em] mb-1.5">
            대상 포지션
          </label>
          <select
            value={selectedId}
            onChange={(e) => pick(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-theme-text focus:outline-none focus:border-amber-500/40 mb-3"
          >
            <option value="">— 포지션 선택 —</option>
            {openTrades.map((t) => (
              <option key={t.id ?? `${t.stockCode}-${t.signalTime}`} value={t.id ?? ''}>
                {t.stockName}({t.stockCode}) · {t.status} · 잔여 {getRemainingQty(t)}주
              </option>
            ))}
          </select>

          {selected && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(EDITABLE_LABELS) as EditableKey[]).map((key) => {
                  const cur = currentValue(selected, key);
                  const val = draft[key] ?? '';
                  return (
                    <div key={key} className="rounded-lg bg-white/[0.03] border border-theme-border/15 p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-wider">
                          {EDITABLE_LABELS[key]}
                        </span>
                        <span className="text-[10px] text-theme-text-muted font-num">
                          현재: <span className="font-bold text-theme-text">{cur.toLocaleString()}</span>
                        </span>
                      </div>
                      <input
                        type="number"
                        min={0}
                        step={key === 'quantity' ? 1 : 'any'}
                        inputMode="decimal"
                        placeholder={cur.toLocaleString()}
                        value={val}
                        onChange={(e) => setField(key, e.target.value)}
                        className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2 py-1.5 text-xs font-num text-theme-text focus:outline-none focus:border-amber-500/40"
                      />
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="block text-[10px] font-black text-theme-text-muted uppercase tracking-[0.15em] mb-1.5">
                  사유 (선택)
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="예: KIS 잔고와 수량 불일치 — 실체결 기준 보정"
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-theme-text focus:outline-none focus:border-amber-500/40"
                />
              </div>

              {flash && (
                <div
                  className={cn(
                    'flex items-start gap-1.5 text-[10px] rounded-md px-2 py-1.5 border',
                    flash.kind === 'ok'
                      ? 'bg-green-500/10 border-green-500/30 text-green-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300',
                  )}
                >
                  {flash.kind === 'ok' ? (
                    <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  )}
                  <span>{flash.msg}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => { setDraft({}); setReason(''); setFlash(null); }}
                  disabled={submitting}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-theme-text-muted hover:text-theme-text border border-theme-border/20 transition-colors disabled:opacity-50"
                >
                  초기화
                </button>
                <button
                  onClick={submit}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={cn('w-3 h-3', submitting && 'animate-spin')} />
                  {submitting ? '동기화중…' : '강제 입력 · 서버 동기화'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
