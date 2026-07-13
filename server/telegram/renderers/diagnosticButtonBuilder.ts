// @responsibility ADR-0523 diagnostic command hints for compact Telegram messages.

import type { InlineKeyboardMarkup } from '../metaCommands.js';

export function buildDiagnosticCommandHint(scope: 'gate' | 'execution' | 'learning' = 'gate'): string {
  if (scope === 'execution') return 'detail: /exec_full | gate: /gate | raw: /debug_gate';
  if (scope === 'learning') return 'detail: /learning_full | gate: /gate | raw: /debug_gate';
  return 'detail: /gate_detail | full: /gate_full | raw: /debug_gate';
}
