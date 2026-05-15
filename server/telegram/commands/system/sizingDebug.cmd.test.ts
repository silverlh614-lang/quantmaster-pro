// @responsibility PATCH-010 /sizing_debug 텔레그램 명령 회귀 — formatSizingDebugMessage SSOT + execute + 메타 + 정적 가드
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

describe('PATCH-010: /sizing_debug 명령', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../../commandRegistry.js', () => ({
      commandRegistry: { register: vi.fn() },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('정적 가드 — 명령 메타데이터 + barrel 등록', () => {
    it('명령 메타데이터 정합 — name + alias + category + visibility + riskLevel', async () => {
      const mod = await import('./sizingDebug.cmd.js');
      expect(mod.default.name).toBe('/sizing_debug');
      expect(mod.default.aliases).toContain('/sd');
      expect(mod.default.category).toBe('SYS');
      expect(mod.default.visibility).toBe('ADMIN');
      expect(mod.default.riskLevel).toBe(0); // read-only
    });

    it('barrel index.ts 에 sizingDebug 등록', () => {
      const src = fs.readFileSync(path.resolve(__dirname, 'index.ts'), 'utf-8');
      expect(src).toMatch(/import\s+'\.\/sizingDebug\.cmd\.js'/);
      expect(src).toMatch(/PATCH-010/);
    });

    it('formatSizingDebugMessage SSOT export', async () => {
      const mod = await import('./sizingDebug.cmd.js');
      expect(typeof mod.formatSizingDebugMessage).toBe('function');
    });
  });

  describe('formatSizingDebugMessage — ENV 인자 주입 순수 함수', () => {
    it('ENV 상태 — floorEnabled / accurateExposureEnabled true 표시', async () => {
      const mod = await import('./sizingDebug.cmd.js');
      const msg = mod.formatSizingDebugMessage({ floorEnabled: true, accurateExposureEnabled: true });
      expect(msg).toMatch(/SHADOW_BULL_EXPOSURE_FLOOR_ENABLED: true/);
      expect(msg).toMatch(/POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED: true/);
    });

    it('ENV 상태 — floorEnabled / accurateExposureEnabled false 표시', async () => {
      const mod = await import('./sizingDebug.cmd.js');
      const msg = mod.formatSizingDebugMessage({ floorEnabled: false, accurateExposureEnabled: false });
      expect(msg).toMatch(/SHADOW_BULL_EXPOSURE_FLOOR_ENABLED: false/);
      expect(msg).toMatch(/POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED: false/);
    });

    it('SHADOW 프로파일 매트릭스 — 7 레짐 모두 노출 + R5_BULL floor 2.00%', () => {
      // 동기 import 회피 — formatSizingDebugMessage 는 process.env 미참조이므로 ENV 무관.
      return import('./sizingDebug.cmd.js').then((mod) => {
        const msg = mod.formatSizingDebugMessage({ floorEnabled: true, accurateExposureEnabled: false });
        for (const r of ['R6_STRONG_BULL', 'R5_BULL', 'R4_RECOVERY', 'R3_NEUTRAL', 'R2_WEAK', 'R1_DEFENSIVE', 'R0_CRISIS']) {
          expect(msg).toContain(r);
        }
        // SHADOW R5_BULL: floor 2.00%
        expect(msg).toMatch(/R5_BULL\s+target\s+85%\s+·\s+floor\s+2\.00%/);
      });
    });

    it('LIVE 프로파일 매트릭스 — floor 전면 0.00%', async () => {
      const mod = await import('./sizingDebug.cmd.js');
      const msg = mod.formatSizingDebugMessage({ floorEnabled: true, accurateExposureEnabled: false });
      const liveSection = msg.slice(msg.indexOf('LIVE 프로파일'));
      // LIVE 섹션의 모든 레짐 라인 floor 0.00%
      expect(liveSection).toMatch(/R6_STRONG_BULL\s+target\s+85%\s+·\s+floor\s+0\.00%/);
      expect(liveSection).toMatch(/R5_BULL\s+target\s+75%\s+·\s+floor\s+0\.00%/);
      expect(liveSection).not.toMatch(/floor\s+[1-9]/); // LIVE 섹션에 0이 아닌 floor 없음
    });

    it('minNotional 보정 설정 — MIN_CANDIDATE_SHARES / ceiling ratio 노출', async () => {
      const mod = await import('./sizingDebug.cmd.js');
      const msg = mod.formatSizingDebugMessage({ floorEnabled: false, accurateExposureEnabled: false });
      expect(msg).toMatch(/MIN_CANDIDATE_SHARES: 1/);
      expect(msg).toMatch(/MIN_NOTIONAL_PRICE_CEILING_RATIO: 5%/);
    });

    it('진단 전용 안내 — 사이징 경로 wiring 후속 PR scope 명시', async () => {
      const mod = await import('./sizingDebug.cmd.js');
      const msg = mod.formatSizingDebugMessage({ floorEnabled: false, accurateExposureEnabled: false });
      expect(msg).toMatch(/진단 전용/);
      expect(msg).toMatch(/후속 PR scope/);
    });
  });

  describe('execute() 핸들러 — read-only', () => {
    it('정상 메시지 reply 호출', async () => {
      const mod = await import('./sizingDebug.cmd.js');
      const reply = vi.fn();
      await mod.default.execute({ args: [], reply });
      expect(reply).toHaveBeenCalledTimes(1);
      const sent = reply.mock.calls[0][0];
      expect(sent).toMatch(/Sizing Debug/);
      expect(sent).toMatch(/SHADOW 프로파일/);
    });
  });

  describe('정적 가드 — KIS 주문 함수 import 0건 + 영속 write 0건', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'sizingDebug.cmd.ts'), 'utf-8');

    it('KIS 주문 함수 5종 import 부재 (read-only 정합)', () => {
      for (const p of [
        'placeKisMarketOrder',
        'placeKisSellOrder',
        'cancelKisOrder',
        'placeKisStopLossOrder',
        'placeKisTakeProfitOrder',
      ]) {
        expect(src).not.toContain(p);
      }
    });

    it('영속 write / 외부 API 호출 0건 (saveMacroState / fetch / axios 부재)', () => {
      expect(src).not.toContain('saveMacroState');
      expect(src).not.toContain('fetch(');
      expect(src).not.toContain('axios');
      expect(src).not.toContain('node-fetch');
    });
  });
});
