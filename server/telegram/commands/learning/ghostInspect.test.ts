// @responsibility 회귀 테스트 — /ghost_inspect Blocker 분류 + oldest 정렬 + cron 메트릭 + 메시지 포맷
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { GhostPosition } from '../../../learning/reflectionTypes.js';

const NOW = new Date('2026-04-30T06:00:00Z');

function shiftDate(today: string, deltaDays: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function makeGhost(over: Partial<GhostPosition> = {}): GhostPosition {
  return {
    stockCode: '005930',
    stockName: '삼성전자',
    signalPriceKrw: 50000,
    signalDate: '2026-04-15',
    rejectionReason: 'gate2_fail',
    trackUntil: '2026-05-15',
    closed: false,
    ...over,
  };
}

function writeGhosts(tmpDir: string, ghosts: GhostPosition[]): void {
  fs.writeFileSync(path.join(tmpDir, 'ghost-portfolio.json'), JSON.stringify(ghosts));
}

describe('parseGhostInspectArg', () => {
  let mod: typeof import('./ghostInspect.cmd.js');
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./ghostInspect.cmd.js');
  });

  it('1. args 부재 → 10 (default)', () => {
    expect(mod.parseGhostInspectArg(undefined)).toBe(10);
    expect(mod.parseGhostInspectArg([])).toBe(10);
  });
  it('2. 정상 입력 → 정수', () => {
    expect(mod.parseGhostInspectArg(['5'])).toBe(5);
    expect(mod.parseGhostInspectArg(['25'])).toBe(25);
  });
  it('3. clamp — 0 → 1 (MIN), 100 → 30 (MAX)', () => {
    expect(mod.parseGhostInspectArg(['0'])).toBe(1);
    expect(mod.parseGhostInspectArg(['100'])).toBe(30);
  });
  it('4. 잘못된 입력 → default 10', () => {
    expect(mod.parseGhostInspectArg(['abc'])).toBe(10);
  });
  it('5. 정수화 — 7.9 → 7', () => {
    expect(mod.parseGhostInspectArg(['7.9'])).toBe(7);
  });
});

describe('classifyBlocker', () => {
  let mod: typeof import('./ghostInspect.cmd.js');
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./ghostInspect.cmd.js');
  });

  it('1. trackUntil 초과 + closed=false → TRACK_EXPIRED_NOT_CLOSED (진짜 적체)', () => {
    const p = makeGhost({
      signalDate: shiftDate('2026-04-30', -40),
      trackUntil: shiftDate('2026-04-30', -10),
      closed: false,
      lastUpdatedAt: NOW.toISOString(),
    });
    expect(mod.classifyBlocker(p, NOW)).toBe('TRACK_EXPIRED_NOT_CLOSED');
  });

  it('2. lastUpdatedAt 부재 → KIS_PRICE_FETCH_FAIL', () => {
    const p = makeGhost({
      signalDate: shiftDate('2026-04-30', -10),
      trackUntil: shiftDate('2026-04-30', 20),
    });
    expect(mod.classifyBlocker(p, NOW)).toBe('KIS_PRICE_FETCH_FAIL');
  });

  it('3. lastUpdatedAt 24h+ 경과 → KIS_PRICE_FETCH_FAIL', () => {
    const stale = new Date(NOW.getTime() - 30 * 3600 * 1000).toISOString();
    const p = makeGhost({
      signalDate: shiftDate('2026-04-30', -10),
      trackUntil: shiftDate('2026-04-30', 20),
      lastUpdatedAt: stale,
    });
    expect(mod.classifyBlocker(p, NOW)).toBe('KIS_PRICE_FETCH_FAIL');
  });

  it('4. daysOpen < 30 + 최근 갱신 → HOLD_DAYS_NOT_REACHED (정상 추적)', () => {
    const p = makeGhost({
      signalDate: shiftDate('2026-04-30', -10),
      trackUntil: shiftDate('2026-04-30', 20),
      lastUpdatedAt: new Date(NOW.getTime() - 1 * 3600 * 1000).toISOString(),
    });
    expect(mod.classifyBlocker(p, NOW)).toBe('HOLD_DAYS_NOT_REACHED');
  });

  it('5. daysOpen >= 30 + 최근 갱신 + trackUntil 미초과(없음) → STATUS_UNKNOWN', () => {
    const p = makeGhost({
      signalDate: shiftDate('2026-04-30', -35),
      trackUntil: shiftDate('2026-04-30', 5), // 미래로 설정 → 초과 아님
      lastUpdatedAt: new Date(NOW.getTime() - 1 * 3600 * 1000).toISOString(),
    });
    expect(mod.classifyBlocker(p, NOW)).toBe('STATUS_UNKNOWN');
  });

  it('6. 우선순위 — TRACK_EXPIRED 가 KIS_FETCH_FAIL 보다 우선', () => {
    const p = makeGhost({
      signalDate: shiftDate('2026-04-30', -50),
      trackUntil: shiftDate('2026-04-30', -20),
      closed: false,
      // lastUpdatedAt 부재 → KIS_FETCH_FAIL 후보지만 trackUntil 초과 우선
    });
    expect(mod.classifyBlocker(p, NOW)).toBe('TRACK_EXPIRED_NOT_CLOSED');
  });

  it('7. lastUpdatedAt 잘못된 ISO → KIS_PRICE_FETCH_FAIL 안전 fallback', () => {
    const p = makeGhost({
      signalDate: shiftDate('2026-04-30', -10),
      trackUntil: shiftDate('2026-04-30', 20),
      lastUpdatedAt: 'invalid-iso',
    });
    expect(mod.classifyBlocker(p, NOW)).toBe('KIS_PRICE_FETCH_FAIL');
  });
});

