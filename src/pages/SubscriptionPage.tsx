import React from 'react';
import { motion } from 'motion/react';
import { SectorSubscription } from '../components/SectorSubscription';
import { useSettingsStore, useRecommendationStore } from '../stores';

interface SubscriptionPageProps {
  onAddSector: (sector: string) => void;
  onRemoveSector: (sector: string) => void;
}

export function SubscriptionPage({ onAddSector, onRemoveSector }: SubscriptionPageProps) {
  const { subscribedSectors } = useSettingsStore();
  const { recommendations, loading } = useRecommendationStore();

  return (
    <motion.div
      key="subscription-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-12"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <div className="flex items-center gap-4 mb-6">
            <div className="w-3 h-10 bg-amber-500 rounded-full shadow-[0_0_20px_rgba(245,158,11,0.5)]" />
            <h2 className="text-4xl font-black text-white tracking-tighter uppercase">Sector Subscription System</h2>
          </div>
          <p className="text-white/40 font-medium max-w-2xl text-lg">
            관심 섹터를 구독하고 Gate 1 생존 조건을 통과하는 신규 주도주 후보를 실시간으로 감지하세요.
          </p>
        </div>
      </div>
      <SectorSubscription
        subscribedSectors={subscribedSectors}
        onAddSector={onAddSector}
        onRemoveSector={onRemoveSector}
        recommendations={recommendations}
        loading={loading}
      />
    </motion.div>
  );
}
