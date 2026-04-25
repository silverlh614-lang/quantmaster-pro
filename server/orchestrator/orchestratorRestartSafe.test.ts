/**
 * orchestratorRestartSafe.test.ts — Phase 2.3 회귀 테스트
 *
 * 시나리오: Railway 재배포로 프로세스가 재시작될 때, orchestrator-state.json 에
 * 저장된 handlerRanAt 이력이 새 프로세스에서도 그대로 읽혀 당일 동일 핸들러가
 * 두 번 실행되지 않는 것을 검증한다.
 *
 * 커버리지:
 *   1. markRan → 디스크 영속화 → 새 인스턴스 로드 → hasRan = true
 *   2. 같은 거래일 안에서 핸들러 이력이 유지된다
 *   3. 날짜 변경(KST 기준) 시 핸들러 이력이 자동 초기화된다
 *   4. 손상된 JSON 파일은 "첫 기동" 으로 폴백한다 (throw 없음)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('TradingDayOrchestrator — Railway 재시작 안전성 (Phase 2.3)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-restart-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    // 각 테스트마다 모듈 캐시 초기화 — DATA_DIR 이 process.env 기반 계산되므로
    // require 시점에만 결정되기 때문.
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  // 본 테스트는 vi.resetModules() 직후 tradingOrchestrator 의 무거운 import 체인
  // (signalScanner/webhookHandler/stockScreener/exitEngine 등 1,000줄+) 을 두 번
  // 로드하므로 전체 suite 와 함께 돌면 5s 디폴트 timeout 을 초과한다.
  it('markRan → 새 인스턴스 로드 시 같은 거래일이면 hasRan = true 유지', async () => {
    const mod = await import('./tradingOrchestrator.js');
    const { TradingDayOrchestrator } = mod;

    const o1 = new TradingDayOrchestrator();
    o1._testOnly_markRan('marketOpen');
    expect(o1._testOnly_hasRan('marketOpen')).toBe(true);

    // 파일에 저장되었는지 확인
    const stateFile = path.join(tmpDir, 'orchestrator-state.json');
    expect(fs.existsSync(stateFile)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(raw.handlerRanAt.marketOpen).toBeDefined();
    expect(typeof raw.handlerRanAt.marketOpen).toBe('string');

    // 새 프로세스 시뮬레이션 — 모듈 재로드해서 새 인스턴스 생성
    vi.resetModules();
    const mod2 = await import('./tradingOrchestrator.js');
    const o2 = new mod2.TradingDayOrchestrator();
    expect(o2._testOnly_hasRan('marketOpen')).toBe(true);
  }, 30_000);

  it('날짜가 바뀌면 hasRan 이 false 로 리셋 (handlerRanAt 초기화)', async () => {
    const mod = await import('./tradingOrchestrator.js');
    const { TradingDayOrchestrator } = mod;

    // 어제 날짜로 저장된 핸들러 이력을 강제로 기록
    const stateFile = path.join(tmpDir, 'orchestrator-state.json');
    const yesterday = new Date(Date.now() - 24 * 3_600_000 + 9 * 3_600_000)
      .toISOString().slice(0, 10);
    fs.writeFileSync(stateFile, JSON.stringify({
      currentState: 'PRE_MARKET',
      lastTransition: new Date().toISOString(),
      tradingDate: yesterday,
      handlerRanAt: { marketOpen: new Date().toISOString() },
      lastCalibratedMonth: '',
    }, null, 2));

    const o = new TradingDayOrchestrator();
    // 오늘 날짜 기준으로 조회 → 자동 리셋 발생
    expect(o._testOnly_hasRan('marketOpen')).toBe(false);
    expect(o._testOnly_getHandlerRanAt()).toEqual({});
  });

  it('손상된 orchestrator-state.json 은 "첫 기동" 으로 안전하게 폴백 (throw 없음)', async () => {
    const stateFile = path.join(tmpDir, 'orchestrator-state.json');
    fs.writeFileSync(stateFile, '{ not valid json');

    const mod = await import('./tradingOrchestrator.js');
    const o = new mod.TradingDayOrchestrator();
    // 손상된 파일 → 기본 상태로 복구 → 핸들러 이력 없음
    expect(o._testOnly_getHandlerRanAt()).toEqual({});
    // markRan 정상 작동 여부
    o._testOnly_markRan('openAuction');
    expect(o._testOnly_hasRan('openAuction')).toBe(true);
  });

  it('같은 거래일 안에서 여러 번 재로드해도 핸들러 이력이 누적 유지된다', async () => {
    const mod = await import('./tradingOrchestrator.js');
    const { TradingDayOrchestrator } = mod;

    const o1 = new TradingDayOrchestrator();
    o1._testOnly_markRan('openAuction');
    o1._testOnly_markRan('marketOpen');

    vi.resetModules();
    const mod2 = await import('./tradingOrchestrator.js');
    const o2 = new mod2.TradingDayOrchestrator();
    expect(o2._testOnly_hasRan('openAuction')).toBe(true);
    expect(o2._testOnly_hasRan('marketOpen')).toBe(true);
    expect(o2._testOnly_hasRan('dailyReport')).toBe(false);

    o2._testOnly_markRan('dailyReport');

    vi.resetModules();
    const mod3 = await import('./tradingOrchestrator.js');
    const o3 = new mod3.TradingDayOrchestrator();
    expect(o3._testOnly_hasRan('dailyReport')).toBe(true);
  });
});
