// @responsibility Persist Shadow bot delivery progress.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, ensureDataDir } from './paths.js';
import type { AlertCategory } from '../alerts/alertCategories.js';

export type PaperBotHealth = 'OK' | 'PAUSED' | 'STALE' | 'UNAVAILABLE' | 'PRICE_MISSING' | 'STRATEGY_ERROR';
export interface PaperBotMessage {
  id: string;
  kind: 'morning' | 'close' | 'weekly' | 'trades' | 'health';
  message: string;
  /** Missing on existing records: preserve their original private delivery. */
  channel?: AlertCategory;
  createdAt: string;
  expiresAt: string;
  state: 'PENDING' | 'SENT' | 'FAILED' | 'EXPIRED' | 'SUPERSEDED';
  attempts: number;
  nextAttemptAt: string;
  lastAttemptAt?: string;
  messageId?: number;
  sentAt?: string;
  error?: string;
  health?: PaperBotHealth;
}
export interface PaperBotState {
  schemaVersion: 1;
  initializedAt: string | null;
  lastCheckedAt: string | null;
  health: PaperBotHealth;
  notifiedHealth: PaperBotHealth;
  seenEvents: Record<string, string>;
  messages: PaperBotMessage[];
}
export const PAPER_BOT_FILE = path.join(DATA_DIR, 'paper-bot.json');
export function loadPaperBotState(): PaperBotState {
  if (!fs.existsSync(PAPER_BOT_FILE)) return { schemaVersion: 1, initializedAt: null, lastCheckedAt: null, health: 'OK', notifiedHealth: 'OK', seenEvents: {}, messages: [] };
  const state = JSON.parse(fs.readFileSync(PAPER_BOT_FILE, 'utf8')) as PaperBotState;
  const healthValues = ['OK', 'PAUSED', 'STALE', 'UNAVAILABLE', 'PRICE_MISSING', 'STRATEGY_ERROR'];
  if (!state || state.schemaVersion !== 1 || !Array.isArray(state.messages) || !state.seenEvents || typeof state.seenEvents !== 'object'
    || !healthValues.includes(state.health) || !healthValues.includes(state.notifiedHealth)
    || (state.initializedAt !== null && !Number.isFinite(Date.parse(state.initializedAt)))
    || Object.values(state.seenEvents).some(at => typeof at !== 'string' || !Number.isFinite(Date.parse(at)))
    || state.messages.some(item => !item || typeof item.id !== 'string' || !item.id || typeof item.message !== 'string'
      || !['PENDING', 'SENT', 'FAILED', 'EXPIRED', 'SUPERSEDED'].includes(item.state)
      || !['morning', 'close', 'weekly', 'trades', 'health'].includes(item.kind)
      || (item.channel !== undefined && !['TRADE', 'ANALYSIS', 'INFO', 'SYSTEM'].includes(item.channel))
      || ![item.createdAt, item.expiresAt, item.nextAttemptAt].every(at => Number.isFinite(Date.parse(at)))
      || !Number.isInteger(item.attempts) || item.attempts < 0
      || (item.state === 'SENT' && !(typeof item.messageId === 'number' && Number.isFinite(item.messageId) && item.messageId > 0)))) {
    throw new Error('PAPER_BOT_STATE_INVALID: 알림 원장 확인 필요');
  }
  return state;
}
export function savePaperBotState(state: PaperBotState): void {
  ensureDataDir();
  const temporary = `${PAPER_BOT_FILE}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(state), { encoding: 'utf8', flag: 'wx', flush: true });
    fs.renameSync(temporary, PAPER_BOT_FILE);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
