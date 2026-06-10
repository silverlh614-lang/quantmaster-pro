// @responsibility kisPrimaryFlag SSOT 회귀 — 의미론(미설정=ON) 단위검증 + 소비처 직접 env 비교 0건 정적 가드
/**
 * kisPrimaryFlag.test.ts — KIS_OHLCV_PRIMARY_ENABLED 해석 SSOT 회귀 (ADR-0561 정합 정정 patch).
 *
 * 1) 단위: 미설정/'true'/'false'/기타 문자열 의미론 고정 — 'false' 리터럴만 OFF(ADR-0157 정확 비교).
 * 2) 정적 grep 가드: server/·src/ 비테스트 .ts 전체에서 `process.env.KIS_OHLCV_PRIMARY_ENABLED`
 *    직접 참조는 SSOT 정의처(kisPrimaryFlag.ts) 1곳만 허용 — 소비처 비교 불일치 재발 차단.
 * 3) 6 소비처가 SSOT(isKisOhlcvPrimaryEnabled)를 import 함을 고정.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { isKisOhlcvPrimaryEnabled } from './kisPrimaryFlag.js';

const ORIG_FLAG = process.env.KIS_OHLCV_PRIMARY_ENABLED;

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..', '..'); // → 레포 루트

describe('kisPrimaryFlag.isKisOhlcvPrimaryEnabled — 의미론 SSOT (미설정=ON)', () => {
  beforeEach(() => {
    delete process.env.KIS_OHLCV_PRIMARY_ENABLED;
  });
  afterAll(() => {
    if (ORIG_FLAG === undefined) delete process.env.KIS_OHLCV_PRIMARY_ENABLED;
    else process.env.KIS_OHLCV_PRIMARY_ENABLED = ORIG_FLAG;
  });

  it('미설정(undefined) → true (default ON, KIS-first — .env.example 의미론 정합)', () => {
    expect(isKisOhlcvPrimaryEnabled()).toBe(true);
  });

  it("'true' → true (권고 운영 설정 — byte-equivalent)", () => {
    process.env.KIS_OHLCV_PRIMARY_ENABLED = 'true';
    expect(isKisOhlcvPrimaryEnabled()).toBe(true);
  });

  it("'false' → false (명시 롤백 1줄만 Yahoo-first 복귀)", () => {
    process.env.KIS_OHLCV_PRIMARY_ENABLED = 'false';
    expect(isKisOhlcvPrimaryEnabled()).toBe(false);
  });

  it("기타 문자열('FALSE'/'0'/''/'off') → true (ADR-0157 정확 비교 — 'false' 리터럴만 OFF)", () => {
    for (const v of ['FALSE', '0', '', 'off', ' false']) {
      process.env.KIS_OHLCV_PRIMARY_ENABLED = v;
      expect(isKisOhlcvPrimaryEnabled(), `value=${JSON.stringify(v)}`).toBe(true);
    }
  });
});

// ── 정적 grep 가드 — 직접 env 비교는 SSOT 정의처 1곳만 ─────────────────────────

const SSOT_FILE = 'server/clients/kisPrimaryFlag.ts';

/** 통일 대상 6 소비처(ROOT 상대, POSIX) — SSOT import 의무. */
const CONSUMERS = [
  'server/screener/adapters/technicalQuoteRouter.ts',
  'server/ai/prefetchedContext.ts',
  'server/trading/exitEngine/helpers/closeSeriesProvider.ts',
  'server/clients/koreanQuoteBridge.ts',
  'server/learning/lateWinEvaluator.ts',
  'server/learning/newsSupplyLogger.ts',
];

function walkTs(absDir: string, relDir: string, out: { abs: string; rel: string }[]): void {
  for (const name of readdirSync(absDir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const abs = join(absDir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) walkTs(abs, rel, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push({ abs, rel });
    }
  }
}

describe('kisPrimaryFlag 정적 가드 — 직접 env 비교 단일 정의처 고정', () => {
  it('server/·src/ 비테스트 .ts 에서 process.env.KIS_OHLCV_PRIMARY_ENABLED 직접 참조는 SSOT 1곳뿐이다', () => {
    const files: { abs: string; rel: string }[] = [];
    for (const root of ['server', 'src']) {
      walkTs(join(ROOT, root), root, files);
    }
    const offenders: string[] = [];
    for (const { abs, rel } of files) {
      const src = readFileSync(abs, 'utf-8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const t = lines[i].trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue; // 주석 언급 허용
        if (/process\.env\.KIS_OHLCV_PRIMARY_ENABLED/.test(lines[i])) {
          offenders.push(`${rel}:${i + 1}`);
        }
      }
    }
    const external = offenders.filter((o) => !o.startsWith(SSOT_FILE));
    expect(
      external,
      `직접 process.env.KIS_OHLCV_PRIMARY_ENABLED 참조는 ${SSOT_FILE} 1곳만 허용 — ` +
        `isKisOhlcvPrimaryEnabled() (clients/kisPrimaryFlag) 를 import 하라 (ADR-0561 정합 정정).`,
    ).toEqual([]);
    // 가드 자가검증 — SSOT 정의처 자체의 직접 참조가 사라지면(스캔 파손/파일 이동) 본 가드도 무력화되므로 FAIL.
    expect(offenders.length, 'SSOT 정의처 자체의 직접 참조는 존재해야 한다(가드 자가검증)').toBeGreaterThan(0);
  });

  it('6 소비처 전부 kisPrimaryFlag SSOT(isKisOhlcvPrimaryEnabled)를 import 한다', () => {
    for (const rel of CONSUMERS) {
      const src = readFileSync(join(ROOT, rel), 'utf-8');
      expect(/isKisOhlcvPrimaryEnabled/.test(src), `${rel} 는 SSOT 함수를 사용해야 한다`).toBe(true);
      // 동일 폴더 소비처(koreanQuoteBridge)는 './kisPrimaryFlag.js' 상대 import — 경로 prefix 불문.
      expect(
        /from\s+['"][^'"]*kisPrimaryFlag\.js['"]/.test(src),
        `${rel} 는 kisPrimaryFlag.js (clients SSOT) 에서 import 해야 한다`,
      ).toBe(true);
    }
  });
});
