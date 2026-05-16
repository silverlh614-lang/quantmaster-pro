// @responsibility Shadow integrity issue contracts.
export type IntegritySeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export interface IntegrityIssue {
  item: string;
  count: number;
  severity: IntegritySeverity;
  examples: string[];
}