describe('collectGhostInspect', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-inspect-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. 영속 부재 → totalCount=0 + topBlocker=null + cron.runCount=0', async () => {
    const { collectGhostInspect } = await import('./ghostInspect.cmd.js');
    const snap = collectGhostInspect(10, NOW);
    expect(snap.totalCount).toBe(0);
    expect(snap.openCount).toBe(0);
    expect(snap.topBlocker).toBeNull();
    expect(snap.cron.runCount).toBe(0);
  });

  it('2. 188건 OPEN 시나리오 — topN=10 정렬 + Blocker 분포', async () => {
    const ghosts: GhostPosition[] = [];
    // 100건: HOLD_DAYS_NOT_REACHED (10일 전 + 최근 갱신)
    for (let i = 0; i < 100; i++) {
      ghosts.push(makeGhost({
        stockCode: `H${String(i).padStart(4, '0')}`,
        signalDate: shiftDate('2026-04-30', -10),
        trackUntil: shiftDate('2026-04-30', 20),
        lastUpdatedAt: new Date(NOW.getTime() - 1 * 3600 * 1000).toISOString(),
      }));
    }
    // 50건: KIS_PRICE_FETCH_FAIL (lastUpdatedAt 부재)
    for (let i = 0; i < 50; i++) {
      ghosts.push(makeGhost({
        stockCode: `K${String(i).padStart(4, '0')}`,
        signalDate: shiftDate('2026-04-30', -15),
        trackUntil: shiftDate('2026-04-30', 15),
      }));
    }
    // 38건: TRACK_EXPIRED_NOT_CLOSED (45일 전 + trackUntil 초과)
    for (let i = 0; i < 38; i++) {
      ghosts.push(makeGhost({
        stockCode: `E${String(i).padStart(4, '0')}`,
        signalDate: shiftDate('2026-04-30', -45),
        trackUntil: shiftDate('2026-04-30', -15),
        closed: false,
      }));
    }
    writeGhosts(tmpDir, ghosts);
    const { collectGhostInspect } = await import('./ghostInspect.cmd.js');
    const snap = collectGhostInspect(10, NOW);
    expect(snap.totalCount).toBe(188);
    expect(snap.openCount).toBe(188);
    expect(snap.oldestOpen.length).toBe(10);
    // 가장 오래된 (45일 전 E* 종목) 이 첫 번째
    expect(snap.oldestOpen[0].position.stockCode.startsWith('E')).toBe(true);
    expect(snap.blockerDistribution.HOLD_DAYS_NOT_REACHED).toBe(100);
    expect(snap.blockerDistribution.KIS_PRICE_FETCH_FAIL).toBe(50);
    expect(snap.blockerDistribution.TRACK_EXPIRED_NOT_CLOSED).toBe(38);
    expect(snap.blockerDistribution.STATUS_UNKNOWN).toBe(0);
  });

  it('3. topBlocker 우선순위 — TRACK_EXPIRED > KIS_FETCH > HOLD (count 동률 시)', async () => {
    // 동률 5건씩
    const ghosts: GhostPosition[] = [];
    for (let i = 0; i < 5; i++) {
      ghosts.push(makeGhost({
        stockCode: `H${i}`,
        signalDate: shiftDate('2026-04-30', -5),
        trackUntil: shiftDate('2026-04-30', 25),
        lastUpdatedAt: NOW.toISOString(),
      }));
    }
    for (let i = 0; i < 5; i++) {
      ghosts.push(makeGhost({
        stockCode: `K${i}`,
        signalDate: shiftDate('2026-04-30', -10),
        trackUntil: shiftDate('2026-04-30', 20),
      }));
    }
    for (let i = 0; i < 5; i++) {
      ghosts.push(makeGhost({
        stockCode: `E${i}`,
        signalDate: shiftDate('2026-04-30', -45),
        trackUntil: shiftDate('2026-04-30', -15),
      }));
    }
    writeGhosts(tmpDir, ghosts);
    const { collectGhostInspect } = await import('./ghostInspect.cmd.js');
    const snap = collectGhostInspect(10, NOW);
    expect(snap.topBlocker?.blocker).toBe('TRACK_EXPIRED_NOT_CLOSED');
    expect(snap.topBlocker?.count).toBe(5);
    expect(snap.topBlocker?.recommendation).toContain('cron 실행 점검');
  });

  it('4. closed 종목 제외 — openCount + closedCount 분리', async () => {
    const ghosts: GhostPosition[] = [
      makeGhost({ stockCode: 'A', closed: true }),
      makeGhost({ stockCode: 'B', closed: true }),
      makeGhost({ stockCode: 'C', closed: false }),
    ];
    writeGhosts(tmpDir, ghosts);
    const { collectGhostInspect } = await import('./ghostInspect.cmd.js');
    const snap = collectGhostInspect(10, NOW);
    expect(snap.totalCount).toBe(3);
    expect(snap.openCount).toBe(1);
    expect(snap.closedCount).toBe(2);
    expect(snap.oldestOpen.length).toBe(1);
    expect(snap.oldestOpen[0].position.stockCode).toBe('C');
  });

  it('5. detail — TRACK_EXPIRED 시 trackUntil 정보 표시', async () => {
    const ghosts: GhostPosition[] = [makeGhost({
      stockCode: 'X',
      signalDate: shiftDate('2026-04-30', -45),
      trackUntil: shiftDate('2026-04-30', -15),
    })];
    writeGhosts(tmpDir, ghosts);
    const { collectGhostInspect } = await import('./ghostInspect.cmd.js');
    const snap = collectGhostInspect(10, NOW);
    expect(snap.oldestOpen[0].detail).toContain('trackUntil');
    expect(snap.oldestOpen[0].detail).toContain('초과');
  });

  it('6. detail — HOLD_DAYS_NOT_REACHED 시 target=30 표시 (사용자 60 가정 정정)', async () => {
    const ghosts: GhostPosition[] = [makeGhost({
      stockCode: 'X',
      signalDate: shiftDate('2026-04-30', -10),
      trackUntil: shiftDate('2026-04-30', 20),
      lastUpdatedAt: NOW.toISOString(),
    })];
    writeGhosts(tmpDir, ghosts);
    const { collectGhostInspect } = await import('./ghostInspect.cmd.js');
    const snap = collectGhostInspect(10, NOW);
    expect(snap.oldestOpen[0].detail).toContain('target=30일');
  });
});

