// @responsibility Shared warning contracts for auxiliary operational diagnostics.

export type ProviderWarnSource =
  | 'GEMINI'
  | 'GOOGLE_SEARCH'
  | 'DART'
  | 'YAHOO'
  | 'LOCAL_RAG'
  | 'AI_PROVIDER'
  | 'SCREENER'
  | 'SECTOR'
  | 'KIS_AUX'
  | 'KRX_AUX';

export type ReportSection =
  | 'SCAN_BLOCKERS'
  | 'LEARNING_STATUS'
  | 'NORMAL_SUPPLY_PREVIEW'
  | 'PROGRAM_MARKET'
  | 'PROGRAM_TODAY'
  | 'R3_UNBLOCK'
  | 'UNMANAGE_ONLY'
  | 'MARKET_REPORT'
  | 'POSITION_REPORT'
  | 'PNL_REPORT';

export type P2WarnPayload = {
  priority: 'P2';
  domain: 'PROVIDER' | 'TELEGRAM' | 'DIAGNOSTIC' | 'UI';
  code: string;
  message: string;
  source?: ProviderWarnSource;
  section?: ReportSection;
  executionImpact: 'NONE';
  providerIssue?: boolean;
  marketSignal?: false;
  fallbackUsed?: boolean;
  degradedSection?: boolean;
  dedupKey: string;
  ttlSec: 300;
  details?: Record<string, unknown>;
};


export const P2_WARN_CODES = [
  'P2_PROVIDER_GEMINI_DEGRADED',
  'P2_PROVIDER_GOOGLE_SEARCH_DEGRADED',
  'P2_PROVIDER_DART_DEGRADED',
  'P2_PROVIDER_LOCAL_RAG_DEGRADED',
  'P2_AI_PROVIDER_DEGRADED',
  'P2_SCREENER_PROVIDER_DEGRADED',
  'P2_SECTOR_PROVIDER_DEGRADED',
  'P2_TELEGRAM_REPORT_SECTION_DEGRADED',
  'P2_SCAN_BLOCKERS_SECTION_DEGRADED',
  'P2_LEARNING_STATUS_SECTION_DEGRADED',
  'P2_NORMAL_SUPPLY_PREVIEW_DEGRADED',
  'P2_DIAGNOSTIC_SUMMARY_DEGRADED',
  'P2_SCHEDULER_DIAGNOSTIC_DEGRADED',
] as const;

export const P3_WARN_CODES = [
  'P3_SCRIPT_WARN',
  'P3_SCHEDULER_CATALOG_DRIFT',
  'P3_SCHEDULER_DIAGNOSTIC_DEGRADED',
  'P3_DIAGNOSTIC_SUPPRESSED',
  'P3_CACHE_PERSIST_DEGRADED',
  'P3_DEBUG_SNAPSHOT_DEGRADED',
  'P3_ALERT_AUDIT_DEGRADED',
  'P3_REPORT_GENERATOR_DEGRADED',
  'P3_CREDENTIAL_WATCHDOG_NOISY',
  'P3_KRX_MASTER_REPO_DEGRADED',
  'P3_DOC_ONLY_WARN',
] as const;
