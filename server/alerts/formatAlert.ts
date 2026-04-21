import { escapeHtml } from './telegramClient.js';
import { AlertCategory } from './alertCategories.js';

interface FormatAlertInput {
  category: AlertCategory;
  eventType: string;
  headerEmoji?: string;
  bodyLines: string[];
  footerLines?: string[];
}

const CATEGORY_LABEL: Record<AlertCategory, string> = {
  [AlertCategory.TRADE]: 'TRADE',
  [AlertCategory.ANALYSIS]: 'ANALYSIS',
  [AlertCategory.INFO]: 'INFO',
  [AlertCategory.SYSTEM]: 'SYSTEM',
};

export function formatAlert(input: FormatAlertInput): string {
  const headerEmoji = input.headerEmoji ?? '*';
  const label = CATEGORY_LABEL[input.category];
  const header = `${headerEmoji} <b>[${label}] ${escapeHtml(input.eventType)}</b>`;
  const body = input.bodyLines.filter(Boolean).join('\n');
  const footer = (input.footerLines ?? []).filter(Boolean).join('\n');

  return [header, '--------------------', body, footer]
    .filter(Boolean)
    .join('\n');
}
