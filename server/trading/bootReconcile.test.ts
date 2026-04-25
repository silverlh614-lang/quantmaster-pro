// @responsibility: bootReconcile.ts 회귀 — 트리거 조건 + KIS 조회 불가 분기 + mismatch 알림 + 메시지 포맷.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  runBootReconcileDryRun,
  buildBootReconcileAlertMessage,
} from './bootReconcile.js';
import type { LiveReconcileResult } from './liveReconciler.js';

import * as liveReconciler from './liveReconciler.js';
import * as telegram from '../alerts/telegramClient.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  // 기본: LIVE + ENABLED — 실 트리거 조건 충족
  process.env.AUTO_TRADE_MODE = 'LIVE';
  process.env.AUTO_TRADE_ENABLED = 'true';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const KIS_QUERYABLE_BASE: Omit<LiveReconcileResult, 'summary' | 'diffs'> = {
  mode: 'liveDryRun',
  ranAt: '2026-04-25T00:00:00.000Z',
  kisQueryable: true,
  kisHoldingCount: 0,
  localActiveCount: 0,
  appliedCount: 0,
};

function reconcileResult(
  summary: Partial<LiveReconcileResult['summary']>,
  base: Partial<LiveReconcileResult> = {},
): LiveReconcileResult {
  return {
    ...KIS_QUERYABLE_BASE,
    ...base,
    summary: {
      MATCH: 0, QTY_DIVERGENCE: 0, GHOST_LOCAL: 0, GHOST_KIS: 0,
      ...summary,
    },
    diffs: [],
  };
}

// ── 트리거 조건 ──────────────────────────────────────────────────────────────

