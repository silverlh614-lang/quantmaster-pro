// @responsibility macroEntryOverride.cmd module
// @responsibility: /macro_unblock time-boxed operator override for macro no-new-entry gates (R6/VIX/FOMC). EMR.

import {
  clearMacroEntryOverride,
  getMacroEntryOverrideState,
  setMacroEntryOverride,
  type MacroEntryOverrideState,
  type MacroEntryOverrideTarget,
} from '../../../state.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const DEFAULT_TTL_MINUTES = 60;

const TARGET_ALIASES: Record<string, MacroEntryOverrideTarget[]> = {
  all: ['R6_DEFENSE', 'VIX_BLOCK', 'FOMC_BLOCK'],
  macro: ['R6_DEFENSE', 'VIX_BLOCK', 'FOMC_BLOCK'],
  r6: ['R6_DEFENSE'],
  r6_defense: ['R6_DEFENSE'],
  vix: ['VIX_BLOCK'],
  vix_block: ['VIX_BLOCK'],
  fomc: ['FOMC_BLOCK'],
  fomc_block: ['FOMC_BLOCK'],
};

function parseDurationMinutes(token: string | undefined): number | null {
  if (!token) return null;
  const normalized = token.trim().toLowerCase();
  const match = normalized.match(/^(\d+)(m|min|분|h|hr|시간)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2] ?? 'm';
  return unit === 'h' || unit === 'hr' || unit === '시간' ? value * 60 : value;
}

function parseTargets(token: string | undefined): MacroEntryOverrideTarget[] | null {
  if (!token) return null;
  return TARGET_ALIASES[token.trim().toLowerCase()] ?? null;
}

function formatOverrideStatus(state: MacroEntryOverrideState | null): string {
  if (!state) {
    return [
      '<b>[Macro Entry Override]</b>',
      'status: <code>INACTIVE</code>',
      'usage: <code>/macro_unblock [minutes|1h] [all|r6|vix|fomc] [reason]</code>',
      'clear: <code>/macro_unblock off</code>',
    ].join('\n');
  }

  return [
    '<b>[Macro Entry Override]</b>',
    'status: <code>ACTIVE</code>',
    `targets: <code>${escapeHtml(state.targets.join(','))}</code>`,
    `expiresAt: <code>${escapeHtml(state.expiresAt)}</code>`,
    `kellyFloor: <code>${state.kellyFloor.toFixed(2)}</code>`,
    `maxPositionsFloor: <code>${state.maxPositionsFloor}</code>`,
    `reason: <code>${escapeHtml(state.reason)}</code>`,
    `setBy: <code>${escapeHtml(state.setBy)}</code>`,
  ].join('\n');
}

const macroEntryOverride: TelegramCommand = {
  name: '/macro_unblock',
  aliases: ['/macro_override', '/risk_unblock'],
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: 'R6/VIX/FOMC macro no-new-entry gate time-boxed operator override',
  usage: '/macro_unblock [minutes|1h|off|status] [all|r6|vix|fomc] [reason]',
  async execute({ args, reply }) {
    const first = args[0]?.trim().toLowerCase();

    if (!first || first === 'status' || first === 'show') {
      await reply(formatOverrideStatus(getMacroEntryOverrideState()));
      return;
    }

    if (first === 'off' || first === 'clear' || first === 'disable') {
      const previous = clearMacroEntryOverride();
      await reply(
        previous
          ? '<b>[Macro Entry Override]</b>\nstatus: <code>CLEARED</code>'
          : '<b>[Macro Entry Override]</b>\nstatus: <code>ALREADY_INACTIVE</code>',
      );
      return;
    }

    let cursor = 0;
    const duration = parseDurationMinutes(args[cursor]);
    const ttlMinutes = duration ?? DEFAULT_TTL_MINUTES;
    if (duration !== null) cursor += 1;

    const targets = parseTargets(args[cursor]);
    if (targets) cursor += 1;

    const reason = args.slice(cursor).join(' ').trim() || 'telegram operator macro entry override';
    const state = setMacroEntryOverride({
      ttlMinutes,
      targets: targets ?? undefined,
      reason,
      setBy: 'telegram_operator',
    });

    console.warn(
      `[TelegramBot] /macro_unblock enabled targets=${state.targets.join(',')} ` +
      `ttlMinutes=${state.ttlMinutes} expiresAt=${state.expiresAt} reason=${state.reason}`,
    );

    await reply(
      '<b>[Macro Entry Override Enabled]</b>\n' +
      `targets: <code>${escapeHtml(state.targets.join(','))}</code>\n` +
      `expiresAt: <code>${escapeHtml(state.expiresAt)}</code>\n` +
      `reason: <code>${escapeHtml(state.reason)}</code>\n` +
      '<i>Emergency/manual/data/R3 guards remain active. Only R6/VIX/FOMC no-new-entry gates are bypassed.</i>',
    );
  },
};

commandRegistry.register(macroEntryOverride);
