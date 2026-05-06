/**
 * @responsibility ADR-0401 /r3_status 텔레그램 명령 회귀 테스트.
 *
 * read-only riskLevel=0 ADMIN. streak + latch + profile 통합 진단 출력.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const R3_STATUS_PATH = path.resolve(__dirname, 'r3Status.cmd.ts');
const BARREL_PATH = path.resolve(__dirname, 'index.ts');

const r3StatusSrc = fs.readFileSync(R3_STATUS_PATH, 'utf-8');
const barrelSrc = fs.readFileSync(BARREL_PATH, 'utf-8');

describe('ADR-0401 /r3_status 정적 가드', () => {
  it('barrel 에 r3Status.cmd 등록', () => {
    expect(barrelSrc).toMatch(/import '\.\/r3Status\.cmd\.js'/);
    expect(barrelSrc).toMatch(/ADR-0401/);
  });

  it('/r3_status 메타데이터 (alias + EMR + riskLevel=0 read-only)', () => {
    expect(r3StatusSrc).toMatch(/name: '\/r3_status'/);
    expect(r3StatusSrc).toMatch(/aliases: \['\/r3', '\/r3_state'\]/);
    expect(r3StatusSrc).toMatch(/category: 'EMR'/);
    expect(r3StatusSrc).toMatch(/riskLevel: 0/); // read-only
    expect(r3StatusSrc).toMatch(/visibility: 'ADMIN'/);
  });

  it('영속 streak SSOT + latch SSOT 함께 호출 (정적)', () => {
    expect(r3StatusSrc).toMatch(/getEffectiveR3ViolationStreak/);
    expect(r3StatusSrc).toMatch(/loadR3SanityBlockState/);
    expect(r3StatusSrc).toMatch(/getR3SanityProfile/);
  });

  it('KIS 주문 함수 import 0건 (절대 원칙 #13)', () => {
    expect(r3StatusSrc).not.toMatch(/placeKisMarketOrder/);
    expect(r3StatusSrc).not.toMatch(/placeKisSellOrder/);
    expect(r3StatusSrc).not.toMatch(/cancelKisOrder/);
  });
});

describe('ADR-0401 /r3_status 동작 매트릭스', () => {
  let tmpDir: string;
  let originalDataDir: string | undefined;
  let cmd: { execute: (ctx: { args: string[]; reply: (m: string) => Promise<void> }) => Promise<void> } | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3status-'));
    originalDataDir = process.env.PERSIST_DATA_DIR;
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.R3_VIOLATION_STREAK_DECAY_HOURS;
    vi.resetModules();
    await import('./r3Status.cmd.js');
    const registry = await import('../../commandRegistry.js');
    cmd = registry.commandRegistry.resolve('/r3_status');
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalDataDir;
    delete process.env.R3_VIOLATION_STREAK_DECAY_HOURS;
    vi.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('streak + latch 모두 비활성 → CLEAN 메시지', async () => {
    let captured = '';
    await cmd!.execute({ args: [], reply: async (m: string) => { captured = m; } });
    expect(captured).toContain('R3 Sanity 통합 상태');
    expect(captured).toContain('streak: CLEAN');
    expect(captured).toContain('영속 HARD_BLOCK latch 비활성');
    expect(captured).toContain('차단 없음');
  });

  it('streak count=2 (R3_EARLY) → WARNING 표시', async () => {
    const repo = await import('../../../persistence/r3ViolationStreakRepo.js');
    const T0 = new Date('2026-05-06T01:00:00.000Z');
    repo.updateR3ViolationStreak({ violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: 'A', now: T0 });
    repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: 'B',
      now: new Date(T0.getTime() + 60 * 60_000),
    });

    let captured = '';
    await cmd!.execute({ args: [], reply: async (m: string) => { captured = m; } });
    expect(captured).toMatch(/누적.*2.*회/);
    expect(captured).toMatch(/위반.*GATE1_PASS_ZERO/);
    expect(captured).toMatch(/R3_EARLY/);
  });

  it('latch 활성 → HARD_BLOCK 메시지 + /r3_unblock 안내', async () => {
    const blockRepo = await import('../../../persistence/r3SanityBlockRepo.js');
    blockRepo.activateR3SanityBlock({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', message: 'test',
      now: new Date('2026-05-06T01:00:00.000Z'),
    });

    let captured = '';
    await cmd!.execute({ args: [], reply: async (m: string) => { captured = m; } });
    expect(captured).toContain('영속 HARD_BLOCK latch 활성');
    expect(captured).toContain('/r3_unblock');
    expect(captured).toContain('GATE1_PASS_ZERO');
    expect(captured).toContain('신규 매수 차단');
  });

  it('alias /r3 + /r3_state 동일 인스턴스', async () => {
    const registry = await import('../../commandRegistry.js');
    const a = registry.commandRegistry.resolve('/r3_status');
    const b = registry.commandRegistry.resolve('/r3');
    const c = registry.commandRegistry.resolve('/r3_state');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('streak + latch 동시 활성 → 두 섹션 모두 표시', async () => {
    const repo = await import('../../../persistence/r3ViolationStreakRepo.js');
    const blockRepo = await import('../../../persistence/r3SanityBlockRepo.js');
    repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: 'A',
      now: new Date('2026-05-06T01:00:00.000Z'),
    });
    blockRepo.activateR3SanityBlock({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', message: 'test',
    });

    let captured = '';
    await cmd!.execute({ args: [], reply: async (m: string) => { captured = m; } });
    expect(captured).toContain('영속 HARD_BLOCK latch 활성');
    expect(captured).toContain('streak');
  });

  it('decayHours ENV 표시', async () => {
    process.env.R3_VIOLATION_STREAK_DECAY_HOURS = '12';
    let captured = '';
    await cmd!.execute({ args: [], reply: async (m: string) => { captured = m; } });
    expect(captured).toContain('decayHours=12h');
  });
});
