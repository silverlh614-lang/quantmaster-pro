// @responsibility Patch-SNAPSHOT-STATUS-CMD-001 /snapshot_status 회귀 — formatSnapshotStatusMessage SSOT + 정적 가드.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import type { RuntimeDebugSnapshot } from '../../../replay/runtimeDebugSnapshotRepo.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeMinimalSnapshot(overrides: Partial<RuntimeDebugSnapshot> = {}): RuntimeDebugSnapshot {
  const base: RuntimeDebugSnapshot = {
    snapshotId: 'snap-2026-05-15-1530',
    capturedAt: '2026-05-15T06:30:00.000Z',
    marketDate: '2026-05-15',
    captureKind: 'AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT',
    timezone: 'Asia/Seoul',
    source: 'RUNTIME_SNAPSHOT',
    captureTimeKst: '15:30',
    schemaVersion: 2,
    replayOnly: true,
    diagnosticOnly: true,
    executionImpact: 'NONE',
    runtimeStateBasis: 'LATEST_INTRADAY_RUNTIME_STATE',
    sessionInterpretation: 'INTRADAY_REPLAY_EQUIVALENT',
    sellOnlySemanticApplied: false,
    priceSemantics: 'REFERENCE_ONLY_NOT_FOR_TRADE_DECISION',
    replayDecisionMode: 'FROZEN_RUNTIME_STATE',
    replayGuard: {
      replayMode: true,
      providerCallsAllowed: false,
      providerCalls: 0,
      kisCalls: 0,
      krxCalls: 0,
      yahooCalls: 0,
      naverCalls: 0,
    },
    retention: {
      model: 'SINGLE_LATEST_OVERWRITE',
      overwriteOnNextSuccessfulTradingDayCapture: true,
      preservePreviousOnCaptureFailure: true,
    },
    sanitize: {
      applied: true,
      rawPayloadStored: false,
      forbiddenFieldPatternsApplied: 15,
    },
    captureStatus: 'OK',
  };
  return { ...base, ...overrides } as RuntimeDebugSnapshot;
}

