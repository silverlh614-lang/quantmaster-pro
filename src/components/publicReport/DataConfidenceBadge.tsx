// @responsibility Public report data-confidence badge compatibility wrapper.

import React from 'react';
import {
  DataConfidenceBadge as CommonDataConfidenceBadge,
  type DataConfidenceBadgeProps as CommonDataConfidenceBadgeProps,
} from '../common/DataConfidenceBadge';
import type { DataConfidence } from '../../public-report/reportTypes';

interface DataConfidenceBadgeProps extends Omit<CommonDataConfidenceBadgeProps, 'confidence'> {
  confidence: DataConfidence;
}

export function DataConfidenceBadge(props: DataConfidenceBadgeProps) {
  return <CommonDataConfidenceBadge {...props} />;
}
