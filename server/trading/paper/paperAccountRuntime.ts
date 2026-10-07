// @responsibility Isolate virtual account processing from independent signal research.
import { randomUUID } from 'node:crypto';
import type { PaperAccountConfig } from '../../../src/types/paperAccount.js';
import type { PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyLedger } from '../../../src/types/paperStrategy.js';
import { loadPaperAccount, savePaperAccount } from '../../persistence/paperAccountRepo.js';
import { accountBalances, advancePaperAccount, buildPaperAccountView, createPaperAccount } from './paperAccount.js';

let lastError: string | undefined;
export function readVirtualAccount(now = new Date()) {
  return buildPaperAccountView(loadPaperAccount(), now.toISOString(), lastError);
}
export function startVirtualAccount(config: PaperAccountConfig, now = new Date()) {
  if (loadPaperAccount()) throw new Error('VIRTUAL_ACCOUNT_EXISTS: 이미 시작한 계좌가 있습니다.');
  const account = createPaperAccount(config, now.toISOString(), randomUUID());
  savePaperAccount(account); lastError = undefined;
  return buildPaperAccountView(account, now.toISOString());
}
export function pauseVirtualAccountBuys(id: string, paused: boolean, now = new Date()) {
  const account = loadPaperAccount();
  if (!account || account.id !== id) throw new Error('가상 계좌를 다시 조회하세요.');
  if (typeof paused !== 'boolean') throw new Error('신규 매수 정지 설정이 올바르지 않습니다.');
  if (account.buyPaused !== paused) {
    account.buyPaused = paused; account.controls.push({ at: now.toISOString(), buyPaused: paused }); savePaperAccount(account);
  }
  return buildPaperAccountView(account, now.toISOString(), lastError);
}
export function captureVirtualAccount(strategy: PaperStrategyLedger, snapshot: PaperSnapshot): void {
  try {
    const account = loadPaperAccount();
    if (!account) return;
    const next = advancePaperAccount(account, strategy, snapshot);
    if (next !== account) savePaperAccount(next);
    lastError = undefined;
  } catch (error) {
    lastError = `가상 계좌 처리 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error('[VirtualAccount]', lastError);
  }
}
export function virtualAccountHoldings(): Array<{ symbol: string; name: string }> {
  try {
    const account = loadPaperAccount();
    return account ? [...accountBalances(account).buys.values()].map(({ symbol, name }) => ({ symbol, name })) : [];
  } catch (error) {
    lastError = `가상 계좌 보유 조회 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error('[VirtualAccount]', lastError);
    return [];
  }
}
