// @responsibility legacy data-source badge adapter backed by 전역 DataConfidenceBadge
import React from 'react';
import { DataConfidenceBadge, type DataConfidence } from './DataConfidenceBadge';

type DataSourceType = 'AI' | 'REALTIME' | 'NAVER' | 'YAHOO' | 'STALE';

interface ConfidenceBadgeProps {
  type: DataSourceType;
}

const SOURCE_TO_CONFIDENCE: Record<DataSourceType, { confidence: DataConfidence; source: string; label: string }> = {
  REALTIME: { confidence: 'VERIFIED', source: 'KIS real-time', label: 'KIS 실시간' },
  NAVER:    { confidence: 'DEGRADED', source: 'Naver mobile snapshot (KRX 시세)', label: 'Naver 시세' },
  // YAHOO 는 신뢰 철회 (split/통화/티커 매핑 오차로 ~10배 왜곡 사례 반복) — 잔존
  // 데이터 호환을 위해 매핑은 유지하되 'STALE'(가격 지연) 등급으로 강등 표기.
  YAHOO:    { confidence: 'STALE', source: 'Yahoo (사용 중단)', label: 'Yahoo (사용 중단)' },
  AI:       { confidence: 'AI_ESTIMATED', source: 'AI inference', label: 'AI 추정' },
  // STALE — 신뢰 가능한 가격 소스(KIS/Naver) 모두 실패. PriceDisplay 가
  // usePriceCanon 으로 자동 재시도 중 — UI 는 "갱신 중..." 톤으로 표현.
  STALE:    { confidence: 'STALE', source: 'KIS·Naver 모두 미확보 — 자동 재시도 중', label: '갱신 중...' },
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