describe('runBootReconcileDryRun — 트리거 조건', () => {
  it('AUTO_TRADE_MODE != LIVE → skip', async () => {
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    const reconcileSpy = vi.spyOn(liveReconciler, 'reconcileLivePositions');
    const r = await runBootReconcileDryRun();
    expect(r).toEqual({ skipped: true, reason: 'AUTO_TRADE_MODE=SHADOW' });
    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it('AUTO_TRADE_ENABLED != true → skip', async () => {
    process.env.AUTO_TRADE_ENABLED = 'false';
    const reconcileSpy = vi.spyOn(liveReconciler, 'reconcileLivePositions');
    const r = await runBootReconcileDryRun();
    expect(r).toEqual({ skipped: true, reason: 'AUTO_TRADE_ENABLED=false' });
    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it('AUTO_TRADE_MODE 미설정 → skip with default reason', async () => {
    delete process.env.AUTO_TRADE_MODE;
    const r = await runBootReconcileDryRun();
    expect(r).toEqual({ skipped: true, reason: 'AUTO_TRADE_MODE=SHADOW' });
  });
});

// ── KIS 조회 불가 ────────────────────────────────────────────────────────────

describe('runBootReconcileDryRun — KIS 조회 불가 분기', () => {
  it('kisQueryable=false → skip, 텔레그램 미발송', async () => {
    vi.spyOn(liveReconciler, 'reconcileLivePositions').mockResolvedValue({
      ...KIS_QUERYABLE_BASE,
      kisQueryable: false,
      unavailableReason: 'KIS 점검시간',
      summary: { MATCH: 0, QTY_DIVERGENCE: 0, GHOST_LOCAL: 0, GHOST_KIS: 0 },
      diffs: [],
    });
    const tgSpy = vi.spyOn(telegram, 'sendTelegramAlert').mockResolvedValue(undefined);
    const r = await runBootReconcileDryRun();
    expect(r).toEqual({ skipped: true, reason: 'KIS 점검시간' });
    expect(tgSpy).not.toHaveBeenCalled();
  });

  it('reconcileLivePositions throw → 조용히 흡수, error 반환', async () => {
    vi.spyOn(liveReconciler, 'reconcileLivePositions').mockRejectedValue(
      new Error('network down'),
    );
    const tgSpy = vi.spyOn(telegram, 'sendTelegramAlert').mockResolvedValue(undefined);
    const r = await runBootReconcileDryRun();
    expect(r).toEqual({ skipped: false, error: 'network down' });
    expect(tgSpy).not.toHaveBeenCalled();
  });
});

// ── mismatch 0건 ─────────────────────────────────────────────────────────────

describe('runBootReconcileDryRun — mismatch 0건', () => {
  it('MATCH 만 → mismatchCount=0, 텔레그램 미발송', async () => {
    vi.spyOn(liveReconciler, 'reconcileLivePositions').mockResolvedValue(
      reconcileResult({ MATCH: 5 }, { kisHoldingCount: 5, localActiveCount: 5 }),
    );
    const tgSpy = vi.spyOn(telegram, 'sendTelegramAlert').mockResolvedValue(undefined);
    const r = await runBootReconcileDryRun();
    expect(r).toEqual({ skipped: false, mismatchCount: 0, alerted: false });
    expect(tgSpy).not.toHaveBeenCalled();
  });
});

// ── mismatch 발견 → 알림 ────────────────────────────────────────────────────

describe('runBootReconcileDryRun — mismatch 발견 시 HIGH 알림', () => {
  it('QTY_DIVERGENCE 1건 → mismatchCount=1, sendTelegramAlert HIGH 호출', async () => {
    vi.spyOn(liveReconciler, 'reconcileLivePositions').mockResolvedValue(
      reconcileResult(
        { MATCH: 2, QTY_DIVERGENCE: 1 },
        { kisHoldingCount: 3, localActiveCount: 3 },
      ),
    );
    const tgSpy = vi.spyOn(telegram, 'sendTelegramAlert').mockResolvedValue(undefined);
    const r = await runBootReconcileDryRun();
    expect(r).toEqual({ skipped: false, mismatchCount: 1, alerted: true });
    expect(tgSpy).toHaveBeenCalledTimes(1);
    const [msg, opts] = tgSpy.mock.calls[0];
    expect(msg).toContain('부팅 reconcile dry-run');
    expect(msg).toContain('1건');
    expect(opts).toMatchObject({ priority: 'HIGH', category: 'reconcile' });
    expect(opts!.dedupeKey).toMatch(/^boot_reconcile:\d{4}-\d{2}-\d{2}$/);
  });

  it('GHOST_LOCAL + GHOST_KIS 모두 발생 → 합산 mismatchCount', async () => {
    vi.spyOn(liveReconciler, 'reconcileLivePositions').mockResolvedValue(
      reconcileResult({ GHOST_LOCAL: 2, GHOST_KIS: 1 }),
    );
    const tgSpy = vi.spyOn(telegram, 'sendTelegramAlert').mockResolvedValue(undefined);
    const r = await runBootReconcileDryRun();
    expect(r).toEqual({ skipped: false, mismatchCount: 3, alerted: true });
    const msg = tgSpy.mock.calls[0][0] as string;
    expect(msg).toContain('GHOST_KIS' === 'GHOST_KIS' ? 'KIS 만 보유' : '');
    expect(msg).toContain('체결 누락');
  });

  it('텔레그램 발송 실패 시 alerted=false 반환 (전파 안 됨)', async () => {
    vi.spyOn(liveReconciler, 'reconcileLivePositions').mockResolvedValue(
      reconcileResult({ QTY_DIVERGENCE: 1 }),
    );
    vi.spyOn(telegram, 'sendTelegramAlert').mockRejectedValue(new Error('chat 401'));
    const r = await runBootReconcileDryRun();
    expect(r).toEqual({ skipped: false, mismatchCount: 1, alerted: false });
  });
});

// ── 메시지 포맷 ──────────────────────────────────────────────────────────────

describe('buildBootReconcileAlertMessage — 포맷', () => {
  it('QTY_DIVERGENCE 만 → 수량 불일치 라인만 포함', () => {
    const msg = buildBootReconcileAlertMessage(
      reconcileResult({ MATCH: 1, QTY_DIVERGENCE: 1 }),
      1,
    );
    expect(msg).toContain('수량 불일치: 1건');
    expect(msg).not.toContain('로컬만 ACTIVE');
    expect(msg).not.toContain('KIS 만 보유');
    expect(msg).toContain('/reconcile live apply');
  });

  it('GHOST_KIS 발생 → ⚠️ 경고 마커 포함', () => {
    const msg = buildBootReconcileAlertMessage(
      reconcileResult({ GHOST_KIS: 2 }),
      2,
    );
    expect(msg).toMatch(/KIS 만 보유.*⚠️/);
  });

  it('총 mismatchCount 가 본문에 명시', () => {
    const msg = buildBootReconcileAlertMessage(
      reconcileResult({ QTY_DIVERGENCE: 3, GHOST_LOCAL: 2, GHOST_KIS: 1 }),
      6,
    );
    expect(msg).toContain('차이 <b>6건</b>');
  });
});
