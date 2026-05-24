// @responsibility ADR-0523 diagnostic command hints for compact Telegram messages.

import type { InlineKeyboardMarkup } from '../metaCommands.js';

export function buildDiagnosticCommandHint(scope: 'gate' | 'execution' | 'learning' = 'gate'): string {
  if (scope === 'execution') return 'detail: /exec_full | gate: /gate | raw: /debug_gate';
  if (scope === 'learning') return 'detail: /learning_full | gate: /gate | raw: /debug_gate';
  return 'detail: /gate_detail | full: /gate_full | raw: /debug_gate';
}

export function buildDiagnosticButtons(scope: 'gate' | 'execution' | 'learning' = 'gate'): InlineKeyboardMarkup {
  const rows = scope === 'execution'
    ? [
      [{ text: 'Execution Detail', callback_data: 'qmp:exec_full' }],
      [{ text: 'Gate Detail', callback_data: 'qmp:gate_detail' }],
      [{ text: 'Raw Debug', callback_data: 'qmp:debug_gate' }],
    ]
    : scope === 'learning'
      ? [
        [{ text: 'Learning Detail', callback_data: 'qmp:learning_full' }],
        [{ text: 'Gate Detail', callback_data: 'qmp:gate_detail' }],
        [{ text: 'Raw Debug', callback_data: 'qmp:debug_gate' }],
      ]
      : [
        [{ text: 'Gate Detail', callback_data: 'qmp:gate_detail' }],
        [{ text: 'Execution Detail', callback_data: 'qmp:exec_full' }],
        [{ text: 'Learning Detail', callback_data: 'qmp:learning_full' }],
        [{ text: 'Full Forensic', callback_data: 'qmp:gate_full' }],
        [{ text: 'Raw Debug', callback_data: 'qmp:debug_gate' }],
      ];
  return { inline_keyboard: rows };
}
