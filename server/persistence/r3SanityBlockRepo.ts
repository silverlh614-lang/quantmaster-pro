// @responsibility Persistent R3 sanity block latch for new-buy safety

import fs from 'fs';
import { ensureDataDir, R3_SANITY_BLOCK_FILE } from './paths.js';

export interface R3SanityBlockState {
  active: boolean;
  violation: string;
  regime: string;
  message: string;
  triggeredAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
}

const INACTIVE_STATE: R3SanityBlockState = {
  active: false,
  violation: 'NONE',
  regime: '',
  message: '',
  triggeredAt: '',
};

export function loadR3SanityBlockState(): R3SanityBlockState {
  ensureDataDir();
  if (!fs.existsSync(R3_SANITY_BLOCK_FILE)) return { ...INACTIVE_STATE };
  try {
    const raw = JSON.parse(fs.readFileSync(R3_SANITY_BLOCK_FILE, 'utf-8')) as Partial<R3SanityBlockState>;
    return {
      ...INACTIVE_STATE,
      ...raw,
      active: raw.active === true,
      violation: typeof raw.violation === 'string' ? raw.violation : 'UNKNOWN',
      regime: typeof raw.regime === 'string' ? raw.regime : '',
      message: typeof raw.message === 'string' ? raw.message : '',
      triggeredAt: typeof raw.triggeredAt === 'string' ? raw.triggeredAt : '',
    };
  } catch {
    return { ...INACTIVE_STATE };
  }
}

export function saveR3SanityBlockState(state: R3SanityBlockState): void {
  ensureDataDir();
  fs.writeFileSync(R3_SANITY_BLOCK_FILE, JSON.stringify(state, null, 2));
}

export function activateR3SanityBlock(input: {
  violation: string;
  regime: string;
  message: string;
  now?: Date;
}): R3SanityBlockState {
  const current = loadR3SanityBlockState();
  if (current.active && current.violation === input.violation && current.regime === input.regime) {
    return current;
  }
  const state: R3SanityBlockState = {
    active: true,
    violation: input.violation,
    regime: input.regime,
    message: input.message,
    triggeredAt: (input.now ?? new Date()).toISOString(),
  };
  saveR3SanityBlockState(state);
  return state;
}

export function acknowledgeR3SanityBlock(
  acknowledgedBy = 'operator',
  now: Date = new Date(),
): R3SanityBlockState {
  const current = loadR3SanityBlockState();
  const state: R3SanityBlockState = {
    ...current,
    active: false,
    acknowledgedAt: now.toISOString(),
    acknowledgedBy,
  };
  saveR3SanityBlockState(state);
  return state;
}

export function isR3SanityAckTokenValid(
  state: R3SanityBlockState,
  token: string | undefined,
): boolean {
  if (!state.active || !token) return false;
  return token === state.triggeredAt || token === `ACK:${state.triggeredAt}`;
}

export function __resetR3SanityBlockForTests(): void {
  ensureDataDir();
  if (fs.existsSync(R3_SANITY_BLOCK_FILE)) fs.unlinkSync(R3_SANITY_BLOCK_FILE);
}
