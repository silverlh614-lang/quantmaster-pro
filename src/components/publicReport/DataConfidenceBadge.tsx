// @responsibility Public report data-confidence badge.

import React from 'react';
import { Badge } from '../../ui/badge';
import type { DataConfidence } from '../../public-report/reportTypes';

interface DataConfidenceBadgeProps {
  confidence: DataConfidence;
  label?: string;
}

function variantFor(confidence: DataConfidence): React.ComponentProps<typeof Badge>['variant'] {
  if (confidence === 'VERIFIED') return 'success';
  if (confidence === 'AI_ESTIMATED') return 'violet';
  if (confidence === 'DEGRADED' || confidence === 'STALE') return 'warning';
  return 'danger';
}

export function DataConfidenceBadge({ confidence, label }: DataConfidenceBadgeProps) {
  return (
    <Badge variant={variantFor(confidence)} size="sm" title={`dataConfidence=${confidence}`}>
      {label ?? confidence}
    </Badge>
  );
}
