/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { MasterChecklistModal } from './MasterChecklistModal';
import { SettingsModal } from './SettingsModal';
import { TradeRecordModal } from '../trading/TradeRecordModal';
import { StockDetailModal } from '../analysis/StockDetailModal';
import { useAnalysisStore } from '../../stores';
import { useTradeOps } from '../../hooks/useTradeOps';

/**
 * App-level modals that are always mounted and controlled by stores.
 */
export function GlobalModals() {
  const { selectedDetailStock, setSelectedDetailStock } = useAnalysisStore();
  const { recordTrade } = useTradeOps();

  return (
    <>
      <MasterChecklistModal />
      <SettingsModal />
      <TradeRecordModal onRecordTrade={recordTrade} />
      <StockDetailModal
        stock={selectedDetailStock}
        onClose={() => setSelectedDetailStock(null)}
      />
    </>
  );
}
