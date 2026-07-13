/**
 * @responsibility Telegram display metric shape definitions.
 *
 * Shared display-only metric schema for Telegram formatter clarity.
 *
 * This type is intentionally presentation-only: it must not become a source
 * of trading, promotion, or order-path decisions.
 */
type DisplayMetricDenominatorLabel =
  | 'closed_samples'
  | 'active_samples'
  | 'all_shadow_samples'
  | 'fills'
  | 'transition_evaluated_samples'
  | 'transition_required_samples';

export interface DisplayMetric {
  label: string;
  value: string;
  numerator?: number;
  denominator?: number;
  denominatorLabel: DisplayMetricDenominatorLabel;
  target?: string;
  passed?: boolean;
  note?: string;
}
