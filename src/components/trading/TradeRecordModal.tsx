// @responsibility trading 영역 TradeRecordModal 컴포넌트
import React, { useState } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../ui/cn';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { useTradeStore } from '../../stores';
import { DEFAULT_PRE_MORTEMS } from '../../types/quant';
import type { PreMortemItem } from '../../types/quant';
import type { StockRecommendation } from '../../services/stockService';

interface TradeRecordModalProps {
  onRecordTrade: (
    stock: StockRecommendation,
    buyPrice: number,
    quantity: number,
    positionSize: number,
    followedSystem: boolean,
    conditionScores: {},
    scores: { g1: number; g2: number; g3: number; final: number },
    preMortems: PreMortemItem[],
  ) => void;
}

export function TradeRecordModal({ onRecordTrade }: TradeRecordModalProps) {
  const { tradeRecordStock, setTradeRecordStock, tradeFormData, setTradeFormData } = useTradeStore();
  const [showPreMortem, setShowPreMortem] = useState(false);
  const [selectedPreMortems, setSelectedPreMortems] = useState<Set<string>>(
    () => new Set(DEFAULT_PRE_MORTEMS.map(p => p.id))
  );

  const togglePreMortem = (id: string) => {
    setSelectedPreMortems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!tradeRecordStock) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-sm"
      onClick={() => setTradeRecordStock(null)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 12 }}
        className="glass-3d rounded-2xl sm:rounded-3xl p-5 sm:p-8 max-w-md w-full border border-theme-border shadow-2xl overflow-y-auto max-h-[90vh]"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5 sm:mb-6">
          <div className="min-w-0">
            <h3 className="text-lg sm:text-xl font-black text-theme-text truncate">{tradeRecordStock.name} 매수 기록</h3>
            <p className="text-xs text-theme-text-muted font-mono">{tradeRecordStock.code} · {tradeRecordStock.type}</p>
          </div>
          <button onClick={() => setTradeRecordStock(null)} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 shrink-0 ml-3">
            <X className="w-4 h-4 text-theme-text-muted" />
          </button>
        </div>

        <div className="space-y-4">
          <Input
            label="매수가 (원)"
            type="number"
            value={tradeFormData.buyPrice}
            onChange={(e) => setTradeFormData((p: any) => ({ ...p, buyPrice: e.target.value }))}
            placeholder={String(tradeRecordStock.currentPrice)}
          />
          <Input
            label="수량 (주)"
            type="number"
            value={tradeFormData.quantity}
            onChange={(e) => setTradeFormData((p: any) => ({ ...p, quantity: e.target.value }))}
            placeholder="100"
          />
          <Input
            label="포트폴리오 비중 (%)"
            type="number"
            value={tradeFormData.positionSize}
            onChange={(e) => setTradeFormData((p: any) => ({ ...p, positionSize: e.target.value }))}
          />
          <div className="flex items-center gap-4">
            <span className="text-micro">매수 방식</span>
            <div className="flex gap-2">
              <button
                onClick={() => setTradeFormData((p: any) => ({ ...p, followedSystem: true }))}
                className={cn(
                  'text-xs px-4 py-2 rounded-xl font-bold border transition-all',
                  tradeFormData.followedSystem ? 'bg-indigo-500 text-white border-indigo-400' : 'bg-white/5 text-theme-text-muted border-theme-border'
                )}
              >
                SYSTEM
              </button>
              <button
                onClick={() => setTradeFormData((p: any) => ({ ...p, followedSystem: false }))}
                className={cn(
                  'text-xs px-4 py-2 rounded-xl font-bold border transition-all',
                  !tradeFormData.followedSystem ? 'bg-amber-500 text-white border-amber-400' : 'bg-white/5 text-theme-text-muted border-theme-border'
                )}
              >
                INTUITION
              </button>
            </div>
          </div>

          {/* ── Pre-Mortem 무효화 조건 ──────────────────────────────── */}
          <div className="border border-theme-border rounded-xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-theme-text-muted hover:bg-white/5 transition-all"
              onClick={() => setShowPreMortem(v => !v)}
            >
              <span>🧨 Pre-Mortem 무효화 조건 ({selectedPreMortems.size}/{DEFAULT_PRE_MORTEMS.length})</span>
              {showPreMortem ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {showPreMortem && (
              <div className="px-4 pb-4 space-y-2 border-t border-theme-border">
                <p className="text-[10px] text-theme-text-muted pt-3">매수 시점에 무효화 조건을 사전 명시합니다. 발동 시 심리 없이 기계적으로 실행합니다.</p>
                {DEFAULT_PRE_MORTEMS.map(pm => (
                  <label
                    key={pm.id}
                    className={cn(
                      'flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-all',
                      selectedPreMortems.has(pm.id)
                        ? 'border-rose-500/50 bg-rose-500/10'
                        : 'border-theme-border bg-white/2 opacity-50'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPreMortems.has(pm.id)}
                      onChange={() => togglePreMortem(pm.id)}
                      className="mt-0.5 accent-rose-500 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold text-theme-text">{pm.scenario}</span>
                        <span className="text-[9px] text-rose-400 font-mono">→ {pm.trigger}</span>
                      </div>
                      <span className={cn(
                        'inline-block mt-0.5 text-[9px] font-black px-1.5 py-0.5 rounded',
                        pm.actionPct === 100 ? 'bg-red-500/20 text-red-400' :
                        pm.actionPct !== undefined ? 'bg-amber-500/20 text-amber-400' :
                        'bg-slate-500/20 text-slate-400'
                      )}>
                        {pm.action}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            // parseFloat/parseInt 는 빈 문자열을 NaN 으로 돌려주고,
            // `NaN || fallback` 은 fallback 이 undefined 면 그대로 undefined 를
            // 저장해 버리는 함정이 있다. 모든 수치 필드가 유한한 값이 되도록 강제.
            const currentPrice = Number(tradeRecordStock.currentPrice);
            const bpParsed = parseFloat(tradeFormData.buyPrice);
            const bp = Number.isFinite(bpParsed) && bpParsed > 0
              ? bpParsed
              : (Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : 0);
            const qtyParsed = parseInt(tradeFormData.quantity, 10);
            const qty = Number.isFinite(qtyParsed) && qtyParsed > 0 ? qtyParsed : 1;
            const psParsed = parseFloat(tradeFormData.positionSize);
            const ps = Number.isFinite(psParsed) && psParsed > 0 ? psParsed : 10;

            if (bp <= 0) {
              // 현재가도 매수가 입력도 없으면 조용히 저장하지 않고 리턴.
              // (일지 상단이 0원·-로 렌더되는 원인 차단)
              return;
            }

            const preMortems: PreMortemItem[] = DEFAULT_PRE_MORTEMS
              .filter(pm => selectedPreMortems.has(pm.id))
              .map(pm => ({ ...pm, triggered: false }));
            onRecordTrade(
              tradeRecordStock, bp, qty, ps,
              tradeFormData.followedSystem,
              {},
              { g1: 0, g2: 0, g3: 0, final: 0 },
              preMortems,
            );
            setTradeRecordStock(null);
          }}
          disabled={!tradeFormData.quantity}
          className="w-full mt-5 sm:mt-6 bg-emerald-500 hover:bg-emerald-400 shadow-[0_8px_30px_rgba(16,185,129,0.25)] uppercase tracking-widest"
        >
          매수 기록 저장
        </Button>
      </motion.div>
    </motion.div>
  );
}
