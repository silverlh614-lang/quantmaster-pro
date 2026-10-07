// @responsibility Persist isolated virtual accounts with atomic replacement.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaperAccountLedger } from '../../src/types/paperAccount.js';
import { DATA_DIR, ensureDataDir } from './paths.js';
import { assertPaperAccount } from '../trading/paper/paperAccountValidation.js';

export const PAPER_ACCOUNT_FILE = path.join(DATA_DIR, 'paper-virtual-account.json');
export function loadPaperAccount(): PaperAccountLedger | null {
  if (!fs.existsSync(PAPER_ACCOUNT_FILE)) return null;
  const value: unknown = JSON.parse(fs.readFileSync(PAPER_ACCOUNT_FILE, 'utf8'));
  assertPaperAccount(value);
  return value;
}
export function savePaperAccount(account: PaperAccountLedger): void {
  assertPaperAccount(account);
  // A corrupted or different account must never be silently reset by a later scan.
  const current = loadPaperAccount();
  if (current && (current.id !== account.id || current.startedAt !== account.startedAt
    || JSON.stringify(current.config) !== JSON.stringify(account.config))) throw new Error('기존 가상 계좌 교체 금지');
  if (current) {
    if (current.lastSnapshotAt && (!account.lastSnapshotAt || Date.parse(account.lastSnapshotAt) < Date.parse(current.lastSnapshotAt)))
      throw new Error('과거 계좌 상태 덮어쓰기 금지');
    if (JSON.stringify(account.controls.slice(0, current.controls.length)) !== JSON.stringify(current.controls)) throw new Error('계좌 제어 이력 변경 금지');
    if (JSON.stringify((account.selections ?? []).slice(0, current.selections?.length ?? 0)) !== JSON.stringify(current.selections ?? []))
      throw new Error('계좌 선택 기준 이력 변경 금지');
    if (current.risk && (!account.risk || current.risk.since !== account.risk.since
      || account.risk.observations < current.risk.observations || account.risk.peakEquity < current.risk.peakEquity
      || account.risk.maxDrawdownPct < current.risk.maxDrawdownPct || Date.parse(account.risk.updatedAt) < Date.parse(current.risk.updatedAt)))
      throw new Error('계좌 관측 위험 이력 변경 금지');
    for (let index = 0; index < current.orders.length; index++) {
      const prior = current.orders[index], next = account.orders[index];
      if (!next) throw new Error('주문 이력 삭제 금지');
      const stable = (order: typeof prior) => {
        const { status: _status, statusReason: _reason, updatedAt: _updated, fill: _fill, ...intent } = order;
        return intent;
      };
      if (JSON.stringify(stable(prior)) !== JSON.stringify(stable(next)) || prior.status !== 'PENDING' && JSON.stringify(prior) !== JSON.stringify(next))
        throw new Error('기존 주문·체결 변경 금지');
    }
  }
  if (account.orders.slice(current?.orders.length ?? 0).some(order => order.side === 'BUY' && order.status === 'FILLED' && !order.selectionId))
    throw new Error('신규 매수에 계좌 선택 기준 누락');
  ensureDataDir();
  const temporary = `${PAPER_ACCOUNT_FILE}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, JSON.stringify(account), 'utf8'); fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temporary, PAPER_ACCOUNT_FILE);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
