// @responsibility Deduplicate MiddayRescan Telegram final summaries while preserving trading decisions.

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';
import type { WatchlistEntry, WatchlistSection } from '../persistence/watchlistRepo.js';
import type { TelegramAlertOptions } from '../alerts/telegramClient.js';

const EVENT_TYPE = 'MIDDAY_RESCAN_WATCHLIST_ADDED';
const COOLDOWN_MS = 30 * 60 * 1000;
const STATE_FILE = path.join(DATA_DIR, 'midday-rescan-telegram-state.json');
const SECTIONS: readonly WatchlistSection[] = ['MOMENTUM', 'SWING', 'CATALYST'];
const DEFAULT_SECTION_HARD_MAX: Record<WatchlistSection, number> = {
  SWING: 8,
  CATALYST: 5,
  MOMENTUM: 50,
};
const IMPACT_FLAGS = {
  executionImpact: 'NONE',
  marketSignal: false,
  providerIssue: false,
  tradingLogicChanged: false,
  gateLogicChanged: false,
  orderLogicChanged: false,
  notificationOnly: true,
} as const;

type LoggerLike = Pick<typeof console, 'info' | 'warn'>;

interface MiddayRescanNotificationState {
  sentByDedupKey: Record<string, { sentAt: string; symbolSetHash: string }>;
  symbolSetHashesByTradeDate: Record<string, string[]>;
  notifiedSymbolsByTradeDate: Record<string, Partial<Record<WatchlistSection, string[]>>>;
  sectionCooldown: Record<string, string>;
}

export interface MiddayRescanFinalSummaryInput {
  cycleId: string;
  tradeDate: string;
  triggerSource: string;
  sectionTargets: readonly WatchlistSection[];
  beforeCodes: ReadonlySet<string>;
  finalWatchlist: readonly WatchlistEntry[];
  addedCount: number;
  now?: Date;
  manualOverride?: boolean;
  logger?: LoggerLike;
  sendTelegram: (message: string, opts?: TelegramAlertOptions) => Promise<number | undefined>;
}

export interface MiddayRescanFinalSummaryResult {
  telegramSent: boolean;
  telegramEligible: boolean;
  dedupKey: string;
  symbolSetHash: string;
  newCount: number;
  duplicateExcluded: number;
  alreadyInWatchlist: number;
  skipped: number;
  reason: string;
}

function emptyState(): MiddayRescanNotificationState {
  return {
    sentByDedupKey: {},
    symbolSetHashesByTradeDate: {},
    notifiedSymbolsByTradeDate: {},
    sectionCooldown: {},
  };
}

function readState(): MiddayRescanNotificationState {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) };
  } catch {
    /* SDS-ignore: corrupted notification dedup state must not affect trading; the ledger is recreated. */
    return emptyState();
  }
}

function writeState(state: MiddayRescanNotificationState): void {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function kstParts(now: Date): { tradeDate: string; hhmm: string; yyyymmdd: string } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const iso = kst.toISOString();
  return {
    tradeDate: iso.slice(0, 10),
    yyyymmdd: iso.slice(0, 10).replace(/-/g, ''),
    hhmm: iso.slice(11, 16).replace(':', ''),
  };
}

function codeOf(entry: WatchlistEntry): string {
  return String(entry.code ?? '').trim();
}

function sectionOf(entry: WatchlistEntry): WatchlistSection {
  if (entry.section && SECTIONS.includes(entry.section)) return entry.section;
  if (entry.track === 'B') return 'SWING';
  return 'MOMENTUM';
}

function stateSymbolSet(
  state: MiddayRescanNotificationState,
  tradeDate: string,
  section: WatchlistSection,
): Set<string> {
  return new Set(state.notifiedSymbolsByTradeDate[tradeDate]?.[section] ?? []);
}

function recordSymbols(
  state: MiddayRescanNotificationState,
  tradeDate: string,
  entries: readonly WatchlistEntry[],
): void {
  state.notifiedSymbolsByTradeDate[tradeDate] ??= {};
  for (const entry of entries) {
    const section = sectionOf(entry);
    const code = codeOf(entry);
    if (!code) continue;
    const current = new Set(state.notifiedSymbolsByTradeDate[tradeDate][section] ?? []);
    current.add(code);
    state.notifiedSymbolsByTradeDate[tradeDate][section] = Array.from(current).sort();
  }
}

