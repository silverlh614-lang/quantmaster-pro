// @responsibility Patch-SNAPSHOT-LATEST-CMD-001 /snapshot_latest 회귀 — formatSnapshotLatestMessage SSOT + execute + 메타 + 정적 가드.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import type { RuntimeDebugSnapshot } from '../../../replay/runtimeDebugSnapshotRepo.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — 18 literal invariants TypeScript 컴파일 타임 강제 정합 통과.
// ─────────────────────────────────────────────────────────────────────────────

function makeMinimalSnapshot(overrides: Partial<RuntimeDebugSnapshot> = {}): RuntimeDebugSnapshot {
  const base: RuntimeDebugSnapshot = {
    snapshotId: 'snap-2026-05-15-18',
    capturedAt: '2026-05-15T09:00:00.000Z', // KST 18:00
    marketDate: '2026-05-15',
    captureKind: 'AFTER_HOURS_RUNTIME_DEBUG_SNAPSHOT',
    timezone: 'Asia/Seoul',
    source: 'RUNTIME_SNAPSHOT',
    captureTimeKst: '18:00',
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

describe('Patch-SNAPSHOT-LATEST-CMD-001: /snapshot_latest 명령', () => {
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
  // A. 명령 메타데이터 정합
  // ────────────────────────────────────────────────────────────────────────
  describe('A. 메타데이터 — name + aliases + category + visibility + riskLevel', () => {
    it('name=/snapshot_latest + 4 aliases + SYS + ADMIN + riskLevel=0', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      expect(mod.default.name).toBe('/snapshot_latest');
      expect(mod.default.aliases).toContain('/snap');
      expect(mod.default.aliases).toContain('/snap_latest');
      expect(mod.default.aliases).toContain('/snapshot');
      expect(mod.default.category).toBe('SYS');
      expect(mod.default.visibility).toBe('ADMIN');
      expect(mod.default.riskLevel).toBe(0); // read-only
    });

    it('formatSnapshotLatestMessage SSOT export', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      expect(typeof mod.formatSnapshotLatestMessage).toBe('function');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // B. barrel 등록
  // ────────────────────────────────────────────────────────────────────────
  describe('B. barrel index.ts 등록', () => {
    it('snapshotLatest.cmd.js import 등재 + Patch-SNAPSHOT-LATEST 추적 주석', () => {
      const src = fs.readFileSync(path.resolve(__dirname, 'index.ts'), 'utf-8');
      expect(src).toMatch(/import\s+['"]\.\/snapshotLatest\.cmd\.js['"]/);
      expect(src).toMatch(/Patch-SNAPSHOT-LATEST-CMD-001/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // C. null snapshot — 4 원인 안내
  // ────────────────────────────────────────────────────────────────────────
  describe('C. null snapshot — 부재 안내', () => {
    it('null 입력 시 4 원인 후보 모두 명시', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const msg = mod.formatSnapshotLatestMessage(null);
      expect(msg).toMatch(/부팅 직후/);
      expect(msg).toMatch(/cron 비활성/);
      expect(msg).toMatch(/RUNTIME_DEBUG_SNAPSHOT_DISABLED/);
      expect(msg).toMatch(/capture 실패/);
      expect(msg).toMatch(/PERSIST_FAILED|컨테이너 재시작|영속 손실/);
    });

    it('null 입력 시 운영자 확인 안내 (cron + ENV + 다음 평일 18:00)', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const msg = mod.formatSnapshotLatestMessage(null);
      expect(msg).toMatch(/\/cron_status/);
      expect(msg).toMatch(/runtime_debug_snapshot_capture/);
      expect(msg).toMatch(/18:00 KST/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // D. 정상 snapshot — invariants 항상 노출
  // ────────────────────────────────────────────────────────────────────────
  describe('D. 정상 snapshot — replayOnly=true + executionImpact=NONE 항상 노출', () => {
    it('invariants 라인에 replayOnly=true · executionImpact=NONE · INTRADAY_REPLAY_EQUIVALENT · providerCalls=0 모두 포함', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot();
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).toMatch(/replayOnly=true/);
      expect(msg).toMatch(/executionImpact=NONE/);
      expect(msg).toMatch(/INTRADAY_REPLAY_EQUIVALENT/);
      expect(msg).toMatch(/providerCalls=0/);
    });

    it('snapshotId / capturedAt KST / marketDate 노출', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot();
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).toMatch(/snap-2026-05-15-18/);
      expect(msg).toMatch(/05\/15 18:00 KST/); // capturedAt 2026-05-15T09:00 UTC = 18:00 KST
      expect(msg).toMatch(/2026-05-15/); // marketDate
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // E. PARTIAL 상태 + missing[] 렌더링
  // ────────────────────────────────────────────────────────────────────────
  describe('E. PARTIAL 상태 — missing + warnings 표시', () => {
    it('PARTIAL + missing 배열 + warnings 노출', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot({
        captureStatus: 'PARTIAL',
        missingSections: ['gate', 'supply'],
        warnings: ['scanSummary null', 'KIS provider degraded'],
      });
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).toMatch(/PARTIAL/);
      expect(msg).toMatch(/missing.*gate.*supply/);
      expect(msg).toMatch(/scanSummary null/);
    });

    it('OK 상태 — ✅ OK 노출', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot();
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).toMatch(/✅ OK/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // F. age 계산 — 분/시간/일 분기
  // ────────────────────────────────────────────────────────────────────────
  describe('F. age — 분/시간/일 분기 + clock skew 안전', () => {
    it('15분 전 — "(15분 전)" 표시', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot({ capturedAt: '2026-05-15T09:00:00.000Z' });
      const nowMs = Date.parse('2026-05-15T09:15:00.000Z');
      const msg = mod.formatSnapshotLatestMessage(snap, nowMs);
      expect(msg).toMatch(/\(15분 전\)/);
    });

    it('2시간 30분 전 — "(2시간 30분 전)" 표시', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot({ capturedAt: '2026-05-15T09:00:00.000Z' });
      const nowMs = Date.parse('2026-05-15T11:30:00.000Z');
      const msg = mod.formatSnapshotLatestMessage(snap, nowMs);
      expect(msg).toMatch(/\(2시간 30분 전\)/);
    });

    it('2일 전 — "(2일 ...)" 표시', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot({ capturedAt: '2026-05-13T09:00:00.000Z' });
      const nowMs = Date.parse('2026-05-15T09:00:00.000Z');
      const msg = mod.formatSnapshotLatestMessage(snap, nowMs);
      expect(msg).toMatch(/\(2일/);
    });

    it('미래 시각 (clock skew) — graceful fallback', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot({ capturedAt: '2026-05-15T10:00:00.000Z' });
      const nowMs = Date.parse('2026-05-15T09:00:00.000Z');
      const msg = mod.formatSnapshotLatestMessage(snap, nowMs);
      expect(msg).toMatch(/미래 시각/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // G. 9 source 압축 라인 — 옵셔널 블록 부재 시 미렌더
  // ────────────────────────────────────────────────────────────────────────
  describe('G. 9 source 압축 — 부재 블록 미렌더 (잡음 차단)', () => {
    it('runtime/universe/gate/supply 모두 표시', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot({
        runtime: { regime: 'R2_BULL', kellyMultiplier: 0.8, engineAlive: true },
        universe: { candidateCount: 49, watchlistCount: 30, sections: { MOMENTUM: 25, CATALYST: 5 } },
        gate: { gate1Pass: 0, gate2Pass: 0, blockers: [{ reason: 'TRUE_GATE1_REJECTION', count: 49 }] },
        supply: { selectedProvider: 'KIS_API', semanticAvailable: 30, rawInvestorRowAvailable: 46 },
      });
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).toMatch(/🔧 Runtime.*R2_BULL/);
      expect(msg).toMatch(/🌍 Universe.*candidates=49/);
      expect(msg).toMatch(/🚪 Gate.*G1=0/);
      expect(msg).toMatch(/💧 Supply.*KIS_API/);
    });

    it('runtime / universe 블록 부재 시 라인 미렌더', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot(); // 모든 옵셔널 블록 부재
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).not.toMatch(/🔧 Runtime/);
      expect(msg).not.toMatch(/🌍 Universe/);
      expect(msg).not.toMatch(/🚪 Gate/);
      expect(msg).not.toMatch(/💧 Supply/);
    });

    it('shadow / counterfactual / sectorEnergy 표시', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot({
        shadow: { openPositions: 3, todayCreated: 2, todayClosed: 0 },
        counterfactual: { recordedCount: 10, nearMissCount: 5 },
        sectorEnergy: { dataQuality: 'OK', validSectorCount: 12, sourceTier: 'KRX_CODE' },
      });
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).toMatch(/🌑 Shadow.*open=3/);
      expect(msg).toMatch(/🔮 Counterfactual.*recorded=10/);
      expect(msg).toMatch(/🎯 SectorEnergy.*quality=OK/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // H. frozenSupplyRows — Patch-002 카운트 + selectedProvider 분포
  // ────────────────────────────────────────────────────────────────────────
  describe('H. frozenSupplyRows — Patch-002 카운트 + provider 분포', () => {
    it('frozenSupplyRows 다중 provider — 카운트 + 분포 노출', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot({
        frozenSupplyRows: [
          {
            symbol: '005930',
            selectedProvider: 'KIS_API',
            status: 'VERIFIED',
            semanticSignal: 'BULLISH',
            rowAvailable: true,
            source: 'INVESTOR_FLOW_PROVIDER_ROUTER_ADR_0477',
          },
          {
            symbol: '000660',
            selectedProvider: 'KIS_API',
            status: 'VERIFIED',
            semanticSignal: 'NEUTRAL',
            rowAvailable: true,
            source: 'INVESTOR_FLOW_PROVIDER_ROUTER_ADR_0477',
          },
          {
            symbol: '035420',
            selectedProvider: 'KRX_OPENAPI',
            status: 'STALE_CACHE',
            semanticSignal: 'UNKNOWN',
            rowAvailable: false,
            source: 'INVESTOR_FLOW_PROVIDER_ROUTER_ADR_0477',
          },
        ],
      });
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).toMatch(/frozenSupplyRows: 3개/);
      expect(msg).toMatch(/KIS_API:2/);
      expect(msg).toMatch(/KRX_OPENAPI:1/);
    });

    it('frozenSupplyRows 부재 시 라인 미렌더', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot();
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).not.toMatch(/frozenSupplyRows/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // I. snapshotReplayAdapter — meta 표시
  // ────────────────────────────────────────────────────────────────────────
  describe('I. snapshotReplayAdapter — meta 표시 (Patch-002)', () => {
    it('replayAdapter 메타 + diagnosticOnly + liveExecutionAllowed 노출', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot({
        snapshotReplayAdapter: {
          adapterName: 'SNAPSHOT_INVESTOR_FLOW_REPLAY_ADAPTER',
          diagnosticOnly: true,
          liveExecutionAllowed: false,
          providerCalls: 0,
          kisCalls: 0,
          krxCalls: 0,
          yahooCalls: 0,
          naverCalls: 0,
          source: 'SNAPSHOT_REPLAY_ADAPTER',
        },
      });
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).toMatch(/Replay Adapter.*SNAPSHOT_INVESTOR_FLOW_REPLAY_ADAPTER/);
      expect(msg).toMatch(/diagnosticOnly=true/);
      expect(msg).toMatch(/liveExecutionAllowed=false/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // J. 사용법 안내 라인
  // ────────────────────────────────────────────────────────────────────────
  describe('J. 사용법 안내', () => {
    it('정상 snapshot 시 사용법 라인 포함', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot();
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).toMatch(/\/snapshot_latest/);
      expect(msg).toMatch(/\/snap/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // K. 정적 grep 가드 — KIS 주문 import 0 + autoTradeEngine import 0 + 외부 API 0
  // ────────────────────────────────────────────────────────────────────────
  describe('K. 정적 가드 — KIS 주문 / autoTradeEngine / 외부 API import 0건', () => {
    const rawSrc = fs.readFileSync(path.resolve(__dirname, 'snapshotLatest.cmd.ts'), 'utf-8');
    // 주석 strip — 라인 주석 + 블록 주석 모두 제거 후 코드 본체만 검사
    // (JSDoc 의 invariant 목록 단어 false-positive 차단)
    const codeOnly = rawSrc
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/^\s*\/\/.*$/gm, ''); // line comments

    it('KIS 주문 함수 5종 import 부재 (코드 본체)', () => {
      for (const p of [
        'placeKisMarketOrder',
        'placeKisSellOrder',
        'cancelKisOrder',
        'placeKisStopLossOrder',
        'placeKisTakeProfitOrder',
      ]) {
        expect(codeOnly).not.toContain(p);
      }
    });

    it('autoTradeEngine / orderExecutor / trancheExecutor import 부재 (코드 본체 — import 문)', () => {
      expect(codeOnly).not.toMatch(/from\s+['"].*autoTradeEngine/);
      expect(codeOnly).not.toMatch(/from\s+['"].*orderExecutor/);
      expect(codeOnly).not.toMatch(/from\s+['"].*trancheExecutor/);
      expect(codeOnly).not.toMatch(/from\s+['"].*signalScanner/);
      expect(codeOnly).not.toMatch(/from\s+['"].*entryEngine/);
      expect(codeOnly).not.toMatch(/from\s+['"].*exitEngine/);
    });

    it('외부 API 호출 0건 (fetch / axios / node-fetch import 부재)', () => {
      expect(codeOnly).not.toContain("from 'node-fetch'");
      expect(codeOnly).not.toContain("from 'axios'");
      expect(codeOnly).not.toMatch(/fetch\(/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // L. lifecycle invariant — "다음 거래일 09:00 개장 시 초기화 ❌"
  // ────────────────────────────────────────────────────────────────────────
  describe('L. lifecycle invariant — 사용자 명시 정합', () => {
    it('정상 snapshot 시 lifecycle 라인 포함 (다음 거래일 09:00 개장 초기화 ❌)', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot();
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).toMatch(/다음 거래일.*09:00.*초기화.*❌/);
      expect(msg).toMatch(/다음 평일 18:00 capture.*overwrite/);
    });

    it('retention 정책 — SINGLE_LATEST_OVERWRITE + sanitize=true + rawPayload=false', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const snap = makeMinimalSnapshot();
      const msg = mod.formatSnapshotLatestMessage(snap);
      expect(msg).toMatch(/SINGLE_LATEST_OVERWRITE/);
      expect(msg).toMatch(/sanitize=true/);
      expect(msg).toMatch(/rawPayload=false/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // M. execute() — read-only reply 1회
  // ────────────────────────────────────────────────────────────────────────
  describe('M. execute() — read-only reply 1회', () => {
    it('execute({reply}) 호출 시 reply 1회 (null 또는 정상)', async () => {
      const mod = await import('./snapshotLatest.cmd.js');
      const reply = vi.fn();
      await mod.default.execute({ args: [], reply });
      expect(reply).toHaveBeenCalledTimes(1);
      const sent = reply.mock.calls[0][0];
      // null 또는 정상 — 둘 다 'Snapshot' 키워드 포함
      expect(typeof sent).toBe('string');
      expect(sent).toMatch(/Snapshot/);
    });
  });
});
