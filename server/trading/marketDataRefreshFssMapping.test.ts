// @responsibility marketDataRefresh ADR-0142 wiring 회귀 — 정적 grep 가드.
// ENV gate default OFF + LIVE 매매 본체 0줄 변경 보장.
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.join(process.cwd(), 'server/trading/marketDataRefresh.ts');

describe('marketDataRefresh ADR-0142 wiring (정적 grep 가드)', () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(SOURCE_PATH, 'utf-8');
  });

  it('isFssMappingEnabled + mapPassiveActive import 존재', () => {
    expect(source).toMatch(/import.*isFssMappingEnabled.*mapPassiveActive.*fssMappingPolicy/);
  });

  it('upsertFssRecord import 존재', () => {
    expect(source).toMatch(/import.*upsertFssRecord.*fssRepo/);
  });

  it('ADR-0142 주석 + Stage 2 + ENV gate 명문화', () => {
    expect(source).toContain('ADR-0142');
    expect(source).toMatch(/Stage 2/);
    expect(source).toMatch(/default OFF/);
  });

  it('isFssMappingEnabled() 호출 — ENV gate', () => {
    expect(source).toMatch(/if\s*\(\s*isFssMappingEnabled\(\)\s*\)/);
  });

  it('upsertFssRecord 호출 — passive/active 영속', () => {
    expect(source).toMatch(/upsertFssRecord\(\s*\{[\s\S]{0,200}passiveNetBuy:/);
    expect(source).toMatch(/upsertFssRecord\(\s*\{[\s\S]{0,200}activeNetBuy:/);
  });

  it('try/catch 격리 (매핑 throw 차단 안 함)', () => {
    const callIdx = source.indexOf('mapPassiveActive(');
    expect(callIdx).toBeGreaterThan(0);
    const beforeCall = source.slice(0, callIdx);
    const lastTry = beforeCall.lastIndexOf('try {');
    expect(lastTry).toBeGreaterThan(callIdx - 500);
  });

  it('진단 로그 — passive/active/foreign 합산 노출', () => {
    expect(source).toMatch(/FSS 매핑 영속/);
    expect(source).toMatch(/passive=\$\{mapped\.passiveNetBuy/);
    expect(source).toMatch(/active=\$\{mapped\.activeNetBuy/);
  });

  it('⑥-d 섹션 위치 — Stage 1 (⑥-c) 다음, FRED (⑧) 이전', () => {
    const stage1Idx = source.indexOf('⑥-c ADR-0141');
    const stage2Idx = source.indexOf('ADR-0142');
    const fredIdx = source.indexOf('⑧ FRED');
    expect(stage1Idx).toBeGreaterThan(0);
    expect(stage2Idx).toBeGreaterThan(stage1Idx);
    expect(fredIdx).toBeGreaterThan(stage2Idx);
  });

  it('default OFF 회귀 가드 — `process.env.FSS_MAPPING_ENABLED !== "false"` 같은 잘못된 패턴 부재', () => {
    // 사용자 명시: default OFF. isFssMappingEnabled() helper 만 사용해야 함.
    // 직접 process.env.FSS_MAPPING_ENABLED 비교 시 default 의도 깨짐.
    expect(source).not.toMatch(/process\.env\.FSS_MAPPING_ENABLED\s*!==\s*['"]false['"]/);
    expect(source).not.toMatch(/process\.env\.FSS_MAPPING_ENABLED\s*\|\|/);
  });
});
