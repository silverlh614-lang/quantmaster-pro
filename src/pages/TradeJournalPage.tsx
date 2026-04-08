import React from 'react';
import { motion } from 'motion/react';
import { TradeJournal } from '../components/TradeJournal';
import { useTradeStore } from '../stores';
import type { TradeRecord } from '../types/quant';

interface TradeJournalPageProps {
  onCloseTrade: (tradeId: string, sellPrice: number, sellReason: TradeRecord['sellReason']) => void;
  onDeleteTrade: (tradeId: string) => void;
  onUpdateMemo: (tradeId: string, memo: string) => void;
}

export function TradeJournalPage({ onCloseTrade, onDeleteTrade, onUpdateMemo }: TradeJournalPageProps) {
  const { tradeRecords } = useTradeStore();

  return (
    <motion.div
      key="trade-journal-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-12"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="flex items-center gap-4">
          <div className="w-3 h-10 bg-emerald-500 rounded-full shadow-[0_0_20px_rgba(16,185,129,0.5)]" />
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight uppercase">실전 성과 관리</h2>
            <p className="text-xs font-bold text-white/30 uppercase tracking-[0.2em]">Trade Journal · Condition Performance · System vs Intuition</p>
          </div>
        </div>
      </div>
      <TradeJournal
        trades={tradeRecords}
        onCloseTrade={onCloseTrade}
        onDeleteTrade={onDeleteTrade}
        onUpdateMemo={onUpdateMemo}
      />
    </motion.div>
  );
}
