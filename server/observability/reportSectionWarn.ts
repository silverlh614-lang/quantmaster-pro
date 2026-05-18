// @responsibility Compact P2 Telegram report section warning wrapper.

import { emitOperationalWarn } from './operationalWarn.js';
import { recordP2WarnSummary } from './p2WarnSummary.js';
import type { OperationalWarnEmission } from './operationalWarnTypes.js';
import { compactError } from './providerWarn.js';

import type { ReportSection } from './p2WarnTypes.js';

const reportCodeBySection: Partial<Record<ReportSection, string>> = {
  SCAN_BLOCKERS: 'P2_SCAN_BLOCKERS_SECTION_DEGRADED',
  LEARNING_STATUS: 'P2_LEARNING_STATUS_SECTION_DEGRADED',
  NORMAL_SUPPLY_PREVIEW: 'P2_NORMAL_SUPPLY_PREVIEW_DEGRADED',
};

export interface ReportSectionWarnInput {
  section: ReportSection;
  code?: string;
  message: string;
  error?: unknown;
  dedupKey?: string;
  details?: Record<string, unknown>;
}

export function emitReportSectionWarn(input: ReportSectionWarnInput): OperationalWarnEmission {
  const code = input.code ?? reportCodeBySection[input.section] ?? 'P2_TELEGRAM_REPORT_SECTION_DEGRADED';
  const emission = emitOperationalWarn({
    priority: 'P2',
    domain: 'TELEGRAM',
    code,
    message: input.message,
    executionImpact: 'NONE',
    dedupKey: input.dedupKey ?? `p2:telegram:section:${input.section}:${code}`,
    ttlSec: 300,
    details: {
      ...input.details,
      section: input.section,
      degradedSection: true,
      compactError: compactError(input.error),
    },
  });
  recordP2WarnSummary(emission);
  return emission;
}
