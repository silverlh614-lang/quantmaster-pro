// @responsibility pending wiring markdown registry 변환
import pendingWiringMarkdown from '../../_workspace/PENDING_WIRING.md?raw';
import type {
  PendingExecutionImpact,
  PendingPriority,
  PendingScope,
  PendingWiringItem,
  PendingWiringStatus,
} from '../types/pendingWiring';

const STATUS_SET = new Set<PendingWiringStatus>([
  'NOT_STARTED',
  'INFRASTRUCTURE_ONLY',
  'PARTIAL',
  'OBSERVE_ONLY',
  'SHADOW_ONLY',
  'ADVISORY_ONLY',
  'WEIGHTED_READY',
  'GATED_READY',
  'CORE_READY',
  'BLOCKED',
  'DONE',
]);

const PRIORITY_SET = new Set<PendingPriority>(['P0', 'P1', 'P2', 'P3']);
const SLA_DAYS: Partial<Record<PendingPriority, number>> = { P0: 21, P1: 45, P2: 120 };

export function loadPendingWiringItems(): PendingWiringItem[] {
  return parsePendingWiringMarkdown(pendingWiringMarkdown);
}

export function parsePendingWiringMarkdown(markdown: string): PendingWiringItem[] {
  const items: PendingWiringItem[] = [];
  for (const line of markdown.split('\n')) {
    const item = parsePendingTableRow(line);
    if (item) items.push(item);
  }
  return items;
}

function parsePendingTableRow(line: string): PendingWiringItem | null {
  const cells = splitMarkdownRow(line);
  if (!isPendingBacklogRow(cells)) return null;

  const [id, , moduleName, createdAt, status, priority, notes] = cells;
  const sourceFile = extractSourceFile(moduleName);
  return {
    id: cleanInlineText(id),
    priority: priority as PendingPriority,
    moduleName: cleanInlineCode(moduleName),
    status: status as PendingWiringStatus,
    scope: deriveScopes(moduleName, notes),
    sourceFile,
    owner: 'Pending registry',
    createdAt,
    dueAt: deriveDueAt(createdAt, priority as PendingPriority),
    executionImpact: deriveExecutionImpact(moduleName, notes, status as PendingWiringStatus),
    nextAction: cleanInlineText(notes),
    notes: cleanInlineText(notes),
  };
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function isPendingBacklogRow(cells: string[]): boolean {
  if (cells.length < 7) return false;
  const [, , , createdAt, status, priority] = cells;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdAt)) return false;
  return STATUS_SET.has(status as PendingWiringStatus) && PRIORITY_SET.has(priority as PendingPriority);
}

function extractSourceFile(moduleName: string): string | undefined {
  const match = moduleName.match(/`([^`]+)`/);
  return match?.[1];
}

function cleanInlineCode(value: string): string {
  return cleanInlineText(value).replace(/`/g, '');
}

function cleanInlineText(value: string): string {
  return value.replace(/\*\*/g, '').replace(/<br\s*\/?\s*>/gi, ' ').trim();
}

function deriveDueAt(createdAt: string, priority: PendingPriority): string | undefined {
  const days = SLA_DAYS[priority];
  if (!days) return undefined;
  const created = new Date(`${createdAt}T00:00:00Z`);
  if (Number.isNaN(created.getTime())) return undefined;
  created.setUTCDate(created.getUTCDate() + days);
  return created.toISOString().slice(0, 10);
}

function deriveScopes(moduleName: string, notes: string): PendingScope[] {
  const haystack = `${moduleName} ${notes}`.toLowerCase();
  const scopes = new Set<PendingScope>();
  if (/live|매매|buy|sell|order|execution|kis|trading|entry|exit/.test(haystack)) scopes.add('LIVE');
  if (/shadow|가상|counterfactual/.test(haystack)) scopes.add('SHADOW');
  if (/ui|dashboard|card|panel|report|가시화|표시/.test(haystack)) scopes.add('UI');
  if (/diagnostic|health|audit|log|진단/.test(haystack)) scopes.add('DIAGNOSTIC');
  if (/telegram|alert|알림/.test(haystack)) scopes.add('TELEGRAM');
  if (/provider|data|cache|yahoo|naver|krx|ecos|dart|데이터/.test(haystack)) scopes.add('DATA_PROVIDER');
  if (/backtest|walkforward|walk-forward/.test(haystack)) scopes.add('BACKTEST');
  if (/learning|학습|tracker|feedback|reflection/.test(haystack)) scopes.add('LEARNING');
  if (/macro|dxy|adr|regime|금리/.test(haystack)) scopes.add('MACRO');
  if (/sector|섹터|etf/.test(haystack)) scopes.add('SECTOR');
  if (/risk|exposure|stop|손절|위험/.test(haystack)) scopes.add('RISK');
  if (scopes.size === 0) scopes.add('DIAGNOSTIC');
  return Array.from(scopes);
}

function deriveExecutionImpact(moduleName: string, notes: string, status: PendingWiringStatus): PendingExecutionImpact {
  const haystack = `${moduleName} ${notes}`.toLowerCase();
  if (status === 'BLOCKED' && /live|매매|execution|order|kis/.test(haystack)) return 'BLOCKING';
  if (/new buy blocked|신규매수|new_buy_blocked/.test(haystack)) return 'NEW_BUY_BLOCKED_ONLY';
  if (/shadow|observe|관찰|가상/.test(haystack)) return 'SHADOW_ONLY';
  if ((status === 'PARTIAL' || status === 'INFRASTRUCTURE_ONLY') && /live|매매|execution|order|kis|buy|sell/.test(haystack)) {
    return 'DEGRADED';
  }
  return 'NONE';
}