function formatKstHHmm(now: Date): string {
  const { hhmm } = kstParts(now);
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2)} KST`;
}

function logBlock(logger: LoggerLike, marker: string, fields: Record<string, unknown>): void {
  logger.info(
    `[${marker}]\n`
    + Object.entries(fields)
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
      .join('\n'),
  );
}

export function buildMiddayRescanCycleId(now = new Date()): string {
  const { yyyymmdd } = kstParts(now);
  return `midday_${yyyymmdd}_1300`;
}

export function buildMiddayRescanSymbolSetHash(symbols: readonly string[]): string {
  const canonical = Array.from(new Set(symbols.filter(Boolean))).sort().join(',');
  return createHash('sha1').update(canonical || 'EMPTY').digest('hex').slice(0, 12);
}

export function logMiddayRescanCycleStarted(input: {
  cycleId: string;
  tradeDate: string;
  triggerSource: string;
  sectionTargets: readonly WatchlistSection[];
  logger?: LoggerLike;
}): void {
  logBlock(input.logger ?? console, 'MIDDAY_RESCAN_CYCLE_STARTED', {
    cycleId: input.cycleId,
    tradeDate: input.tradeDate,
    triggerSource: input.triggerSource,
    sectionTargets: input.sectionTargets.join('/'),
    ...IMPACT_FLAGS,
  });
}

function buildMessage(input: {
  now: Date;
  newEntries: readonly WatchlistEntry[];
  duplicateExcluded: number;
  alreadyInWatchlist: number;
  skipped: number;
  sections: readonly WatchlistSection[];
}): string {
  const names = input.newEntries.map((w) => `${w.name}(${w.code})`).join('\n');
  return [
    `\uD83D\uDCCB <b>[MiddayRescan \uC644\uB8CC]</b> ${formatKstHHmm(input.now)}`,
    `\uC2E0\uADDC \uCD94\uAC00: ${input.newEntries.length}\uAC1C`,
    `\uC911\uBCF5 \uC81C\uC678: ${input.duplicateExcluded}\uAC1C`,
    `\uAE30\uC874 \uC6CC\uCE58\uB9AC\uC2A4\uD2B8 \uC81C\uC678: ${input.alreadyInWatchlist}\uAC1C`,
    `\uC2A4\uD0B5: ${input.skipped}\uAC1C`,
    `\uC139\uC158: ${input.sections.join(' / ') || 'NONE'}`,
    '\uBC1C\uC1A1 \uAE30\uC900: final summary only',
    '\uB9E4\uB9E4 \uC601\uD5A5: \uC5C6\uC74C',
    'executionImpact=NONE',
    names ? `\n${names}` : '',
  ].filter(Boolean).join('\n');
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function hardCapFor(section: WatchlistSection): number {
  return envInt(`WATCHLIST_HARD_CAP_${section}`, DEFAULT_SECTION_HARD_MAX[section]);
}

function isHardCapApproaching(finalWatchlist: readonly WatchlistEntry[]): boolean {
  return SECTIONS.some((section) => {
    const count = finalWatchlist.filter((entry) => sectionOf(entry) === section).length;
    const hardCap = hardCapFor(section);
    return hardCap > 0 && count >= Math.max(1, hardCap - 2);
  });
}

export async function sendMiddayRescanFinalSummary(
  input: MiddayRescanFinalSummaryInput,
): Promise<MiddayRescanFinalSummaryResult> {
  const logger = input.logger ?? console;
  const now = input.now ?? new Date();
  const state = readState();
  const finalNewEntries = input.finalWatchlist.filter((entry) => {
    const code = codeOf(entry);
    return code && !input.beforeCodes.has(code);
  });
  const notifiableNewEntries = finalNewEntries.filter((entry) => (
    !stateSymbolSet(state, input.tradeDate, sectionOf(entry)).has(codeOf(entry))
  ));
  const sectionSourceEntries = notifiableNewEntries.length > 0 ? notifiableNewEntries : finalNewEntries;
  const sections = Array.from(new Set(sectionSourceEntries.map(sectionOf))).sort() as WatchlistSection[];
  const sectionKey = sections.length === 1 ? sections[0] : 'ALL';
  const dedupKey = `${input.tradeDate}:${EVENT_TYPE}:${sectionKey}:${input.cycleId}`;
  const symbolSetHash = buildMiddayRescanSymbolSetHash(notifiableNewEntries.map(codeOf));
  const alreadyNotifiedToday = Math.max(0, finalNewEntries.length - notifiableNewEntries.length);
  const alreadyInWatchlist = 0;
  const duplicateExcluded = alreadyNotifiedToday;
  const skipped = Math.max(0, input.addedCount - finalNewEntries.length);
  const capApproaching = isHardCapApproaching(input.finalWatchlist);
  const telegramEligible =
    notifiableNewEntries.length > 0 ||
    duplicateExcluded >= 10 ||
    skipped >= 10 ||
    capApproaching;

  for (const section of input.sectionTargets) {
    const symbols = finalNewEntries.filter((entry) => sectionOf(entry) === section).map(codeOf);
    logBlock(logger, 'MIDDAY_RESCAN_BATCH_ACCUMULATED', {
      cycleId: input.cycleId,
      section,
      batchSize: symbols.length,
      symbols: symbols.join(',') || 'NONE',
      telegramSent: false,
      ...IMPACT_FLAGS,
    });
  }

  logBlock(logger, 'MIDDAY_RESCAN_FINAL_SUMMARY_READY', {
    cycleId: input.cycleId,
    totalNew: notifiableNewEntries.length,
    duplicateExcluded,
    alreadyInWatchlist,
    skipped,
    telegramEligible,
    ...IMPACT_FLAGS,
  });

  const suppress = (reason: string): MiddayRescanFinalSummaryResult => {
    logBlock(logger, 'MIDDAY_RESCAN_DEDUP_SUPPRESSED', {
      cycleId: input.cycleId,
      section: sectionKey,
      dedupKey,
      symbolSetHash,
      reason,
      ...IMPACT_FLAGS,
    });
    return {
      telegramSent: false,
      telegramEligible,
      dedupKey,
      symbolSetHash,
      newCount: notifiableNewEntries.length,
      duplicateExcluded,
      alreadyInWatchlist,
      skipped,
      reason,
    };
  };

  if (!input.manualOverride && state.sentByDedupKey[dedupKey]) return suppress('DEDUP_KEY_ALREADY_SENT');
  if (!input.manualOverride && state.symbolSetHashesByTradeDate[input.tradeDate]?.includes(symbolSetHash)) {
    return suppress('SYMBOL_SET_HASH_ALREADY_SENT_TODAY');
  }

  const cooldownKeys = sections.map((section) => `${input.tradeDate}:${EVENT_TYPE}:${section}`);
  const activeCooldownKey = cooldownKeys.find((key) => {
    const lastSentAt = state.sectionCooldown[key];
    return lastSentAt && now.getTime() - Date.parse(lastSentAt) < COOLDOWN_MS;
  });
  if (!input.manualOverride && activeCooldownKey) {
    return suppress('SECTION_COOLDOWN_ACTIVE');
  }
  if (!telegramEligible) return suppress('NOT_ELIGIBLE_FINAL_SUMMARY_ONLY');

  await input.sendTelegram(buildMessage({
    now,
    newEntries: notifiableNewEntries,
    duplicateExcluded,
    alreadyInWatchlist,
    skipped,
    sections,
  }), {
    priority: 'LOW',
    category: 'midday_rescan',
    notificationSeverity: 'SUMMARY',
    notificationEventType: EVENT_TYPE,
    summaryId: input.cycleId,
    executionImpact: 'NONE',
    marketSignal: false,
    providerIssue: false,
    kisImpact: 'NONE',
    actionRequired: false,
    tradeEvent: false,
    dedupeKey: dedupKey,
    cooldownMs: COOLDOWN_MS,
  });

  state.sentByDedupKey[dedupKey] = { sentAt: now.toISOString(), symbolSetHash };
  state.symbolSetHashesByTradeDate[input.tradeDate] = Array.from(new Set([
    ...(state.symbolSetHashesByTradeDate[input.tradeDate] ?? []),
    symbolSetHash,
  ])).sort();
  for (const key of cooldownKeys) {
    state.sectionCooldown[key] = now.toISOString();
  }
  recordSymbols(state, input.tradeDate, notifiableNewEntries);
  writeState(state);

  logBlock(logger, 'MIDDAY_RESCAN_TELEGRAM_SENT', {
    cycleId: input.cycleId,
    dedupKey,
    newCount: notifiableNewEntries.length,
    telegramSent: true,
    ...IMPACT_FLAGS,
  });

  return {
    telegramSent: true,
    telegramEligible,
    dedupKey,
    symbolSetHash,
    newCount: notifiableNewEntries.length,
    duplicateExcluded,
    alreadyInWatchlist,
    skipped,
    reason: 'SENT_FINAL_SUMMARY',
  };
}

export function __resetMiddayRescanTelegramStateForTests(): void {
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    /* SDS-ignore: test reset should be idempotent when the state file is absent. */
  }
}
