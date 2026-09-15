// @responsibility Verify disclosure persistence survives restart without replacing corrupt records.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadPaperDisclosures, savePaperDisclosures } from './paperDisclosureRepo.js';
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
it('persists first-seen records atomically and preserves a damaged file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-disclosures-')); directories.push(dir);
  const ledger = loadPaperDisclosures(dir);
  ledger.records.push({ receiptNo: '20260915000001', corpCode: '00126380', corpName: '삼성전자', stockCode: '', market: 'Y',
    title: '공급계약체결', filedDate: '2026-09-15', firstSeenAt: '2026-09-16T00:00:00Z',
    symbol: '005930', linkedAt: '2026-09-16T00:00:00Z', linkMethod: 'NAME_KO_LOOKUP' });
  savePaperDisclosures(ledger, dir);
  expect(loadPaperDisclosures(dir)).toEqual(ledger);
  expect(fs.readdirSync(dir)).toEqual(['paper-disclosures.json']);
  const file = path.join(dir, 'paper-disclosures.json');
  fs.writeFileSync(file, '{corrupt');
  expect(() => savePaperDisclosures(ledger, dir)).toThrow();
  expect(fs.readFileSync(file, 'utf8')).toBe('{corrupt');
});
