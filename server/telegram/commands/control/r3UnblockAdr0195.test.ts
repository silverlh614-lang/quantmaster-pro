/**
 * @responsibility ADR-0195 /r3_unblock + /guards R3 latch 가시화 + cooldown 24h 회귀 테스트.
 *
 * 사용자 5/6 KST 10:21 보고 — R3 sanity block 영속 latch 텔레그램 해제 명령 부재.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { commandRegistry } from '../../commandRegistry.js';
import './r3Unblock.cmd.js';
import './guards.cmd.js';

const R3_UNBLOCK_PATH = path.resolve(__dirname, 'r3Unblock.cmd.ts');
const GUARDS_PATH = path.resolve(__dirname, 'guards.cmd.ts');
const BARREL_PATH = path.resolve(__dirname, 'index.ts');
const PREFLIGHT_PATH = path.resolve(__dirname, '..', '..', '..', 'trading', 'signalScanner', 'preflight.ts');

const r3UnblockSrc = fs.readFileSync(R3_UNBLOCK_PATH, 'utf-8');
const guardsSrc = fs.readFileSync(GUARDS_PATH, 'utf-8');
const barrelSrc = fs.readFileSync(BARREL_PATH, 'utf-8');
const preflightSrc = fs.readFileSync(PREFLIGHT_PATH, 'utf-8');

describe('ADR-0195 정적 가드 — /r3_unblock + barrel + preflight cooldown', () => {
  it('barrel 에 r3Unblock.cmd 등록', () => {
    expect(barrelSrc).toMatch(/import '\.\/r3Unblock\.cmd\.js'/);
    expect(barrelSrc).toMatch(/ADR-0195/);
  });

  it('/r3_unblock 메타데이터 (alias + EMR + riskLevel=2)', () => {
    expect(r3UnblockSrc).toMatch(/name: '\/r3_unblock'/);
    expect(r3UnblockSrc).toMatch(/aliases: \['\/r3_clear', '\/clear_r3_sanity'\]/);
    expect(r3UnblockSrc).toMatch(/category: 'EMR'/);
    expect(r3UnblockSrc).toMatch(/riskLevel: 2/);
  });

  it('acknowledgeR3SanityBlock 호출 (ADR-0120 영속 latch SSOT)', () => {
    expect(r3UnblockSrc).toMatch(/acknowledgeR3SanityBlock\('telegram_operator'\)/);
  });

  it('/guards 응답 R3 sanity latch 라인 추가 (ADR-0195 8번째 가드)', () => {
    expect(guardsSrc).toMatch(/R3 Sanity Block \(\/r3_unblock\)/);
    expect(guardsSrc).toMatch(/loadR3SanityBlockState/);
    expect(guardsSrc).toMatch(/r3Sanity\.violation/);
  });

  it('/guards anyBlocked 합산에 r3Active 포함 (정합)', () => {
    expect(guardsSrc).toMatch(/\|\| r3Active/);
  });

  it('preflight.ts cooldown 24h (60min → 24h, ADR-0195)', () => {
    expect(preflightSrc).toMatch(/cooldownMs: 24 \* 60 \* 60_?000/);
    expect(preflightSrc).not.toMatch(/r3_sanity_block_active.*cooldownMs: 60 \* 60_?000/s);
  });

  it('preflight.ts 텔레그램 메시지에 /r3_unblock 안내 포함', () => {
    expect(preflightSrc).toMatch(/\/r3_unblock/);
    expect(preflightSrc).toMatch(/ADR-0195/);
  });
});

describe('ADR-0195 동작 매트릭스 — /r3_unblock', () => {
  let tmpDir: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3sanity-'));
    originalDataDir = process.env.PERSIST_DATA_DIR;
    process.env.PERSIST_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('latch active → 해제 + 메시지 포함', async () => {
    const repo = await import('../../../persistence/r3SanityBlockRepo.js');
    repo.activateR3SanityBlock({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      message: 'test',
      now: new Date('2026-05-06T01:00:00.000Z'),
    });

    const cmd = commandRegistry.resolve('/r3_unblock');
    expect(cmd).toBeDefined();
    let captured = '';
    await cmd!.execute({ args: [], reply: async (m: string) => { captured = m; } });

    const after = repo.loadR3SanityBlockState();
    expect(after.active).toBe(false);
    expect(after.acknowledgedBy).toBe('telegram_operator');
    expect(captured).toContain('R3 Sanity Block 해제');
    expect(captured).toContain('GATE1_PASS_ZERO');
    expect(captured).toContain('R3_EARLY');
    expect(captured).toContain('telegram_operator');
  });

  it('이미 비활성 → 멱등 + 안내', async () => {
    const cmd = commandRegistry.resolve('/r3_unblock');
    let captured = '';
    await cmd!.execute({ args: [], reply: async (m: string) => { captured = m; } });
    expect(captured).toContain('이미 R3 sanity block 비활성');
  });

  it('alias /r3_clear + /clear_r3_sanity 동일 인스턴스', () => {
    const a = commandRegistry.resolve('/r3_unblock');
    const b = commandRegistry.resolve('/r3_clear');
    const c = commandRegistry.resolve('/clear_r3_sanity');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });
});

describe('ADR-0195 /guards 동작 매트릭스 — R3 sanity latch 라인', () => {
  let tmpDir: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guards-r3-'));
    originalDataDir = process.env.PERSIST_DATA_DIR;
    process.env.PERSIST_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('R3 latch 비활성 → "✅ 비활성" 표시 + 모든 가드 정상 (다른 가드도 비활성 시)', async () => {
    const state = await import('../../../state.js');
    state.setEmergencyStop(false);
    state.setAutoTradePaused(false);
    state.setDataIntegrityBlocked(false);
    state.setManualBlockNewBuy(false);
    state.setManualManageOnly(false);
    state.setSmokeTestLiveBlocked(false);
    state.setDailyLoss(0);

    const cmd = commandRegistry.resolve('/guards');
    let captured = '';
    await cmd!.execute({ args: [], reply: async (m: string) => { captured = m; } });
    expect(captured).toContain('R3 Sanity Block (/r3_unblock): ✅ 비활성');
    expect(captured).toContain('모든 가드 정상');
  });

  it('R3 latch 활성 → 🚨 라인 + 위반 + 레짐 표시 + anyBlocked=true', async () => {
    const repo = await import('../../../persistence/r3SanityBlockRepo.js');
    repo.activateR3SanityBlock({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      message: 'test',
    });
    const state = await import('../../../state.js');
    state.setEmergencyStop(false);
    state.setAutoTradePaused(false);
    state.setManualBlockNewBuy(false);
    state.setManualManageOnly(false);

    const cmd = commandRegistry.resolve('/guards');
    let captured = '';
    await cmd!.execute({ args: [], reply: async (m: string) => { captured = m; } });
    expect(captured).toContain('R3 Sanity Block');
    expect(captured).toContain('🚨 활성');
    expect(captured).toContain('GATE1_PASS_ZERO');
    expect(captured).toContain('R3_EARLY');
    expect(captured).toContain('일부 가드 활성');

    repo.acknowledgeR3SanityBlock('cleanup'); // cleanup
  });
});
