import React from 'react';
import { motion } from 'motion/react';
import { ManualQuantInput } from '../components/ManualQuantInput';
import { useMarketStore } from '../stores';

export function ManualInputPage() {
  const { marketOverview } = useMarketStore();

  return (
    <motion.div
      key="manual-input-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-12"
    >
      <ManualQuantInput
        regime={marketOverview?.regimeShiftDetector?.currentRegime ? {
          type: marketOverview.regimeShiftDetector.currentRegime as any,
          weightMultipliers: marketOverview.dynamicWeights || {},
          vKospi: 15.5,
          samsungIri: 0.85
        } : {
          type: '상승초기',
          weightMultipliers: {},
          vKospi: 15.5,
          samsungIri: 0.85
        }}
        sectorRotation={marketOverview?.sectorRotation?.topSectors?.[0] ? {
          name: (marketOverview.sectorRotation.topSectors[0] as any).sector || '반도체',
          rank: 1,
          strength: marketOverview.sectorRotation.topSectors[0].strength,
          isLeading: true,
          sectorLeaderNewHigh: true
        } : {
          name: '반도체',
          rank: 1,
          strength: 85,
          isLeading: true,
          sectorLeaderNewHigh: true
        }}
      />
    </motion.div>
  );
}
