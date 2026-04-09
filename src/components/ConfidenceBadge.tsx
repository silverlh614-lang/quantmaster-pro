import React from 'react';

type DataSourceType = 'AI' | 'REALTIME' | 'YAHOO' | 'STALE';

interface ConfidenceBadgeProps {
  type: DataSourceType;
}

const BADGE: Record<DataSourceType, { label: string; dotColor: string; className: string }> = {
  REALTIME: { label: 'KIS실시간', dotColor: 'bg-green-500',  className: 'bg-green-900 text-green-200' },
  YAHOO:    { label: 'Yahoo',     dotColor: 'bg-yellow-500', className: 'bg-yellow-900 text-yellow-200' },
  AI:       { label: 'AI추정',    dotColor: 'bg-red-500',    className: 'bg-red-900 text-red-200' },
  STALE:    { label: '가격지연',   dotColor: 'bg-gray-500',   className: 'bg-gray-800 text-gray-400' },
};

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({ type }) => {
  const { label, dotColor, className } = BADGE[type] ?? BADGE.STALE;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
      {label}
    </span>
  );
};
