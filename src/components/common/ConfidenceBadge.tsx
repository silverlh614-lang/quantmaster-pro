// @responsibility legacy data-source badge adapter backed by 전역 DataConfidenceBadge
import React from 'react';
import { DataConfidenceBadge, type DataConfidence } from './DataConfidenceBadge';

type DataSourceType = 'AI' | 'REALTIME' | 'YAHOO' | 'STALE';

interface ConfidenceBadgeProps {
  type: DataSourceType;
}

const SOURCE_TO_CONFIDENCE: Record<DataSourceType, { confidence: DataConfidence; source: string; label: string }> = {
  REALTIME: { confidence: 'VERIFIED', source: 'KIS real-time', label: 'KIS 실시간' },
  YAHOO: { confidence: 'DEGRADED', source: 'Yahoo delayed/API', label: 'Yahoo 참고' },
  AI: { confidence: 'AI_ESTIMATED', source: 'AI inference', label: 'AI 추정' },
  STALE: { confidence: 'STALE', source: 'stale price feed', label: '가격 지연' },
};

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({ type }) => {
  const badge = SOURCE_TO_CONFIDENCE[type] ?? SOURCE_TO_CONFIDENCE.STALE;
  return (
    <DataConfidenceBadge
      confidence={badge.confidence}
      source={badge.source}
      label={badge.label}
      compact
    />
  );
};