describe('Patch-SNAPSHOT-STATUS-CMD-001: /snapshot_status 명령', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../../commandRegistry.js', () => ({
      commandRegistry: { register: vi.fn() },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────────
  // A. 메타데이터
  // ────────────────────────────────────────────────────────────────────────
  describe('A. 메타데이터 — name + aliases + category + visibility + riskLevel', () => {
    it('name=/snapshot_status + 2 aliases + SYS + ADMIN + riskLevel=0', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      expect((mod as any).default).toBeUndefined(); // default export 없음 (commandRegistry self-register)
      // commandRegistry.register 가 호출됐는지 확인
      const reg = (await import('../../commandRegistry.js')).commandRegistry;
      expect(reg.register).toHaveBeenCalled();
      const args = (reg.register as any).mock.calls[0][0];
      expect(args.name).toBe('/snapshot_status');
      expect(args.aliases).toContain('/snap_status');
      expect(args.aliases).toContain('/ss');
      expect(args.category).toBe('SYS');
      expect(args.visibility).toBe('ADMIN');
      expect(args.riskLevel).toBe(0);
    });

    it('formatSnapshotStatusMessage SSOT export', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      expect(typeof mod.formatSnapshotStatusMessage).toBe('function');
    });

    it('computeNextCaptureKstMs SSOT export', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      expect(typeof mod.computeNextCaptureKstMs).toBe('function');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // B. barrel 등록
  // ────────────────────────────────────────────────────────────────────────
  describe('B. barrel index.ts 등록', () => {
    it('snapshotStatus.cmd.js import 등재 + Patch-SNAPSHOT-STATUS 추적 주석', () => {
      const src = fs.readFileSync(path.resolve(__dirname, 'index.ts'), 'utf-8');
      expect(src).toMatch(/import\s+['"]\.\/snapshotStatus\.cmd\.js['"]/);
      expect(src).toMatch(/Patch-SNAPSHOT-STATUS-CMD-001/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // C. ENV 비활성
  // ────────────────────────────────────────────────────────────────────────
  describe('C. ENV RUNTIME_DEBUG_SNAPSHOT_DISABLED — 비활성 표시', () => {
    it('envDisabled=true → ❌ 비활성 + 재활성 안내', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: true,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: false,
        snapshot: null,
        nowMs: Date.parse('2026-05-15T09:30:00.000Z'),
      });
      expect(msg).toMatch(/RUNTIME_DEBUG_SNAPSHOT_DISABLED\s*=\s*true.*❌|❌.*비활성/);
      expect(msg).toMatch(/=false.*재활성|재활성/);
    });

    it('envDisabled=false → ✅ 활성', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: false,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: false,
        snapshot: null,
        nowMs: Date.parse('2026-05-15T09:30:00.000Z'),
      });
      expect(msg).toMatch(/RUNTIME_DEBUG_SNAPSHOT_DISABLED\s*=\s*false.*✅|✅.*활성/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // D. 파일 부재 — 4 원인 안내
  // ────────────────────────────────────────────────────────────────────────
  describe('D. 파일 부재 — 4 원인 안내 (ENV / 부팅 직후 / 휴장일 / cron 실패)', () => {
    it('fileExists=false + envDisabled=false → 4 원인 모두 명시', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: false,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: false,
        snapshot: null,
        nowMs: Date.parse('2026-05-15T09:30:00.000Z'),
      });
      expect(msg).toMatch(/부팅 직후|첫 15:30/);
      expect(msg).toMatch(/컨테이너 재시작|영속 디렉토리/);
      expect(msg).toMatch(/휴장일|TRADING_DAY_ONLY/);
      expect(msg).toMatch(/cron 실패|\/cron_status/);
    });

    it('fileExists=false → ❌ 부재 표시', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: false,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: false,
        snapshot: null,
        nowMs: Date.parse('2026-05-15T09:30:00.000Z'),
      });
      expect(msg).toMatch(/❌ 부재/);
    });

    it('envDisabled=true 시 → 4 원인 분석 미렌더 (ENV 가 진짜 원인)', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: true,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: false,
        snapshot: null,
        nowMs: Date.parse('2026-05-15T09:30:00.000Z'),
      });
      expect(msg).not.toMatch(/파일 부재 원인 분석/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // E. 파일 존재 — mtime + size + age
  // ────────────────────────────────────────────────────────────────────────
  describe('E. 파일 존재 — mtime + size + age 표시', () => {
    it('mtimeMs + sizeBytes + 분 단위 age', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const captureMs = Date.parse('2026-05-15T06:30:00.000Z'); // 15:30 KST
      const nowMs = Date.parse('2026-05-15T06:45:00.000Z'); // 15분 후
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: false,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: true,
        fileMtimeMs: captureMs,
        fileSizeBytes: 12_345,
        snapshot: makeMinimalSnapshot(),
        nowMs,
      });
      expect(msg).toMatch(/✅ 존재/);
      expect(msg).toMatch(/12\.1 KB|12\.[0-9]+ KB/);
      expect(msg).toMatch(/05\/15 15:30 KST/);
      expect(msg).toMatch(/\(15분 전\)/);
    });

    it('2시간 30분 전', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const captureMs = Date.parse('2026-05-15T06:30:00.000Z');
      const nowMs = Date.parse('2026-05-15T09:00:00.000Z');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: false,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: true,
        fileMtimeMs: captureMs,
        fileSizeBytes: 1024,
        snapshot: makeMinimalSnapshot(),
        nowMs,
      });
      expect(msg).toMatch(/\(2시간 30분 전\)/);
    });

    it('2일 1시간 전', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const captureMs = Date.parse('2026-05-13T08:00:00.000Z');
      const nowMs = Date.parse('2026-05-15T09:00:00.000Z');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: false,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: true,
        fileMtimeMs: captureMs,
        fileSizeBytes: 1024,
        snapshot: makeMinimalSnapshot(),
        nowMs,
      });
      expect(msg).toMatch(/\(2일 1시간 전\)/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // F. Schema 유효성
  // ────────────────────────────────────────────────────────────────────────
  describe('F. Schema 유효성 — OK / PARTIAL / INVALID', () => {
    it('captureStatus=OK → ✅ OK', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: false,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: true,
        fileMtimeMs: Date.parse('2026-05-15T09:00:00.000Z'),
        fileSizeBytes: 1024,
        snapshot: makeMinimalSnapshot(),
        nowMs: Date.parse('2026-05-15T09:30:00.000Z'),
      });
      expect(msg).toMatch(/Schema:\s*✅ OK/);
    });

    it('captureStatus=PARTIAL + missingSections → ⚠️ PARTIAL', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: false,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: true,
        fileMtimeMs: Date.parse('2026-05-15T09:00:00.000Z'),
        fileSizeBytes: 1024,
        snapshot: makeMinimalSnapshot({
          captureStatus: 'PARTIAL',
          missingSections: ['gate', 'supply', 'sectorEnergy'],
        }),
        nowMs: Date.parse('2026-05-15T09:30:00.000Z'),
      });
      expect(msg).toMatch(/⚠️ PARTIAL/);
      expect(msg).toMatch(/3 sections missing/);
      expect(msg).toMatch(/gate.*supply.*sectorEnergy/);
    });

    it('fileExists=true + snapshot=null → ❌ INVALID', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: false,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: true,
        fileMtimeMs: Date.parse('2026-05-15T09:00:00.000Z'),
        fileSizeBytes: 1024,
        snapshot: null,
        nowMs: Date.parse('2026-05-15T09:30:00.000Z'),
      });
      expect(msg).toMatch(/❌ INVALID/);
      expect(msg).toMatch(/손상 JSON|schema 불일치/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // G. 다음 capture 시각 계산
  // ────────────────────────────────────────────────────────────────────────
  describe('G. computeNextCaptureKstMs — 다음 15:30 KST 평일', () => {
    it('월요일 09:00 KST → 같은 날 15:30 KST', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      // 2026-05-11 = 월요일, 00:00 UTC = 09:00 KST
      const monMorning = Date.parse('2026-05-11T00:00:00.000Z');
      const next = mod.computeNextCaptureKstMs(monMorning);
      const expected = Date.parse('2026-05-11T06:30:00.000Z'); // 15:30 KST 같은 날
      expect(next).toBe(expected);
    });

    it('월요일 19:00 KST → 다음 화요일 15:30 KST', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      // 2026-05-11 19:00 KST = 10:00 UTC
      const monEvening = Date.parse('2026-05-11T10:00:00.000Z');
      const next = mod.computeNextCaptureKstMs(monEvening);
      const expected = Date.parse('2026-05-12T06:30:00.000Z'); // 화요일 15:30 KST
      expect(next).toBe(expected);
    });

    it('금요일 19:00 KST → 다음 월요일 15:30 KST (주말 건너뜀)', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      // 2026-05-15 = 금요일, 10:00 UTC = 19:00 KST
      const friEvening = Date.parse('2026-05-15T10:00:00.000Z');
      const next = mod.computeNextCaptureKstMs(friEvening);
      const expected = Date.parse('2026-05-18T06:30:00.000Z'); // 월요일 15:30 KST
      expect(next).toBe(expected);
    });

    it('토요일 12:00 KST → 다음 월요일 15:30 KST', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      // 2026-05-16 = 토요일, 03:00 UTC = 12:00 KST
      const satNoon = Date.parse('2026-05-16T03:00:00.000Z');
      const next = mod.computeNextCaptureKstMs(satNoon);
      const expected = Date.parse('2026-05-18T06:30:00.000Z'); // 월요일 15:30 KST
      expect(next).toBe(expected);
    });

    it('일요일 22:00 KST → 다음 월요일 15:30 KST', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      // 2026-05-17 = 일요일, 13:00 UTC = 22:00 KST
      const sunNight = Date.parse('2026-05-17T13:00:00.000Z');
      const next = mod.computeNextCaptureKstMs(sunNight);
      const expected = Date.parse('2026-05-18T06:30:00.000Z'); // 월요일 15:30 KST
      expect(next).toBe(expected);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // H. invariants 항상 노출
  // ────────────────────────────────────────────────────────────────────────
  describe('H. 절대 invariants 항상 노출 (운영자 인지 의무)', () => {
    it('파일 부재 시에도 invariants 노출', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: false,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: false,
        snapshot: null,
        nowMs: Date.parse('2026-05-15T09:30:00.000Z'),
      });
      expect(msg).toMatch(/replayOnly=true/);
      expect(msg).toMatch(/executionImpact=NONE/);
      expect(msg).toMatch(/providerCalls=0/);
      expect(msg).toMatch(/SINGLE_LATEST_OVERWRITE/);
    });

    it('lifecycle invariant — "다음 거래일 09:00 개장 시 초기화 ❌"', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: false,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: true,
        fileMtimeMs: Date.parse('2026-05-15T09:00:00.000Z'),
        fileSizeBytes: 1024,
        snapshot: makeMinimalSnapshot(),
        nowMs: Date.parse('2026-05-15T09:30:00.000Z'),
      });
      expect(msg).toMatch(/09:00 개장 시 초기화\s*❌/);
      expect(msg).toMatch(/15:30 capture overwrite/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // I. 사용법 hint
  // ────────────────────────────────────────────────────────────────────────
  describe('I. 사용법 hint — aliases 안내', () => {
    it('사용법 라인 + alias 모두 표시 + 관련 명령 안내', async () => {
      const mod = await import('./snapshotStatus.cmd.js');
      const msg = mod.formatSnapshotStatusMessage({
        envDisabled: false,
        filePath: '/data/replay/latest-runtime-debug-snapshot.json',
        fileExists: false,
        snapshot: null,
        nowMs: Date.parse('2026-05-15T09:30:00.000Z'),
      });
      expect(msg).toMatch(/\/snapshot_status/);
      expect(msg).toMatch(/\/snap_status/);
      expect(msg).toMatch(/\/ss/);
      expect(msg).toMatch(/\/snapshot_latest/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // J. 정적 grep 가드 — 안전 invariants 컴파일 타임 보장
  // ────────────────────────────────────────────────────────────────────────
  describe('J. 정적 grep 가드 — KIS/autoTradeEngine/외부 fetch import 0건', () => {
    it('KIS 주문 함수 5종 import 0건', () => {
      const src = fs.readFileSync(path.resolve(__dirname, 'snapshotStatus.cmd.ts'), 'utf-8');
      const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(codeOnly).not.toMatch(/from\s+['"][^'"]*placeKisMarketOrder/);
      expect(codeOnly).not.toMatch(/from\s+['"][^'"]*placeKisSellOrder/);
      expect(codeOnly).not.toMatch(/from\s+['"][^'"]*placeKisStopLossOrder/);
      expect(codeOnly).not.toMatch(/from\s+['"][^'"]*placeKisTakeProfitOrder/);
      expect(codeOnly).not.toMatch(/from\s+['"][^'"]*cancelKisOrder/);
    });

    it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
      const src = fs.readFileSync(path.resolve(__dirname, 'snapshotStatus.cmd.ts'), 'utf-8');
      const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(codeOnly).not.toMatch(/from\s+['"][^'"]*autoTradeEngine/);
      expect(codeOnly).not.toMatch(/from\s+['"][^'"]*orderExecutor/);
      expect(codeOnly).not.toMatch(/from\s+['"][^'"]*trancheExecutor/);
    });

    it('외부 fetch / axios / node-fetch import 0건', () => {
      const src = fs.readFileSync(path.resolve(__dirname, 'snapshotStatus.cmd.ts'), 'utf-8');
      const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(codeOnly).not.toMatch(/from\s+['"]node-fetch['"]/);
      expect(codeOnly).not.toMatch(/from\s+['"]axios['"]/);
      // fetch 자체 함수 호출도 0건
      expect(codeOnly).not.toMatch(/\bfetch\s*\(/);
    });

    it('ENV 정확 비교 (`=== \'true\'`) SSOT 위임 — 호출자 측 inline 검사 0건', () => {
      const src = fs.readFileSync(path.resolve(__dirname, 'snapshotStatus.cmd.ts'), 'utf-8');
      const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // process.env.RUNTIME_DEBUG_SNAPSHOT_DISABLED 직접 검사 부재 (SSOT 위임)
      expect(codeOnly).not.toMatch(/process\.env\.RUNTIME_DEBUG_SNAPSHOT_DISABLED/);
      // isRuntimeDebugSnapshotCaptureDisabled SSOT import 보유
      expect(codeOnly).toMatch(/isRuntimeDebugSnapshotCaptureDisabled/);
    });

    it('Patch-SNAPSHOT-STATUS-CMD-001 추적 주석 보유', () => {
      const src = fs.readFileSync(path.resolve(__dirname, 'snapshotStatus.cmd.ts'), 'utf-8');
      expect(src).toMatch(/Patch-SNAPSHOT-STATUS-CMD-001/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // K. execute() reply 호출 + 빈 인자 무시
  // ────────────────────────────────────────────────────────────────────────
  describe('K. execute() — reply 호출 + 인자 무관', () => {
    it('execute() 가 reply 를 1회 호출', async () => {
      vi.doMock('node:fs', () => {
        const stub = {
          statSync: () => {
            throw new Error('ENOENT');
          },
          readFileSync: () => '',
          existsSync: () => false,
          mkdirSync: () => undefined,
          writeFileSync: () => undefined,
          renameSync: () => undefined,
          unlinkSync: () => undefined,
        };
        return { default: stub, ...stub };
      });

      // commandRegistry mock 으로 captured command 추출
      const reg = (await import('../../commandRegistry.js')).commandRegistry;
      await import('./snapshotStatus.cmd.js');
      const args = (reg.register as any).mock.calls[0][0];

      const replyMock = vi.fn(async () => {
        return undefined;
      });
      await args.execute({ args: [], reply: replyMock });
      expect(replyMock).toHaveBeenCalledTimes(1);
    });

    it('execute() 빈 args 무시 (인자 불필요)', async () => {
      vi.doMock('node:fs', () => {
        const stub = {
          statSync: () => {
            throw new Error('ENOENT');
          },
          readFileSync: () => '',
          existsSync: () => false,
          mkdirSync: () => undefined,
          writeFileSync: () => undefined,
          renameSync: () => undefined,
          unlinkSync: () => undefined,
        };
        return { default: stub, ...stub };
      });

      const reg = (await import('../../commandRegistry.js')).commandRegistry;
      await import('./snapshotStatus.cmd.js');
      const args = (reg.register as any).mock.calls[0][0];

      const replyMock = vi.fn(async () => undefined);
      // 인자 전달해도 동일 결과
      await args.execute({ args: ['extra', 'arg'], reply: replyMock });
      expect(replyMock).toHaveBeenCalledTimes(1);
    });
  });
});
