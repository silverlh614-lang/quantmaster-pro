import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCorporateActionDriftMessage } from './entryPriceDrift.js';

const knownMojibakeTokens = [
  '?뵩',
  '?섏떖',
  '蹂댁',
  '遺꾪븷',
  '癰귣',
  '袁',
  '뤿',
  '�',
];

describe('entryPriceDrift telegram encoding', () => {
  it('renders corporate action guard messages without mojibake', () => {
    const message = buildCorporateActionDriftMessage({
      name: '피엠티',
      code: '147760',
      driftPctText: '99.6',
      oldEntry: 4745,
      currentPrice: 9470,
      mode: 'IMMUTABLE_REMOVE',
    });

    expect(message).toContain('[Corporate Action Guard - universe excluded]');
    expect(message).toContain('피엠티 (147760)');
    expect(message).toContain('entryPrice kept');
    for (const token of knownMojibakeTokens) {
      expect(message).not.toContain(token);
    }
  });

  it('keeps preflight telegram alert templates free of known mojibake fragments', () => {
    const source = readFileSync(
      join(process.cwd(), 'server/trading/signalScanner/preflight.ts'),
      'utf8',
    );
    const runtimeLines = source
      .split('\n')
      .filter(line =>
        line.includes('sendTelegramAlert') ||
        line.includes('console.log') ||
        line.includes('console.warn') ||
        line.includes('reason:') ||
        line.includes('notes:'),
      )
      .join('\n');

    for (const token of ['?좉퇋', '?곗씠', '?ワ툘', '蹂댁쑀', '鍮덇낀', '횞', '??equity', '??consumed']) {
      expect(runtimeLines).not.toContain(token);
    }
  });
});
