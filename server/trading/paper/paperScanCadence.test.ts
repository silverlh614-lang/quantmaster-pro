// @responsibility Verify full-scan economy preserves trading sessions.
import { expect, it } from 'vitest';
import { paperScanIntervalMs } from './paperScanCadence.js';

it.each([
  ['2026-09-18T07:59:00+09:00', 30], ['2026-09-18T08:00:00+09:00', 10],
  ['2026-09-18T08:30:00+09:00', 10], ['2026-09-18T08:59:00+09:00', 10],
  ['2026-09-18T09:00:00+09:00', 2], ['2026-09-18T09:59:00+09:00', 2],
  ['2026-09-18T10:00:00+09:00', 5], ['2026-09-18T11:29:00+09:00', 5],
  ['2026-09-18T11:30:00+09:00', 10], ['2026-09-18T13:29:00+09:00', 10],
  ['2026-09-18T13:30:00+09:00', 5], ['2026-09-18T15:19:00+09:00', 5],
  ['2026-09-18T15:20:00+09:00', 10], ['2026-09-18T15:59:00+09:00', 10],
  ['2026-09-18T16:00:00+09:00', 30], ['2026-10-06T09:00:00+09:00', 2],
])('uses the expected interval at %s', (at, minutes) => {
  expect(paperScanIntervalMs(new Date(at))).toBe(minutes * 60_000);
});

it.each(['2026-10-03T10:00:00+09:00', '2026-10-04T10:00:00+09:00', '2026-10-05T10:00:00+09:00'])(
  'disables scheduled price scans on the KRX holiday %s', at => {
    expect(paperScanIntervalMs(new Date(at))).toBeNull();
  });
