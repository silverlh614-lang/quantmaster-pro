// @responsibility ADR-0104 게이팅 알림 윈도우 가드 wiring 회귀 (정적 패턴)
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ADR-0104 — 게이팅 차단 알림(VIX/FOMC)은 KST 장시작/장마감 윈도우만 발송.
 * 본 회귀 테스트는 *정적 패턴 검증* — signalScanner.ts + preflight.ts 의 4 알림
 * 호출 site 가 모두 getGatingAlertSession() 가드를 통과하는지 확인.
 *
 * 사용자 보고 시나리오 (4/29 FOMC DAY 14:30 KST = 베이징 13:30):
 *   - 14:30 KST → getGatingAlertSession() = null → 발송 차단
 *   - 09:30 KST → 'OPEN' → 발송 (open dedupeKey 1회)
 *   - 15:30 KST → 'CLOSE' → 발송 (close dedupeKey 1회)
 */
function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
}

describe('ADR-0104 — 게이팅 알림 윈도우 가드 wiring', () => {
  it('signalScanner.ts 가 gatingAlertWindow import', () => {
    const src = readFile('server/trading/signalScanner.ts');
    expect(src).toContain("from '../utils/gatingAlertWindow.js'");
    expect(src).toContain('getGatingAlertSession');
  });

  it('preflight.ts 가 gatingAlertWindow import', () => {
    const src = readFile('server/trading/signalScanner/preflight.ts');
    expect(src).toContain("from '../../utils/gatingAlertWindow.js'");
    expect(src).toContain('getGatingAlertSession');
  });

  it('signalScanner.ts VIX 게이팅 차단 알림이 session 가드 통과', () => {
    const src = readFile('server/trading/signalScanner.ts');
    const vixIdx = src.indexOf('[VIX 게이팅] 신규 진입 차단');
    expect(vixIdx).toBeGreaterThan(0);
    // 알림 본문 직전에 getGatingAlertSession 호출 + if (session) 가드
    // 우리는 본문 *위* 범위 안에 패턴이 있는지 검증
    const guardBlock = src.slice(Math.max(0, vixIdx - 300), vixIdx);
    expect(guardBlock).toContain('getGatingAlertSession');
    expect(guardBlock).toContain('if (session)');
  });

  it('signalScanner.ts FOMC 게이팅 차단 알림이 session 가드 통과', () => {
    const src = readFile('server/trading/signalScanner.ts');
    const fomcIdx = src.indexOf('[FOMC 게이팅] 신규 진입 차단');
    expect(fomcIdx).toBeGreaterThan(0);
    const guardBlock = src.slice(Math.max(0, fomcIdx - 300), fomcIdx);
    expect(guardBlock).toContain('getGatingAlertSession');
    expect(guardBlock).toContain('if (session)');
  });

  it('preflight.ts VIX 게이팅 차단 알림이 session 가드 통과', () => {
    const src = readFile('server/trading/signalScanner/preflight.ts');
    const vixIdx = src.indexOf('[VIX 게이팅] 신규 진입 차단');
    expect(vixIdx).toBeGreaterThan(0);
    const guardBlock = src.slice(Math.max(0, vixIdx - 300), vixIdx);
    expect(guardBlock).toContain('getGatingAlertSession');
    expect(guardBlock).toContain('if (session)');
  });

  it('preflight.ts FOMC 게이팅 차단 알림이 session 가드 통과', () => {
    const src = readFile('server/trading/signalScanner/preflight.ts');
    const fomcIdx = src.indexOf('[FOMC 게이팅] 신규 진입 차단');
    expect(fomcIdx).toBeGreaterThan(0);
    const guardBlock = src.slice(Math.max(0, fomcIdx - 300), fomcIdx);
    expect(guardBlock).toContain('getGatingAlertSession');
    expect(guardBlock).toContain('if (session)');
  });

  it('4 site 모두 dedupeKey 에 :${session.toLowerCase()} suffix 사용', () => {
    const files = ['server/trading/signalScanner.ts', 'server/trading/signalScanner/preflight.ts'];
    for (const file of files) {
      const src = readFile(file);
      // VIX 알림 블록 (라벨 + 700자) 안에 session.toLowerCase() suffix 존재
      const vixIdx = src.indexOf('[VIX 게이팅] 신규 진입 차단');
      const vixBlock = src.slice(vixIdx, vixIdx + 700);
      expect(vixBlock, `${file}: vix dedupeKey session suffix 부재`).toContain(
        ':${session.toLowerCase()}',
      );
      expect(vixBlock).toContain('vix_gating_block:');

      const fomcIdx = src.indexOf('[FOMC 게이팅] 신규 진입 차단');
      const fomcBlock = src.slice(fomcIdx, fomcIdx + 700);
      expect(fomcBlock, `${file}: fomc dedupeKey session suffix 부재`).toContain(
        ':${session.toLowerCase()}',
      );
      expect(fomcBlock).toContain('fomc_gating_block:');
    }
  });

  it('회귀 차단 — sendTelegramAlert 호출이 if (session) 블록 안에 위치', () => {
    // 본 가드는 사용자 보고 (14:30 KST 도배) 재발 차단 —
    // `[VIX 게이팅]` / `[FOMC 게이팅]` 라벨을 가진 sendTelegramAlert 호출이
    // session 검증 없이 직접 발송되면 fail.
    const files = ['server/trading/signalScanner.ts', 'server/trading/signalScanner/preflight.ts'];
    const labels = ['[VIX 게이팅] 신규 진입 차단', '[FOMC 게이팅] 신규 진입 차단'];
    for (const file of files) {
      const src = readFile(file);
      for (const label of labels) {
        const idx = src.indexOf(label);
        if (idx < 0) continue;
        // 라벨 직전 200자 안에 'if (session)' 존재해야 함
        const before = src.slice(Math.max(0, idx - 200), idx);
        expect(before, `${file} ${label}: session 가드 누락`).toContain('if (session)');
      }
    }
  });
});
