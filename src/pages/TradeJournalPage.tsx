// @responsibility TradeJournalPage 페이지 컴포넌트
import React from 'react';
import { motion } from 'motion/react';
import { TradeJournal } from '../components/trading/TradeJournal';
import { useTradeStore } from '../stores';
import { PageHeader } from '../ui/page-header';
import { Stack } from '../layout/Stack';
import type { TradeRecord } from '../types/quant';

interface TradeJournalPageProps {
  onCloseTrade: (tradeId: string, sellPrice: number, sellReason: TradeRecord['sellReason']) => void;
  onDeleteTrade: (tradeId: string) => void;
  onUpdateMemo: (tradeId: string, memo: string) => void;
  onTriggerPreMortem: (tradeId: string, preMortemId: string) => void;
}

export function TradeJournalPage({ onCloseTrade, onDeleteTrade, onUpdateMemo, onTriggerPreMortem }: TradeJournalPageProps) {
  const { tradeRecords } = useTradeStore();

  return (
    <motion.div
      key="trade-journal-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Stack gap="xl">
        <PageHeader
          title="실전 성과 관리"
          subtitle="Trade Journal · Condition Performance · System vs Intuition"
          accentColor="bg-emerald-500"
        />

        <TradeJournal
          trades={tradeRecords}
          onCloseTrade={onCloseTrade}
          onDeleteTrade={onDeleteTrade}
          onUpdateMemo={onUpdateMemo}
          onTriggerPreMortem={onTriggerPreMortem}
        />
      </Stack>
    </motion.div>
  );
}
