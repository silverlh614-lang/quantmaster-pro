import React from 'react';

interface ConfidenceBadgeProps {
  type: 'AI' | 'REALTIME';
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({ type }) => {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${type === 'AI' ? 'bg-red-900 text-red-200' : 'bg-green-900 text-green-200'}`}>
      {type === 'AI' ? '🔴 AI추정' : '🟢 실시간'}
    </span>
  );
};
