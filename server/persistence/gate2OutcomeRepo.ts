// @responsibility counterfacture_gate Phase G — Gate2 outcome ledger 영속 + forward-return 성숙(learning-only, 주문/provider 호출 0).
import fs from 'fs';
import { GATE2_OUTCOME_LEDGER_FILE, ensureDataDir } from './paths.js';
import { gate2OutcomeDuplicateKey, type Gate2OutcomeSeed } from '../quant/gate2OutcomeSeed.js';
import { addWeekdaysApprox } from './businessDayApprox.js';

interface Gate2OutcomeLedgerFile {
  version: 1;
  seeds: Gate2OutcomeSeed[];
}

const MAX_GATE2_OUTCOME_SEEDS = 5_000;

export type Gate2OutcomePriceFetcher = (
  symbol: string,
  asOf: Date,
) => Promise<number | null | undefined> | number | null | undefined;

export interface Gate2OutcomeBulkUpsertResult {
  created: number;
  duplicateSuppressed: number;
  seeds: Gate2OutcomeSeed[];
}

export interface Gate2OutcomeUpdateResult {
  updated: number;
  updatedD1: number;
  updatedD3: number;
  updatedD5: number;
  updatedD10: number;
  pending: number;
  reason: 'MARKET_CLOSED' | 'NOT_MATURED' | 'UPDATED' | 'NO_PRICE';
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pctReturn(entry: number, exit: number): number {
  return Math.round(((exit - entry) / entry) * 1000) / 10;
}

/**
 * 주말 건너뛴 영업일 가산(공휴일 미반영 근사 — 성숙 지평 판정용). 공유 helper 위임.
 * 휴일-인식 정정은 별도 마이그레이션(#2-B). krxHolidays.addBusinessDaysFromKstDate 와 혼동 금지.
 */
function addBusinessDays(ymd: string, n: number): string {
  return addWeekdaysApprox(ymd, n);
}

function isFile(value: unknown): value is Gate2OutcomeLedgerFile {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as Gate2OutcomeLedgerFile).seeds));
}

function readLedger(filePath = GATE2_OUTCOME_LEDGER_FILE): Gate2OutcomeLedgerFile {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return { version: 1, seeds: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return isFile(parsed) ? parsed : { version: 1, seeds: [] };
  } catch {
    return { version: 1, seeds: [] };
  }
}

function writeLedger(file: Gate2OutcomeLedgerFile, filePath = GATE2_OUTCOME_LEDGER_FILE): void {
  ensureDataDir();
  fs.writeFileSync(
    filePath,
    JSON.stringify({ version: 1 as const, seeds: file.seeds.slice(-MAX_GATE2_OUTCOME_SEEDS) }, null, 2),
  );
}

export function loadGate2OutcomeSeeds(filePath = GATE2_OUTCOME_LEDGER_FILE): Gate2OutcomeSeed[] {
  return readLedger(filePath).seeds;
}

/** 신규 seed 만 append — 기존 seed(성숙된 forwardReturns 보유)는 보존(dedup). */
export function upsertGate2OutcomeSeeds(
  seeds: readonly Gate2OutcomeSeed[],
  filePath = GATE2_OUTCOME_LEDGER_FILE,
): Gate2OutcomeBulkUpsertResult {
  if (seeds.length === 0) return { created: 0, duplicateSuppressed: 0, seeds: readLedger(filePath).seeds };
  const file = readLedger(filePath);
  const byKey = new Map(file.seeds.map((seed) => [gate2OutcomeDuplicateKey(seed), seed]));
  let created = 0;
  let duplicateSuppressed = 0;
  for (const seed of seeds) {
    const key = gate2OutcomeDuplicateKey(seed);
    if (byKey.has(key)) {
      duplicateSuppressed += 1;
      continue;
    }
    byKey.set(key, seed);
    created += 1;
  }
  const merged = [...byKey.values()];
  writeLedger({ version: 1, seeds: merged }, filePath);
  return { created, duplicateSuppressed, seeds: merged };
}

/**
 * Gate2 outcome forward-return 성숙(mirror updateGate1DryRunObservationOutcomes).
 * entryReferencePrice 없는 seed 는 skip. seeds 미주입 시 영속 ledger 로드 + 갱신분 영속.
 */
export async function updateGate2OutcomeForwardReturns(input: {
  now?: Date;
  seeds?: readonly Gate2OutcomeSeed[];
  marketOpen?: boolean;
  priceFetcher?: Gate2OutcomePriceFetcher;
} = {}): Promise<Gate2OutcomeUpdateResult> {
  const persist = input.seeds === undefined;
  const seeds = input.seeds ? [...input.seeds] : loadGate2OutcomeSeeds();
  if (input.marketOpen === false) {
    return { updated: 0, updatedD1: 0, updatedD3: 0, updatedD5: 0, updatedD10: 0, pending: seeds.length, reason: 'MARKET_CLOSED' };
  }
  const now = input.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const horizons = [
    { days: 1, key: 'd1' as const, counter: 'updatedD1' as const },
    { days: 3, key: 'd3' as const, counter: 'updatedD3' as const },
    { days: 5, key: 'd5' as const, counter: 'updatedD5' as const },
    { days: 10, key: 'd10' as const, counter: 'updatedD10' as const },
  ];
  const hasDue = seeds.some((seed) => horizons.some((h) => today >= addBusinessDays(seed.tradeDate, h.days)));
  if (!hasDue) {
    return { updated: 0, updatedD1: 0, updatedD3: 0, updatedD5: 0, updatedD10: 0, pending: seeds.length, reason: 'NOT_MATURED' };
  }
  const fetcher = input.priceFetcher;
  let updatedD1 = 0;
  let updatedD3 = 0;
  let updatedD5 = 0;
  let updatedD10 = 0;
  for (const seed of seeds) {
    const entry = finite(seed.entryReferencePrice) && seed.entryReferencePrice > 0 ? seed.entryReferencePrice : null;
    if (entry === null) continue;
    for (const h of horizons) {
      const target = addBusinessDays(seed.tradeDate, h.days);
      if (today < target) continue;
      if (finite(seed.forwardReturns[h.key])) continue;
      if (!fetcher) continue;
      const price = await fetcher(seed.symbol, new Date(`${target}T00:00:00.000Z`));
      if (!finite(price) || price <= 0) continue;
      seed.forwardReturns[h.key] = pctReturn(entry, price);
      if (h.counter === 'updatedD1') updatedD1 += 1;
      else if (h.counter === 'updatedD3') updatedD3 += 1;
      else if (h.counter === 'updatedD5') updatedD5 += 1;
      else updatedD10 += 1;
      seed.outcomeStatus = finite(seed.forwardReturns.d5) ? 'LABELED' : 'PARTIAL';
    }
  }
  const updated = updatedD1 + updatedD3 + updatedD5 + updatedD10;
  if (persist && updated > 0) writeLedger({ version: 1, seeds }, GATE2_OUTCOME_LEDGER_FILE);
  const pending = seeds.filter((seed) => seed.outcomeStatus === 'PENDING' || seed.outcomeStatus === 'PARTIAL').length;
  return { updated, updatedD1, updatedD3, updatedD5, updatedD10, pending, reason: updated > 0 ? 'UPDATED' : 'NO_PRICE' };
}

export function __resetGate2OutcomeLedgerForTests(filePath = GATE2_OUTCOME_LEDGER_FILE): void {
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
}
