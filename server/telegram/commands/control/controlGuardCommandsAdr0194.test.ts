/**
 * @responsibility ADR-0194 텔레그램 신규 매수 차단 가드 명령 회귀 테스트
 *
 * `/unblock_buy` + `/unmanage_only` + `/guards` 3 명령 신설.
 * 사용자 5/6 보고 후속 — UI/HTTP 외 텔레그램 채널 운영 동등성 회복.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

import { commandRegistry } from '../../commandRegistry.js';
import './unblockBuy.cmd.js';
import './unmanageOnly.cmd.js';
import './guards.cmd.js';

// 모듈 import 시점에 3 명령 자동 등록 — vi.resetModules 사용 안 함.
async function loadCommands() {
  return { commandRegistry };
}

const UNBLOCK_PATH = path.resolve(__dirname, 'unblockBuy.cmd.ts');
const UNMANAGE_PATH = path.resolve(__dirname, 'unmanageOnly.cmd.ts');
const GUARDS_PATH = path.resolve(__dirname, 'guards.cmd.ts');
const BARREL_PATH = path.resolve(__dirname, 'index.ts');

const unblockSrc = fs.readFileSync(UNBLOCK_PATH, 'utf-8');
const unmanageSrc = fs.readFileSync(UNMANAGE_PATH, 'utf-8');
const guardsSrc = fs.readFileSync(GUARDS_PATH, 'utf-8');
const barrelSrc = fs.readFileSync(BARREL_PATH, 'utf-8');

describe('ADR-0194 정적 가드 — 3 신규 명령 파일·barrel 등록', () => {
  it('barrel 에 3 신규 cmd import 등록', () => {
    expect(barrelSrc).toMatch(/import '\.\/unblockBuy\.cmd\.js'/);
    expect(barrelSrc).toMatch(/import '\.\/unmanageOnly\.cmd\.js'/);
    expect(barrelSrc).toMatch(/import '\.\/guards\.cmd\.js'/);
    expect(barrelSrc).toMatch(/ADR-0194/);
  });

  it('/unblock_buy 메타데이터 (alias + EMR + riskLevel=1)', () => {
    expect(unblockSrc).toMatch(/name: '\/unblock_buy'/);
    expect(unblockSrc).toMatch(/aliases: \['\/unblock', '\/allow_buy'\]/);
    expect(unblockSrc).toMatch(/category: 'EMR'/);
    expect(unblockSrc).toMatch(/riskLevel: 1/);
    expect(unblockSrc).toMatch(/setManualBlockNewBuy\(false\)/);
  });

  it('/unmanage_only 메타데이터 + ADR-0193 대칭 coupling 호출', () => {
    expect(unmanageSrc).toMatch(/name: '\/unmanage_only'/);
    expect(unmanageSrc).toMatch(/aliases: \['\/manage_off', '\/unmanage'\]/);
    expect(unmanageSrc).toMatch(/setManualManageOnly\(false\)/);
    expect(unmanageSrc).toMatch(/setManualBlockNewBuy\(false\)/);
    expect(unmanageSrc).toMatch(/MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED === ['"]true['"]/);
  });

  it('/guards 메타데이터 (read-only riskLevel=0)', () => {
    expect(guardsSrc).toMatch(/name: '\/guards'/);
    expect(guardsSrc).toMatch(/aliases: \['\/block_status', '\/blocks'\]/);
    expect(guardsSrc).toMatch(/riskLevel: 0/);
    // 6 가드 + 추가 상태 모두 조회 — set* 호출 0건 보장.
    const setMatches = guardsSrc.match(/\bset(?!TimeOut|Interval)[A-Z]\w+\(/g);
    expect(setMatches).toBeNull();
  });

  it('ADR-0194 + ADR-0193 추적 주석 (정책 정합성)', () => {
    expect(unblockSrc).toMatch(/ADR-0194/);
    expect(unmanageSrc).toMatch(/ADR-0193/);
    expect(unmanageSrc).toMatch(/ADR-0194/);
    expect(guardsSrc).toMatch(/ADR-0194/);
  });
});

describe('ADR-0194 동작 매트릭스 — /unblock_buy', () => {
  beforeEach(async () => {
    delete process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED;
  });
  afterEach(() => {
    delete process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED;
  });

  it('blockNewBuy=true → 해제 + 안내 메시지', async () => {
    const reg = await loadCommands();
    const state = await import('../../../state.js');
    state.setManualBlockNewBuy(true);
    state.setManualManageOnly(false);

    const cmd = reg.commandRegistry.resolve('/unblock_buy');
    expect(cmd).toBeDefined();
    let captured = '';
    await cmd!.execute({ args: [], reply: async (m: string) => { captured = m; } });
    expect(state.getManualBlockNewBuy()).toBe(false);
    expect(captured).toContain('신규 매수 차단 해제');
    expect(captured).toContain('재허용');
  });

  it('이미 해제 상태 → 멱등 + 안내', async () => {
    const reg = await loadCommands();
    const state = await import('../../../state.js');
    state.setManualBlockNewBuy(false);

    let captured = '';
    await reg.commandRegistry.resolve('/unblock_buy')!.execute({
      args: [], reply: async (m: string) => { captured = m; },
    });
    expect(captured).toContain('이미 신규 매수 허용');
  });

  it('alias /unblock + /allow_buy 동일 인스턴스 (commandRegistry SSOT)', async () => {
    const reg = await loadCommands();
    const a = reg.commandRegistry.resolve('/unblock_buy');
    const b = reg.commandRegistry.resolve('/unblock');
    const c = reg.commandRegistry.resolve('/allow_buy');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('manageOnly 활성 시 해제 메시지에 "여전히 활성" 표기', async () => {
    const reg = await loadCommands();
    const state = await import('../../../state.js');
    state.setManualBlockNewBuy(true);
    state.setManualManageOnly(true);

    let captured = '';
    await reg.commandRegistry.resolve('/unblock_buy')!.execute({
      args: [], reply: async (m: string) => { captured = m; },
    });
    expect(captured).toContain('보유만 관리');
    expect(captured).toContain('여전히 활성');
    state.setManualManageOnly(false); // cleanup
  });
});

describe('ADR-0194 동작 매트릭스 — /unmanage_only (ADR-0193 대칭 coupling)', () => {
  beforeEach(() => {
    delete process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED;
  });
  afterEach(() => {
    delete process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED;
  });

  it('default ADR-0193 정책 — manageOnly OFF → blockNewBuy 도 동시 해제', async () => {
    const reg = await loadCommands();
    const state = await import('../../../state.js');
    state.setManualManageOnly(true);
    state.setManualBlockNewBuy(true);

    let captured = '';
    await reg.commandRegistry.resolve('/unmanage_only')!.execute({
      args: [], reply: async (m: string) => { captured = m; },
    });
    expect(state.getManualManageOnly()).toBe(false);
    expect(state.getManualBlockNewBuy()).toBe(false);
    expect(captured).toContain('동시 해제');
    expect(captured).toContain('ADR-0193');
  });

  it('legacy ENV=true — manageOnly OFF → blockNewBuy 보존 (기존 동작)', async () => {
    process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED = 'true';
    const reg = await loadCommands();
    const state = await import('../../../state.js');
    state.setManualManageOnly(true);
    state.setManualBlockNewBuy(true);

    let captured = '';
    await reg.commandRegistry.resolve('/unmanage_only')!.execute({
      args: [], reply: async (m: string) => { captured = m; },
    });
    expect(state.getManualManageOnly()).toBe(false);
    expect(state.getManualBlockNewBuy()).toBe(true); // legacy: 보존
    expect(captured).toContain('legacy');
  });

  it('이미 비활성 → 멱등', async () => {
    const reg = await loadCommands();
    const state = await import('../../../state.js');
    state.setManualManageOnly(false);
    state.setManualBlockNewBuy(false);

    let captured = '';
    await reg.commandRegistry.resolve('/unmanage_only')!.execute({
      args: [], reply: async (m: string) => { captured = m; },
    });
    expect(captured).toContain('이미 보유만 관리 비활성');
  });

  it('alias /manage_off + /unmanage 동일 인스턴스', async () => {
    const reg = await loadCommands();
    const a = reg.commandRegistry.resolve('/unmanage_only');
    const b = reg.commandRegistry.resolve('/manage_off');
    const c = reg.commandRegistry.resolve('/unmanage');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });
});

describe('ADR-0194 동작 매트릭스 — /guards (read-only 통합 진단)', () => {
  it('6 가드 + 추가 상태 모두 표시 (anyBlocked=false 시 정상 라벨)', async () => {
    const reg = await loadCommands();
    const state = await import('../../../state.js');
    state.setEmergencyStop(false);
    state.setAutoTradePaused(false);
    state.setDataIntegrityBlocked(false);
    state.setManualBlockNewBuy(false);
    state.setManualManageOnly(false);
    state.setSmokeTestLiveBlocked(false);
    state.setDailyLoss(0);

    let captured = '';
    await reg.commandRegistry.resolve('/guards')!.execute({
      args: [], reply: async (m: string) => { captured = m; },
    });
    expect(captured).toContain('비상정지');
    expect(captured).toContain('소프트 일시정지');
    expect(captured).toContain('데이터 무결성');
    expect(captured).toContain('신규 매수 차단');
    expect(captured).toContain('보유만 관리');
    expect(captured).toContain('Pre-Market Smoke Test');
    expect(captured).toContain('일일 손실 한도');
    expect(captured).toContain('모든 가드 정상');
  });

  it('일부 가드 활성 시 anyBlocked=true 안내', async () => {
    const reg = await loadCommands();
    const state = await import('../../../state.js');
    state.setManualBlockNewBuy(true);
    state.setManualManageOnly(false);
    state.setEmergencyStop(false);
    state.setAutoTradePaused(false);

    let captured = '';
    await reg.commandRegistry.resolve('/guards')!.execute({
      args: [], reply: async (m: string) => { captured = m; },
    });
    expect(captured).toContain('일부 가드 활성');
    expect(captured).toContain('🔴 활성');

    state.setManualBlockNewBuy(false); // cleanup
  });

  it('alias /block_status + /blocks 동일 인스턴스', async () => {
    const reg = await loadCommands();
    const a = reg.commandRegistry.resolve('/guards');
    const b = reg.commandRegistry.resolve('/block_status');
    const c = reg.commandRegistry.resolve('/blocks');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('riskLevel=0 read-only — state.set* 호출 0건 (정적 가드)', () => {
    // guards.cmd.ts 본문에 set* 함수 호출 0건 (set* 보다 setTimeout/setInterval 같은 false-positive 회피).
    const lines = guardsSrc.split('\n').filter(l => !l.trim().startsWith('//'));
    const cleanedSrc = lines.join('\n');
    expect(cleanedSrc).not.toMatch(/setManualBlockNewBuy\(/);
    expect(cleanedSrc).not.toMatch(/setManualManageOnly\(/);
    expect(cleanedSrc).not.toMatch(/setEmergencyStop\(/);
    expect(cleanedSrc).not.toMatch(/setAutoTradePaused\(/);
  });
});
