import React from 'react';
import { motion } from 'motion/react';
import { SectorSubscription } from '../components/SectorSubscription';
import { useSettingsStore, useRecommendationStore } from '../stores';
import { PageHeader } from '../ui/page-header';
import { Stack } from '../layout/Stack';

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
    >
      <Stack gap="xl">
        <PageHeader
          title="Sector Subscription System"
          subtitle="섹터 구독 모니터링"
          accentColor="bg-amber-500"
        >
          관심 섹터를 구독하고 Gate 1 생존 조건을 통과하는 신규 주도주 후보를 실시간으로 감지하세요.
        </PageHeader>

        <SectorSubscription
          subscribedSectors={subscribedSectors}
          onAddSector={onAddSector}
          onRemoveSector={onRemoveSector}
          recommendations={recommendations}
          loading={loading}
        />
      </Stack>
    </motion.div>
  );
}