describe('formatGhostInspectMessage', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-fmt-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. 빈 데이터 시 ✅ 적체 없음', async () => {
    const { collectGhostInspect, formatGhostInspectMessage } = await import('./ghostInspect.cmd.js');
    const msg = formatGhostInspectMessage(collectGhostInspect(10, NOW));
    expect(msg).toContain('Ghost Inspect');
    expect(msg).toContain('OPEN ghost 부재');
    expect(msg).toContain('✅ 적체 없음');
  });

  it('2. cron runCount=0 시 ⚠️ 경고', async () => {
    const { collectGhostInspect, formatGhostInspectMessage } = await import('./ghostInspect.cmd.js');
    const msg = formatGhostInspectMessage(collectGhostInspect(10, NOW));
    expect(msg).toContain('cron 실행 이력 0건');
  });

  it('3. 4 카테고리 라벨 모두 노출', async () => {
    const { collectGhostInspect, formatGhostInspectMessage } = await import('./ghostInspect.cmd.js');
    const msg = formatGhostInspectMessage(collectGhostInspect(10, NOW));
    expect(msg).toContain('TRACK_EXPIRED_NOT_CLOSED');
    expect(msg).toContain('KIS_PRICE_FETCH_FAIL');
    expect(msg).toContain('HOLD_DAYS_NOT_REACHED');
    expect(msg).toContain('STATUS_UNKNOWN');
  });

  it('4. topBlocker recommendation 노출', async () => {
    const ghosts: GhostPosition[] = [makeGhost({
      signalDate: shiftDate('2026-04-30', -45),
      trackUntil: shiftDate('2026-04-30', -15),
    })];
    writeGhosts(tmpDir, ghosts);
    const { collectGhostInspect, formatGhostInspectMessage } = await import('./ghostInspect.cmd.js');
    const msg = formatGhostInspectMessage(collectGhostInspect(10, NOW));
    expect(msg).toContain('가장 큰 적체 원인: TRACK_EXPIRED_NOT_CLOSED');
    expect(msg).toContain('cron 실행 점검');
  });
});

