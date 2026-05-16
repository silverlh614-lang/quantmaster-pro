import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = join(process.cwd(), 'server');
const MAX_DIRECT_SEND_TELEGRAM_ALERT_CALLS = 218;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (extname(path) === '.ts' && !path.endsWith('.test.ts') && !path.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('ADR-0466 Telegram alert taxonomy guard', () => {
  it('prevents growth in unclassified sendTelegramAlert direct calls', () => {
    const count = walk(ROOT).reduce((sum, file) => {
      const source = stripComments(readFileSync(file, 'utf-8'));
      const matches = source.match(/\bsendTelegramAlert\s*\(/g);
      return sum + (matches?.length ?? 0);
    }, 0);

    expect(count).toBeLessThanOrEqual(MAX_DIRECT_SEND_TELEGRAM_ALERT_CALLS);
  });

  it('keeps semantic event router as the preferred new entrypoint', () => {
    const source = readFileSync(join(ROOT, 'alerts', 'telegramEventRouter.ts'), 'utf-8');
    expect(source).toContain('emitTelegramEvent');
    expect(source).toContain('routeTelegramEvent');
    expect(source).toContain('ACCOUNT_BALANCE');
    expect(source).toContain('sendPrivateAlert');
  });
});
