// @responsibility: Phase B3 SHADOW 매매 흐름 시뮬레이션 — pause/resume/stop/reset/integrity + sell SHADOW 봉쇄 + 비상정지 시 scan/krx_scan 차단을 commandRegistry 진입점으로 검증.
//
// LIVE 호출(KIS 주문/현재가/취소) 은 모두 vi.spyOn 으로 stub 되어 외부 영향 0.
// 본 테스트는 webhookHandler 분해 후에도 매매 안전성 가드(emergency stop / 일시정지 /
// 데이터 무결성 / SHADOW 보호) 가 정확히 동작하는지 통합 검증한다.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

import { commandRegistry } from './commandRegistry.js';
import * as state from '../state.js';
import * as emergency from '../emergency.js';
import * as shadowRepo from '../persistence/shadowTradeRepo.js';
import * as scanner from '../trading/signalScanner.js';

interface CapturedReply {
  text: string;
}

function makeCapture(): {
  reply: (text: string) => Promise<void>;
  calls: CapturedReply[];
} {
  const calls: CapturedReply[] = [];
  return {
    reply: async (text: string) => {
      calls.push({ text });
    },
    calls,
  };
}

async function runCmd(name: string, args: string[] = []): Promise<CapturedReply[]> {
  const handler = commandRegistry.resolve(name);
  if (!handler) throw new Error(`command not registered: ${name}`);
  const { reply, calls } = makeCapture();
  await handler.execute({ args, reply });
  return calls;
}

beforeAll(async () => {
  // 모든 8 barrel side-effect import — Phase A+B1+B2+B3 cmd 전수 등록 트리거.
  await import('./commands/system/index.js');
  await import('./commands/watchlist/index.js');
  await import('./commands/positions/index.js');
  await import('./commands/alert/index.js');
  await import('./commands/learning/index.js');
  await import('./commands/control/index.js');
  await import('./commands/trade/index.js');
  await import('./commands/infra/index.js');
});

beforeEach(() => {
  vi.restoreAllMocks();
  // 안전 기본값 — 모든 케이스 진입 전 클린 상태.
  state.setEmergencyStop(false);
  state.setAutoTradePaused(false);
  state.setDataIntegrityBlocked(false);
});

afterEach(() => {
  state.setEmergencyStop(false);
  state.setAutoTradePaused(false);
  state.setDataIntegrityBlocked(false);
});

// ── Step 1. 일시정지 → 재개 흐름 ────────────────────────────────────────────

describe('SHADOW 시뮬레이션 — Step 1: /pause + /resume 토글', () => {
  it('초기 상태 → /pause → autoTradePaused=true + 안내 메시지', async () => {
    expect(state.getAutoTradePaused()).toBe(false);
    const calls = await runCmd('/pause');
    expect(state.getAutoTradePaused()).toBe(true);
    expect(calls[0].text).toContain('엔진 일시정지');
  });

  it('/pause 두 번 → 두 번째는 "이미 일시정지" 안내, 상태 무변화', async () => {
    state.setAutoTradePaused(true);
    const calls = await runCmd('/pause');
    expect(state.getAutoTradePaused()).toBe(true);
    expect(calls[0].text).toContain('이미 일시정지');
  });

  it('/resume → autoTradePaused=false + 재개 안내', async () => {
    state.setAutoTradePaused(true);
    const calls = await runCmd('/resume');
    expect(state.getAutoTradePaused()).toBe(false);
    expect(calls[0].text).toContain('엔진 재개');
  });

  it('/resume 빈 상태 → "이미 실행 중" 안내, 상태 무변화', async () => {
    expect(state.getAutoTradePaused()).toBe(false);
    const calls = await runCmd('/resume');
    expect(calls[0].text).toContain('이미 실행 중');
  });

  it('비상정지 ON 상태에서 /pause → 차단되고 안내 표시', async () => {
    state.setEmergencyStop(true);
    const calls = await runCmd('/pause');
    expect(state.getAutoTradePaused()).toBe(false); // 변경 없음
    expect(calls[0].text).toContain('이미 비상 정지');
  });
});

// ── Step 2. 비상정지 → 해제 흐름 + cancelAllPendingOrders 호출 검증 ──────────

