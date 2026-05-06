/**
 * @responsibility "No Zero Fallback" 원칙을 강제하는 데이터 컨트랙트
 */

export type MetricQuality = 'HIGH' | 'MEDIUM' | 'LOW';

export type MissingMetricReason =
  | 'HOLIDAY_NO_DATA'
  | 'API_EMPTY'
  | 'SOURCE_UNAVAILABLE'
  | 'BASELINE_MISMATCH'
  | 'STALE_DATA'
  | 'NOT_APPLICABLE';

export type MetricValue<T> =
  | {
      status: 'OK';
      value: T;
      asOfDate: string;
      source: string;
      quality: MetricQuality;
    }
  | {
      status: 'MISSING';
      value: null;
      reason: MissingMetricReason;
      asOfDate?: string;
      source?: string;
      quality?: MetricQuality;
    };