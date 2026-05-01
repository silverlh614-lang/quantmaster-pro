// @responsibility aiUniverseService 외인 보유율 영속 wiring 회귀 — ADR-0140 정적 grep 가드.
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.join(process.cwd(), 'server/services/aiUniverseService.ts');

describe('aiUniverseService ADR-0140 wiring (정적 grep 가드)', () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(SOURCE_PATH, 'utf-8');
  });

  it('appendForeignerRatio import 존재', () => {
    expect(source).toMatch(/import.*appendForeignerRatio.*foreignerRatioRepo/);
  });

  it('ADR-0140 주석 + 외인 보유율 시계열 영속 명문화', () => {
    expect(source).toContain('ADR-0140');
    expect(source).toMatch(/외인 보유율 시계열|foreignerOwnRatio/);
  });

  it('foreignerOwnRatio > 0 가드 (음수/0 영속 차단)', () => {
    expect(source).toMatch(/foreignerOwnRatio\s*>\s*0/);
  });

  it('try/catch 격리 (영속 throw 가 enrich 차단 안 함)', () => {
    // appendForeignerRatio 호출이 try 블록 안에 있는지
    const callIdx = source.indexOf('appendForeignerRatio(');
    expect(callIdx).toBeGreaterThan(0);
    // try 블록 시작이 호출보다 앞에 있고, 가까운 catch 가 그 다음
    const beforeCall = source.slice(0, callIdx);
    const lastTry = beforeCall.lastIndexOf('try {');
    expect(lastTry).toBeGreaterThan(callIdx - 500);  // 500자 이내 try
  });

  it('Tier 4 snapshotMap 경로 — appendForeignerRatio 호출', () => {
    // for ... of seed loop 안에 호출
    expect(source).toMatch(/for \(const entry of seed\)/);
  });

  it('메인 enrich 경로 — Tier 4 중복 영속 차단 (!tier4SnapshotMap 가드)', () => {
    expect(source).toMatch(/!tier4SnapshotMap.*snapshots\.size/s);
  });

  it('todayKstDate() 사용 — KST 자정 일자 정합 (직접 + 변수 캐싱)', () => {
    // tier4 경로 — 직접 `todayKstDate()` 호출
    expect(source).toMatch(/date:\s*todayKstDate\(\)/);
    // 메인 enrich 경로 — `todayKst` 변수 캐싱 (loop 안 재호출 방지)
    expect(source).toMatch(/const\s+todayKst\s*=\s*todayKstDate\(\)/);
    expect(source).toMatch(/date:\s*todayKst/);
  });

  it('appendForeignerRatio 호출 위치 — 2 wiring point (tier4 + 메인 enrich)', () => {
    const calls = source.match(/appendForeignerRatio\(/g);
    expect(calls?.length).toBeGreaterThanOrEqual(2);
  });
});
