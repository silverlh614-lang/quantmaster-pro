// @responsibility ADR-0104 게이팅 알림 윈도우 가드 wiring 회귀 (정적 패턴)
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ADR-0104 — 게이팅 차단 알림(VIX/FOMC)은 KST 장시작/장마감 윈도우만 발송.
 * 본 회귀 테스트는 *정적 패턴 검증* — preflight.ts 의 게이팅 알림 호출 site 가
 * 모두 getGatingAlertSession() 가드를 통과하는지 확인.
 *
 * Audit-fix (2026-05-05): ADR-0147b (signalScanner Phase 3 분해, PR #523) 머지 후
 * 게이팅 알림 wiring 이 signalScanner.ts → signalScanner/preflight.ts 단일 위치로
 * 이주. 본 회귀 테스트의 grep 대상 경로를 새 위치로 정합 + signalScanner.ts 측은
 * drift 차단 (부재 단언) 으로 격하.
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
  it('signalScanner.ts — gatingAlertWindow 직접 import 부재 (분해 후 preflight 단일)', () => {
    const src = readFile('server/trading/signalScanner.ts');
    expect(src).not.toContain("from '../utils/gatingAlertWindow.js'");
  });

  it('preflight.ts 가 gatingAlertWindow import', () => {
    const src = readFile('server/trading/signalScanner/preflight.ts');
    expect(src).toContain("from '../../utils/gatingAlertWindow.js'");
    expect(src).toContain('getGatingAlertSession');
  });

  it('signalScanner.ts — VIX 게이팅 차단 알림 본체 부재 (preflight 위임)', () => {
    const src = readFile('server/trading/signalScanner.ts');
    expect(src).not.toContain('[VIX 게이팅] 신규 진입 차단');
  });

  it('signalScanner.ts — FOMC 게이팅 차단 알림 본체 부재 (preflight 위임)', () => {
    const src = readFile('server/trading/signalScanner.ts');
    expect(src).not.toContain('[FOMC 게이팅] 신규 진입 차단');
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

  it('preflight.ts 의 dedupeKey 에 :${session.toLowerCase()} suffix 사용', () => {
    const src = readFile('server/trading/signalScanner/preflight.ts');
    const vixIdx = src.indexOf('[VIX 게이팅] 신규 진입 차단');
    const vixBlock = src.slice(vixIdx, vixIdx + 700);
    expect(vixBlock, 'vix dedupeKey session suffix 부재').toContain(
      ':${session.toLowerCase()}',
    );
    expect(vixBlock).toContain('vix_gating_block:');

    const fomcIdx = src.indexOf('[FOMC 게이팅] 신규 진입 차단');
    const fomcBlock = src.slice(fomcIdx, fomcIdx + 700);
    expect(fomcBlock, 'fomc dedupeKey session suffix 부재').toContain(
      ':${session.toLowerCase()}',
    );
    expect(fomcBlock).toContain('fomc_gating_block:');
  });

  it('회귀 차단 — sendTelegramAlert 호출이 if (session) 블록 안에 위치 (preflight)', () => {
    // 본 가드는 사용자 보고 (14:30 KST 도배) 재발 차단 —
    // `[VIX 게이팅]` / `[FOMC 게이팅]` 라벨을 가진 sendTelegramAlert 호출이
    // session 검증 없이 직접 발송되면 fail.
    const src = readFile('server/trading/signalScanner/preflight.ts');
    const labels = ['[VIX 게이팅] 신규 진입 차단', '[FOMC 게이팅] 신규 진입 차단'];
    for (const label of labels) {
      const idx = src.indexOf(label);
      if (idx < 0) continue;
      const before = src.slice(Math.max(0, idx - 200), idx);
      expect(before, `preflight.ts ${label}: session 가드 누락`).toContain('if (session)');
    }
  });
});
