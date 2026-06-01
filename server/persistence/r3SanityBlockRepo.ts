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

/**
 * ENV `R3_SANITY_TTL_HOURS` — latch 자동해제 시간(시). 미설정/''/NaN/0/음수 → 0(비활성=기존 영구 동작, byte-equivalent).
 * 양수 시 triggeredAt + TTL 경과하면 getEffectiveR3SanityBlockState 가 effective inactive 반환(자동 self-heal).
 * 자매 r3ViolationStreakRepo 의 24h decay 와 동형이나, live 안전 위해 latch 는 default-OFF(opt-in).
 */
export function getR3SanityBlockTtlHours(): number {
  const raw = process.env.R3_SANITY_TTL_HOURS;
  if (raw === undefined || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/**
 * TTL 자동해제를 적용한 effective latch 상태 (read-only — 영속 파일 무변경, 자매 streak repo 패턴).
 * active 이고 R3_SANITY_TTL_HOURS>0 이며 triggeredAt + TTL 경과 시 effective inactive 반환.
 * 2026-05-26 latch 가 TTL 부재로 6일간 영구 차단된 사고 재발 방지 — 소비처(preflight)가 본 함수로 평가.
 */
export function getEffectiveR3SanityBlockState(now: Date = new Date()): R3SanityBlockState {
  const state = loadR3SanityBlockState();
  if (!state.active) return state;
  const ttlHours = getR3SanityBlockTtlHours();
  if (ttlHours <= 0) return state;
  const triggeredTs = Date.parse(state.triggeredAt);
  if (!Number.isFinite(triggeredTs)) return state;
  const ttlMs = ttlHours * 60 * 60 * 1000;
  if (now.getTime() - triggeredTs <= ttlMs) return state;
  return { ...state, active: false };
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
  const current = getEffectiveR3SanityBlockState(input.now);
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
