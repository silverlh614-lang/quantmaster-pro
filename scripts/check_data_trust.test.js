// @responsibility ADR-0114 check_data_trust.js 정적 검증 스크립트 회귀 테스트
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkDataTrust } from './check_data_trust.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function makeTmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-trust-test-'));
  fs.mkdirSync(path.join(dir, 'server', 'sub'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  return dir;
}

describe('check_data_trust — baseline', () => {
  it('현재 코드베이스 0건 위반 (회귀 가드)', () => {
    const violations = checkDataTrust(REPO_ROOT);
    expect(violations).toEqual([]);
  });
});

describe('check_data_trust — AI_PRICE_DIRECT_USE 패턴', () => {
  it('gemini.targetPrice 직접 사용 → 차단', () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, 'server', 'sub', 'bad.ts'),
      `const t = geminiResult.targetPrice;\n`,
    );
    const v = checkDataTrust(root);
    expect(v.length).toBeGreaterThan(0);
    expect(v.some((x) => x.kind === 'AI_PRICE_DIRECT_USE')).toBe(true);
  });

  it('aiResponse.priceKrw 직접 사용 → 차단', () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, 'src', 'bad.ts'),
      `const k = aiResponse.priceKrw;\n`,
    );
    const v = checkDataTrust(root);
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe('AI_PRICE_DIRECT_USE');
  });

  it('주석 안의 gemini.targetPrice → 차단 안 함', () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, 'server', 'sub', 'safe.ts'),
      `// gemini.targetPrice 는 사용 금지 (ADR-0114)\nconst x = 1;\n`,
    );
    const v = checkDataTrust(root);
    expect(v).toEqual([]);
  });

  it('블록 주석 안 패턴 → 차단 안 함', () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, 'server', 'sub', 'safe.ts'),
      `/* example: gemini.targetPrice */\nconst x = 1;\n`,
    );
    const v = checkDataTrust(root);
    expect(v).toEqual([]);
  });

  it('문자열 리터럴 안 패턴 → 차단 안 함', () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, 'server', 'sub', 'safe.ts'),
      `const msg = "사용 금지: gemini.targetPrice";\n`,
    );
    const v = checkDataTrust(root);
    expect(v).toEqual([]);
  });

  it('정상 코드 (TRUTH 출처) → 통과', () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, 'server', 'sub', 'good.ts'),
      `const t = kisQuote.currentPrice;\nconst stop = priceFromKis;\n`,
    );
    const v = checkDataTrust(root);
    expect(v).toEqual([]);
  });

  it('aiResult.targetPrice / geminiResult.stopLoss 같은 유사 변수 모두 차단', () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, 'server', 'sub', 'bad.ts'),
      `const a = aiResult.targetPrice;\nconst b = geminiResult.stopLoss;\n`,
    );
    const v = checkDataTrust(root);
    expect(v.length).toBe(2);
  });
});

describe('check_data_trust — LIVE_INDICATOR_PRICE 패턴', () => {
  it('placeKisOrder 인자에 yahooPrice → 차단', () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, 'server', 'sub', 'bad.ts'),
      `await placeKisOrder(code, name, yahooPrice, qty);\n`,
    );
    const v = checkDataTrust(root);
    expect(v.some((x) => x.kind === 'LIVE_INDICATOR_PRICE')).toBe(true);
  });

  it('placeKisSellOrder 인자에 naverPrice → 차단', () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, 'server', 'sub', 'bad.ts'),
      `await placeKisSellOrder(code, name, qty, 'STOP_LOSS', naverPrice);\n`,
    );
    const v = checkDataTrust(root);
    expect(v.some((x) => x.kind === 'LIVE_INDICATOR_PRICE')).toBe(true);
  });

  it('placeKisOrder 인자에 kisPrice → 통과', () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, 'server', 'sub', 'good.ts'),
      `await placeKisOrder(code, name, kisPrice, qty);\n`,
    );
    const v = checkDataTrust(root);
    expect(v).toEqual([]);
  });
});

describe('check_data_trust — 화이트리스트', () => {
  it('server/data/dataTrustLayer.ts 자체는 화이트리스트 (주석/예시 무관)', () => {
    const root = makeTmpRoot();
    fs.mkdirSync(path.join(root, 'server', 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'server', 'data', 'dataTrustLayer.ts'),
      `// 예시: gemini.targetPrice 는 위반\nconst x = aiResult.priceKrw;\n`,
    );
    const v = checkDataTrust(root);
    expect(v).toEqual([]);
  });

  it('docs/adr/ 디렉토리는 항상 통과', () => {
    const root = makeTmpRoot();
    fs.mkdirSync(path.join(root, 'docs', 'adr'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'docs', 'adr', '0114-test.md'),
      `예시 코드:\n  const t = gemini.targetPrice;\n`,
    );
    const v = checkDataTrust(root);
    expect(v).toEqual([]);
  });
});