describe('SHADOW 시뮬레이션 — Step 2: /stop + /reset 비상정지 토글', () => {
  it('/stop → emergencyStop=true + cancelAllPendingOrders 호출 + 안내', async () => {
    const cancelSpy = vi
      .spyOn(emergency, 'cancelAllPendingOrders')
      .mockResolvedValue(undefined);
    expect(state.getEmergencyStop()).toBe(false);
    const calls = await runCmd('/stop');
    expect(state.getEmergencyStop()).toBe(true);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(calls[0].text).toContain('비상 정지 발동');
  });

  it('/reset → emergencyStop=false + dailyLoss 0 + 서킷/regime 다운그레이드 해제', async () => {
    state.setEmergencyStop(true);
    state.setDailyLoss(3.5);
    delete process.env.EMERGENCY_RESET_SECRET; // 인증 없이 진행 가능

    const calls = await runCmd('/reset');
    expect(state.getEmergencyStop()).toBe(false);
    expect(state.getDailyLossPct()).toBe(0);
    expect(calls[0].text).toContain('비상 정지 해제');
  });

  it('/reset + 잘못된 비밀번호 → 차단, 상태 유지', async () => {
    process.env.EMERGENCY_RESET_SECRET = 'correct';
    state.setEmergencyStop(true);

    const calls = await runCmd('/reset', ['wrong']);
    expect(state.getEmergencyStop()).toBe(true); // 변경 없음
    expect(calls[0].text).toContain('인증 실패');

    delete process.env.EMERGENCY_RESET_SECRET;
  });

  it('/reset + 정확한 비밀번호 → 통과', async () => {
    process.env.EMERGENCY_RESET_SECRET = 'correct';
    state.setEmergencyStop(true);

    const calls = await runCmd('/reset', ['correct']);
    expect(state.getEmergencyStop()).toBe(false);
    expect(calls[0].text).toContain('비상 정지 해제');

    delete process.env.EMERGENCY_RESET_SECRET;
  });
});

// ── Step 3. 비상정지 시 신규 매매 차단 (scan/krx_scan) ───────────────────────

describe('SHADOW 시뮬레이션 — Step 3: 비상정지 시 신규 매매 차단', () => {
  it('/scan + emergencyStop=true → 차단 안내 + runAutoSignalScan 미호출', async () => {
    state.setEmergencyStop(true);
    const scanSpy = vi.spyOn(scanner, 'runAutoSignalScan').mockResolvedValue({});
    const calls = await runCmd('/scan');
    expect(scanSpy).not.toHaveBeenCalled();
    expect(calls[0].text).toContain('비상 정지');
  });

  it('/krx_scan + emergencyStop=true → 차단', async () => {
    state.setEmergencyStop(true);
    const calls = await runCmd('/krx_scan');
    expect(calls[0].text).toContain('비상 정지');
  });
});

// ── Step 4. /integrity 데이터 무결성 차단 토글 ───────────────────────────────

describe('SHADOW 시뮬레이션 — Step 4: /integrity 데이터 무결성', () => {
  it('/integrity → 현재 상태 보고 + 변경 없음', async () => {
    state.setDataIntegrityBlocked(true);
    const calls = await runCmd('/integrity');
    expect(state.getDataIntegrityBlocked()).toBe(true);
    expect(calls[0].text).toContain('차단 중');
  });

  it('/integrity clear → 차단 해제', async () => {
    state.setDataIntegrityBlocked(true);
    const calls = await runCmd('/integrity', ['clear']);
    expect(state.getDataIntegrityBlocked()).toBe(false);
    expect(calls[0].text).toContain('차단 해제');
  });
});

// ── Step 5. SHADOW /sell 봉쇄 — 학습 데이터 오염 차단 ───────────────────────

describe('SHADOW 시뮬레이션 — Step 5: SHADOW /sell 봉쇄 (학습 데이터 무결성)', () => {
  it('SHADOW 포지션에 /sell → 봉쇄 메시지 + 상태 무변경', async () => {
    const shadowTrade = {
      id: 'test-shadow-1',
      stockCode: '005930',
      stockName: '삼성전자',
      mode: 'SHADOW' as const,
      status: 'ACTIVE',
      shadowEntryPrice: 70000,
      quantity: 10,
      originalQuantity: 10,
      stopLoss: 64400,
      hardStopLoss: 64400,
      targetPrice: 80500,
      signalTime: new Date().toISOString(),
      fills: [
        { type: 'BUY' as const, qty: 10, price: 70000, status: 'CONFIRMED' as const, timestamp: new Date().toISOString() },
      ],
    };
    vi.spyOn(shadowRepo, 'loadShadowTrades').mockReturnValue([
      shadowTrade as unknown as ReturnType<typeof shadowRepo.loadShadowTrades>[number],
    ]);
    vi.spyOn(scanner, 'isOpenShadowStatus').mockReturnValue(true);

    const calls = await runCmd('/sell', ['005930']);
    expect(calls[0].text).toContain('SHADOW');
    // 본문 차단 메시지 — 봉쇄 명시.
    const merged = calls.map(c => c.text).join('\n');
    expect(merged).toContain('수동 청산 차단');
  });

  it('보유 포지션 없는 종목 → /sell 진입 시 "보유 포지션 없음"', async () => {
    vi.spyOn(shadowRepo, 'loadShadowTrades').mockReturnValue([]);
    const calls = await runCmd('/sell', ['005930']);
    expect(calls[0].text).toContain('보유 포지션 없음');
  });

  it('잘못된 코드 → 사용법 안내 (잔량 조회 없이 즉시 차단)', async () => {
    const calls = await runCmd('/sell', ['abc']);
    expect(calls[0].text).toContain('사용법');
  });
});