describe('cmd 메타데이터 + 등록', () => {
  beforeEach(() => vi.resetModules());

  it('1. name + alias /gi + LRN + riskLevel=0', async () => {
    const mod = await import('./ghostInspect.cmd.js');
    expect(mod.default.name).toBe('/ghost_inspect');
    expect(mod.default.aliases).toContain('/gi');
    expect(mod.default.category).toBe('LRN');
    expect(mod.default.riskLevel).toBe(0);
    expect(mod.default.visibility).toBe('ADMIN');
  });

  it('2. commandRegistry 에 등록 — alias 동일 instance', async () => {
    await import('./ghostInspect.cmd.js');
    const { commandRegistry } = await import('../../commandRegistry.js');
    const main = commandRegistry.resolve('/ghost_inspect');
    const alias = commandRegistry.resolve('/gi');
    expect(main).toBe(alias);
    expect(main).toBeTruthy();
  });

  it('3. execute 정상 — reply 1회 호출', async () => {
    const mod = await import('./ghostInspect.cmd.js');
    const reply = vi.fn(async (_msg: string) => {});
    await mod.default.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toContain('Ghost Inspect');
  });

  it('4. execute throw graceful', async () => {
    const mod = await import('./ghostInspect.cmd.js');
    const reply = vi.fn(async (_msg: string) => {});
    await expect(mod.default.execute({ args: ['10'], reply })).resolves.toBeUndefined();
  });
});
