import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-'));
process.env.PERSIST_DATA_DIR = tmpDir;

vi.mock('../orchestrator/adaptiveScanScheduler.js', () => ({
  getLastScanAt: vi.fn(() => 0),
}));
vi.mock('../persistence/persistentErrorLog.js', () => ({
  summarizeErrors: vi.fn(() => ({ recent24h: 0, fatal24h: 0, bySource: {}, lastAt: null })),
}));
vi.mock('../state.js', () => ({
  getEmergencyStop: vi.fn(() => false),
}));

const adaptiveSched = await import('../orchestrator/adaptiveScanScheduler.js');
const errorLog = await import('../persistence/persistentErrorLog.js');
const state = await import('../state.js');
const watchdogRouter = (await import('./watchdogRouter.js')).default;

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
});

interface MockRes {
  statusCode: number;
  body: unknown;
  status: (n: number) => MockRes;
  json: (b: unknown) => void;
}

function mkRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    status(n: number) { this.statusCode = n; return this; },
    json(b: unknown) { this.body = b; },
  };
  return res;
}

function callHeartbeat(): MockRes {
  // express Router 의 stack 을 직접 traverse 하지 않고 핸들러 추출.
  type Layer = { route?: { path: string; stack: { handle: (req: unknown, res: unknown) => void }[] } };
  const routerWithStack = watchdogRouter as unknown as { stack: Layer[] };
  const layer = routerWithStack.stack.find((l) => l.route?.path === '/heartbeat');
  if (!layer || !layer.route) throw new Error('handler not found');
  const handler = layer.route.stack[0].handle;
  const res = mkRes();
  handler({ headers: {} } as unknown, res as unknown);
  return res;
}

beforeEach(() => {
  vi.mocked(adaptiveSched.getLastScanAt).mockReturnValue(0);
  vi.mocked(errorLog.summarizeErrors).mockReturnValue({ recent24h: 0, fatal24h: 0, bySource: {}, lastAt: null });
  vi.mocked(state.getEmergencyStop).mockReturnValue(false);
  delete process.env.AUTO_TRADE_MODE;
});

describe('GET /api/watchdog/heartbeat', () => {
  it('alive=true + 200 OK 반환 (기본)', () => {
    const res = callHeartbeat();
    expect(res.statusCode).toBe(200);
    const body = res.body as { alive: boolean; lastScanAgeSec: number | null; criticalErrors24h: number };
    expect(body.alive).toBe(true);
    expect(body.lastScanAgeSec).toBeNull();
    expect(body.criticalErrors24h).toBe(0);
  });

  it('lastScanAt=0 시 lastScanAgeSec 는 null', () => {
    vi.mocked(adaptiveSched.getLastScanAt).mockReturnValue(0);
    const res = callHeartbeat();
    expect((res.body as { lastScanAgeSec: number | null }).lastScanAgeSec).toBeNull();
  });

  it('lastScanAt 이 과거 timestamp 면 양수 lastScanAgeSec', () => {
    vi.mocked(adaptiveSched.getLastScanAt).mockReturnValue(Date.now() - 30_000);
    const res = callHeartbeat();
    const age = (res.body as { lastScanAgeSec: number | null }).lastScanAgeSec;
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(30);
    expect(age!).toBeLessThan(60);
  });

  it('mode 는 LIVE/SHADOW/VTS 중 하나, 미설정 시 UNSET', () => {
    process.env.AUTO_TRADE_MODE = 'LIVE';
    expect((callHeartbeat().body as { mode: string }).mode).toBe('LIVE');
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    expect((callHeartbeat().body as { mode: string }).mode).toBe('SHADOW');
    process.env.AUTO_TRADE_MODE = 'vts';
    expect((callHeartbeat().body as { mode: string }).mode).toBe('VTS');
    delete process.env.AUTO_TRADE_MODE;
    expect((callHeartbeat().body as { mode: string }).mode).toBe('UNSET');
  });

  it('emergencyStop 반영', () => {
    vi.mocked(state.getEmergencyStop).mockReturnValue(true);
    expect((callHeartbeat().body as { emergencyStop: boolean }).emergencyStop).toBe(true);
  });

  it('criticalErrors24h 는 fatal24h 사용', () => {
    vi.mocked(errorLog.summarizeErrors).mockReturnValue({ recent24h: 50, fatal24h: 3, bySource: {}, lastAt: null });
    expect((callHeartbeat().body as { criticalErrors24h: number }).criticalErrors24h).toBe(3);
  });

  it('응답 본문에 민감 정보(토큰·키·종목코드·평단가) 0 건', () => {
    process.env.OPERATOR_TOKEN = 'super-secret-token';
    process.env.KIS_APP_KEY = 'PSxxxxxxxxxxxxxxxx';
    try {
      const res = callHeartbeat();
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('super-secret');
      expect(body).not.toContain('PSxxxx');
      expect(body).not.toMatch(/[A-Z]{2}\d{8}/); // 계좌번호 패턴
    } finally {
      delete process.env.OPERATOR_TOKEN;
      delete process.env.KIS_APP_KEY;
    }
  });

  it('at 필드는 ISO 8601 timestamp', () => {
    const res = callHeartbeat();
    const at = (res.body as { at: string }).at;
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Number.isFinite(Date.parse(at))).toBe(true);
  });
});
