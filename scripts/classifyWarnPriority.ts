import path from 'node:path';
import { P5_REASON_CODES, type P5Reason } from './warnIgnorePatterns.ts';

export type WarnClassification =
  | {
      priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
      runtimeCounted: true;
      reason: string;
      path: string;
      line: number;
    }
  | {
      priority: 'P5';
      runtimeCounted: false;
      reason: P5Reason;
      path: string;
      line: number;
    };

const TEST_PATH_RE = /(?:\.test\.|\.spec\.|__tests__|__mocks__)/;
const FIXTURE_PATH_RE = /(?:fixture|fixtures|mock|mocks|sample|samples|example|examples)/i;
const DOC_PATH_RE = /(^|\/)docs\//;
const ADR_PATH_RE = /(^|\/)docs\/adr\//;
const WORKSPACE_PATH_RE = /(^|\/)_workspace\//;
const MARKDOWN_RE = /\.mdx?$/;

export function classifyWarnPriority(input: {
  filePath: string;
  line: number;
  lineText: string;
  prevLine?: string;
  nextLine?: string;
}): WarnClassification {
  const normalizedPath = input.filePath.replace(/\\/g, '/');
  const file = path.basename(normalizedPath);
  const text = input.lineText;
  const context = `${input.prevLine ?? ''}\n${text}\n${input.nextLine ?? ''}`;

  const asP5 = (reason: P5Reason): WarnClassification => ({
    priority: 'P5',
    runtimeCounted: false,
    reason,
    path: normalizedPath,
    line: input.line,
  });

  if (WORKSPACE_PATH_RE.test(normalizedPath)) return asP5('WORKSPACE_ONLY');
  if (ADR_PATH_RE.test(normalizedPath)) return asP5('ADR_ONLY');
  if (DOC_PATH_RE.test(normalizedPath) || MARKDOWN_RE.test(normalizedPath) || ['ARCHITECTURE.md', 'README.md', '.env.example'].includes(file)) {
    return asP5('DOC_ONLY');
  }
  if (TEST_PATH_RE.test(normalizedPath)) return asP5('TEST_ONLY');
  if (FIXTURE_PATH_RE.test(normalizedPath)) return asP5('FIXTURE_ONLY');

  if (/^\s*```/.test((input.prevLine ?? '').trim()) || /^\s*```/.test((input.nextLine ?? '').trim())) return asP5('EXAMPLE_ONLY');
  if (/\bexpect\s*\(.+\)\.(toBe|toEqual|toContain)\(/.test(context)) return asP5('TEST_ONLY');
  if (/\b(type|interface)\b/.test(context) && /\bWARN(?:ING)?\b/.test(text)) return asP5('TYPE_ONLY');
  if (/\benum\b|\bstatus\b|\bDecisionTier\b/.test(context) && /\bWARN(?:ING)?\b/.test(text)) return asP5('ENUM_ONLY');
  if (/\bconst\s+[A-Z0-9_]*WARN[A-Z0-9_]*\s*=/.test(text)) return asP5('ENUM_ONLY');

  return {
    priority: 'P4',
    runtimeCounted: true,
    reason: P5_REASON_CODES.EXAMPLE_ONLY.replace('P5_', 'RUNTIME_'),
    path: normalizedPath,
    line: input.line,
  };
}
