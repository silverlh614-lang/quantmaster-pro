import React from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../ui/cn';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useTradeStore } from '../stores';
import type { StockRecommendation } from '../services/stockService';

interface TradeRecordModalProps {
  onRecordTrade: (
    stock: StockRecommendation,
    buyPrice: number,
    quantity: number,
    positionSize: number,
    followedSystem: boolean,
    conditionScores: {},
    scores: { g1: number; g2: number; g3: number; final: number }
  ) => void;
}

export function TradeRecordModal({ onRecordTrade }: TradeRecordModalProps) {
  const { tradeRecordStock, setTradeRecordStock, tradeFormData, setTradeFormData } = useTradeStore();

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
        className="glass-3d rounded-2xl sm:rounded-3xl p-5 sm:p-8 max-w-md w-full border border-theme-border shadow-2xl"
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
        </div>

        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            const bp = parseFloat(tradeFormData.buyPrice) || tradeRecordStock.currentPrice;
            const qty = parseInt(tradeFormData.quantity) || 1;
            const ps = parseFloat(tradeFormData.positionSize) || 10;
            onRecordTrade(
              tradeRecordStock, bp, qty, ps,
              tradeFormData.followedSystem,
              {},
              { g1: 0, g2: 0, g3: 0, final: 0 },
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
