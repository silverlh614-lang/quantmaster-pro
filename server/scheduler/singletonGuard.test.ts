import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('scheduler singleton guard wiring', () => {
  it('contains singleton acquire/duplicate blocked logs', () => {
    const src = fs.readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(src).toContain('[SCHEDULER_SINGLETON_ACQUIRED] scheduler=RegimeMonitorScheduler');
    expect(src).toContain('[SCHEDULER_DUPLICATE_BLOCKED] scheduler=RegimeMonitorScheduler');
  });
});