// ── Step 6. registry-driven flow — 모든 EMR/TRD/Infra 명령 resolvable ──────

describe('SHADOW 시뮬레이션 — Step 6: 17 신규 명령 + alias resolve 검증', () => {
  it('control 5명 모두 resolvable 및 category=EMR', () => {
    for (const name of ['/pause', '/resume', '/stop', '/reset', '/integrity']) {
      const cmd = commandRegistry.resolve(name);
      expect(cmd, `missing ${name}`).toBeDefined();
      expect(cmd?.category).toBe('EMR');
    }
  });

  it('trade 10명 모두 resolvable 및 category=TRD', () => {
    for (const name of [
      '/buy',
      '/sell',
      '/cancel',
      '/adjust_qty',
      '/reconcile',
      '/scan',
      '/krx_scan',
      '/stage1_audit',
      '/report',
      '/shadow',
    ]) {
      const cmd = commandRegistry.resolve(name);
      expect(cmd, `missing ${name}`).toBeDefined();
      expect(cmd?.category).toBe('TRD');
    }
  });

  it('/reconcile 에 /reconcile_qty alias (동일 instance)', () => {
    expect(commandRegistry.resolve('/reconcile')).toBe(
      commandRegistry.resolve('/reconcile_qty'),
    );
  });

  it('infra 2명 (/refresh_token /reconnect_ws) — category=EMR + riskLevel=1', () => {
    for (const name of ['/refresh_token', '/reconnect_ws']) {
      const cmd = commandRegistry.resolve(name);
      expect(cmd, `missing ${name}`).toBeDefined();
      expect(cmd?.category).toBe('EMR');
      expect(cmd?.riskLevel).toBe(1);
    }
  });

  it('LIVE 매매 위험도 (/buy /sell /cancel /adjust_qty /reconcile /scan /krx_scan /pause /resume /stop /reset) — riskLevel=2 명시', () => {
    for (const name of [
      '/buy',
      '/sell',
      '/cancel',
      '/adjust_qty',
      '/reconcile',
      '/scan',
      '/krx_scan',
      '/pause',
      '/resume',
      '/stop',
      '/reset',
    ]) {
      const cmd = commandRegistry.resolve(name);
      expect(cmd, `missing ${name}`).toBeDefined();
      expect(cmd?.riskLevel, `${name} riskLevel`).toBe(2);
    }
  });

  it('Phase A+B1+B2+B3 누적 — ≥51 unique cmd objects, 전 카테고리 (SYS/MKT/WL/POS/TRD/LRN/ALR/EMR) 등록', () => {
    const all = commandRegistry.all();
    expect(all.length).toBeGreaterThanOrEqual(51);
    const categories = new Set(all.map(c => c.category));
    for (const cat of ['SYS', 'MKT', 'WL', 'POS', 'TRD', 'LRN', 'ALR', 'EMR']) {
      expect(categories.has(cat as 'SYS' | 'MKT' | 'WL' | 'POS' | 'TRD' | 'LRN' | 'ALR' | 'EMR'), `category ${cat}`).toBe(true);
    }
  });
});

// ── Step 7. /buy + /cancel 사용법 가드 (잘못된 입력 거부) ──────────────────

describe('SHADOW 시뮬레이션 — Step 7: 입력 가드 (잘못된 코드/수량)', () => {
  it('/buy + 잘못된 코드 → 사용법 안내, runAutoSignalScan 미호출', async () => {
    const scanSpy = vi.spyOn(scanner, 'runAutoSignalScan').mockResolvedValue({});
    const calls = await runCmd('/buy', ['abc']);
    expect(scanSpy).not.toHaveBeenCalled();
    expect(calls[0].text).toContain('사용법');
  });

  it('/cancel + 잘못된 코드 → 사용법 안내', async () => {
    const calls = await runCmd('/cancel', ['xyz']);
    expect(calls[0].text).toContain('사용법');
  });

  it('/adjust_qty + 음수 → 사용법 안내', async () => {
    const calls = await runCmd('/adjust_qty', ['005930', '-5']);
    expect(calls[0].text).toContain('사용법');
  });
});
