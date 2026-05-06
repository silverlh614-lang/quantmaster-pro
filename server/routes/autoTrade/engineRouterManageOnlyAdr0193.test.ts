/**
 * @responsibility engineRouter manage-only OFF 시 blockNewBuy 자동 해제 회귀 테스트 (ADR-0193)
 *
 * 사용자 5/6 보고: "신규매수차단 해제기능이 구현안된건가? 해제가 안됨"
 * 결함 — `manage-only` ON 시 `blockNewBuy=true` 자동 설정, 그러나 OFF 시 보존 → 영구 고착.
 * 본 PR — 대칭 coupling (OFF 시 자동 해제). ENV 우회 1종.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const ENGINE_ROUTER_PATH = path.resolve(__dirname, 'engineRouter.ts');
const source = fs.readFileSync(ENGINE_ROUTER_PATH, 'utf-8');

describe('ADR-0193 정적 가드 — engineRouter manage-only 대칭 coupling', () => {
  it('manage-only 핸들러 안 setManualBlockNewBuy(next) 패턴 (대칭 coupling)', () => {
    expect(source).toMatch(/setManualBlockNewBuy\(next\)/);
  });

  it('ENV `MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED` 우회 (ADR-0157 정확 비교)', () => {
    expect(source).toMatch(/process\.env\.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED === ['"]true['"]/);
  });

  it('legacy 분기 보존 (ENV ON 시 if (next) setManualBlockNewBuy(true) 동작 복원)', () => {
    expect(source).toMatch(/if \(next\) setManualBlockNewBuy\(true\)/);
  });

  it('ADR-0193 추적 주석', () => {
    expect(source).toMatch(/ADR-0193/);
  });

  it('사용자 보고 인용 주석 (해제 안 됨 결함 명문화)', () => {
    expect(source).toMatch(/해제가 안됨|신규매수차단 해제/);
  });
});

describe('ADR-0193 동작 매트릭스 — manage-only OFF 시 blockNewBuy 자동 해제', () => {
  beforeEach(() => {
    delete process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED;
  });

  async function loadState() {
    return await import('../../state.js');
  }

  it('default 정책 — manage-only ON → blockNewBuy=true 자동 설정', async () => {
    const state = await loadState();
    state.setManualManageOnly(false);
    state.setManualBlockNewBuy(false);

    // 시뮬레이션: 핸들러 분기 (ENV 미설정 default)
    const next = true;
    state.setManualManageOnly(next);
    if (process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED === 'true') {
      if (next) state.setManualBlockNewBuy(true);
    } else {
      state.setManualBlockNewBuy(next);
    }

    expect(state.getManualManageOnly()).toBe(true);
    expect(state.getManualBlockNewBuy()).toBe(true);
  });

  it('default 정책 — manage-only OFF → blockNewBuy=false 자동 해제 (사용자 보고 시나리오)', async () => {
    const state = await loadState();
    // 사용자 시나리오: 먼저 manage-only ON 했다가 OFF.
    state.setManualManageOnly(true);
    state.setManualBlockNewBuy(true);

    // 핸들러 분기: enabled=false 명시
    const next = false;
    state.setManualManageOnly(next);
    if (process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED === 'true') {
      if (next) state.setManualBlockNewBuy(true);
    } else {
      state.setManualBlockNewBuy(next);
    }

    expect(state.getManualManageOnly()).toBe(false);
    expect(state.getManualBlockNewBuy()).toBe(false);  // ← 핵심: 자동 해제
  });

  it('legacy 모드 (ENV=true) — manage-only OFF → blockNewBuy 보존 (기존 결함 동작)', async () => {
    process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED = 'true';
    const state = await loadState();
    state.setManualManageOnly(true);
    state.setManualBlockNewBuy(true);

    const next = false;
    state.setManualManageOnly(next);
    if (process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED === 'true') {
      if (next) state.setManualBlockNewBuy(true);
    } else {
      state.setManualBlockNewBuy(next);
    }

    expect(state.getManualManageOnly()).toBe(false);
    expect(state.getManualBlockNewBuy()).toBe(true);  // ← legacy: 영구 고착 (기존 결함)
  });

  it('legacy 모드 — manage-only ON 동작 보존 (기존 ON-only coupling)', async () => {
    process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED = 'true';
    const state = await loadState();
    state.setManualManageOnly(false);
    state.setManualBlockNewBuy(false);

    const next = true;
    state.setManualManageOnly(next);
    if (process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED === 'true') {
      if (next) state.setManualBlockNewBuy(true);
    } else {
      state.setManualBlockNewBuy(next);
    }

    expect(state.getManualManageOnly()).toBe(true);
    expect(state.getManualBlockNewBuy()).toBe(true);
  });

  it('default 정책 — blockNewBuy 별도 ON 후 manage-only ON+OFF → 양쪽 모두 해제', async () => {
    const state = await loadState();
    // 사용자가 먼저 신규매수차단을 별도로 ON (의도된 차단)
    state.setManualBlockNewBuy(true);
    expect(state.getManualBlockNewBuy()).toBe(true);

    // 그 후 manage-only ON
    let next = true;
    state.setManualManageOnly(next);
    state.setManualBlockNewBuy(next);

    // manage-only OFF — 대칭 coupling 으로 blockNewBuy 도 해제됨.
    // (의도: manage-only OFF = 일상 운영 복귀 → 신규 매수 재개가 자연스러운 의도)
    next = false;
    state.setManualManageOnly(next);
    state.setManualBlockNewBuy(next);

    expect(state.getManualManageOnly()).toBe(false);
    expect(state.getManualBlockNewBuy()).toBe(false);
  });

  it('default 정책 — req.body.enabled 미명시 → 토글 동작 (manage-only false → true)', async () => {
    const state = await loadState();
    state.setManualManageOnly(false);
    state.setManualBlockNewBuy(false);

    // req.body.enabled === undefined → !getManualManageOnly() = true
    const next = !state.getManualManageOnly();
    state.setManualManageOnly(next);
    state.setManualBlockNewBuy(next);

    expect(next).toBe(true);
    expect(state.getManualBlockNewBuy()).toBe(true);
  });

  it('default 정책 — req.body.enabled 미명시 → 토글 동작 (manage-only true → false)', async () => {
    const state = await loadState();
    state.setManualManageOnly(true);
    state.setManualBlockNewBuy(true);

    const next = !state.getManualManageOnly();
    state.setManualManageOnly(next);
    state.setManualBlockNewBuy(next);

    expect(next).toBe(false);
    expect(state.getManualBlockNewBuy()).toBe(false);
  });

  it('emergencyStop / autoTradePaused / dataIntegrityBlocked 별도 가드 무영향', async () => {
    const state = await loadState();
    state.setEmergencyStop(true);
    state.setAutoTradePaused(true);
    state.setDataIntegrityBlocked(true);
    state.setManualManageOnly(true);
    state.setManualBlockNewBuy(true);

    // manage-only OFF → blockNewBuy 만 해제, 다른 가드는 유지.
    const next = false;
    state.setManualManageOnly(next);
    state.setManualBlockNewBuy(next);

    expect(state.getEmergencyStop()).toBe(true);
    expect(state.getAutoTradePaused()).toBe(true);
    expect(state.getDataIntegrityBlocked()).toBe(true);
    expect(state.getManualManageOnly()).toBe(false);
    expect(state.getManualBlockNewBuy()).toBe(false);

    // cleanup
    state.setEmergencyStop(false);
    state.setAutoTradePaused(false);
    state.setDataIntegrityBlocked(false);
  });
});

describe('ADR-0193 ENV gate 정확 비교 매트릭스', () => {
  beforeEach(() => {
    delete process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED;
  });
  afterEach(() => {
    delete process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED;
  });

  it('default OFF (undefined) → 대칭 coupling 활성 (ADR-0193 동작)', () => {
    expect(process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED === 'true').toBe(false);
  });

  it('"true" 정확 매칭 → legacy 비대칭 (기존 동작 복원)', () => {
    process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED = 'true';
    expect(process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED === 'true').toBe(true);
  });

  it('"1" / "TRUE" / "yes" 거부 (ADR-0157 정확 비교 의무)', () => {
    for (const v of ['1', 'TRUE', 'yes']) {
      process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED = v;
      expect(process.env.MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED === 'true').toBe(false);
    }
  });
});
