import React from 'react';

type DataSourceType = 'AI' | 'REALTIME' | 'YAHOO' | 'STALE';

interface ConfidenceBadgeProps {
  type: DataSourceType;
}

const BADGE: Record<DataSourceType, { label: string; className: string }> = {
  REALTIME: { label: '🟢 KIS실시간', className: 'bg-green-900 text-green-200' },
  YAHOO:    { label: '🟡 Yahoo',     className: 'bg-yellow-900 text-yellow-200' },
  AI:       { label: '🔴 AI추정',    className: 'bg-red-900 text-red-200' },
  STALE:    { label: '⚫ 가격지연',   className: 'bg-gray-800 text-gray-400' },
};

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({ type }) => {
  const { label, className } = BADGE[type] ?? BADGE.STALE;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {label}
    </span>
  );
};
