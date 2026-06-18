// @responsibility ADR-0636 운영자 승인 영속 repo 회귀 — record/revoke/isApproved/list·atomic write·self-heal(부재/손상/형불일치→{}). 임시 filePath 격리.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadApprovals,
  recordApproval,
  revokeApproval,
  isApproved,
  getApproval,
  listApprovedLeverIds,
  __resetAutoActivationApprovalsForTests,
} from './autoActivationApprovalRepo.js';

// 실제 AUTO_ACTIVATION_APPROVAL_FILE 절대 무접촉 — 임시 파일 격리.
let TMP_FILE: string;

beforeEach(() => {
  TMP_FILE = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'adr0636-approval-')),
    'auto-activation-approval-test.json',
  );
});

afterEach(() => {
  __resetAutoActivationApprovalsForTests(TMP_FILE);
});

describe('autoActivationApprovalRepo — record/load', () => {
  it('record → load 에 leverId·approvedBy·approvedAt(ISO) 반영', () => {
    const entry = recordApproval('R6_TRIGGER_TRADEDATE_FRESHNESS_ADR0592', 'operator', TMP_FILE);
    expect(entry.approvedBy).toBe('operator');
    expect(() => new Date(entry.approvedAt).toISOString()).not.toThrow();
    expect(entry.approvedAt).toBe(new Date(entry.approvedAt).toISOString());

    const store = loadApprovals(TMP_FILE);
    expect(store['R6_TRIGGER_TRADEDATE_FRESHNESS_ADR0592'].approvedBy).toBe('operator');
  });

  it('record 멱등 upsert — 같은 leverId 재기록 시 approvedBy 갱신', () => {
    recordApproval('LEVER_A', 'operator', TMP_FILE);
    recordApproval('LEVER_A', 'admin', TMP_FILE);
    expect(loadApprovals(TMP_FILE)['LEVER_A'].approvedBy).toBe('admin');
    expect(listApprovedLeverIds(TMP_FILE)).toEqual(['LEVER_A']);
  });
});

describe('autoActivationApprovalRepo — isApproved / getApproval / list', () => {
  it('isApproved 는 존재 여부 boolean', () => {
    expect(isApproved('LEVER_X', TMP_FILE)).toBe(false);
    recordApproval('LEVER_X', 'operator', TMP_FILE);
    expect(isApproved('LEVER_X', TMP_FILE)).toBe(true);
  });

  it('getApproval — 미승인 undefined / 승인 entry', () => {
    expect(getApproval('LEVER_Y', TMP_FILE)).toBeUndefined();
    recordApproval('LEVER_Y', 'admin', TMP_FILE);
    expect(getApproval('LEVER_Y', TMP_FILE)?.approvedBy).toBe('admin');
  });

  it('listApprovedLeverIds — 다건', () => {
    recordApproval('A', 'operator', TMP_FILE);
    recordApproval('B', 'operator', TMP_FILE);
    expect(listApprovedLeverIds(TMP_FILE).sort()).toEqual(['A', 'B']);
  });
});

describe('autoActivationApprovalRepo — revoke', () => {
  it('revoke 존재 → true 반환 + store 제거', () => {
    recordApproval('LEVER_R', 'operator', TMP_FILE);
    expect(revokeApproval('LEVER_R', TMP_FILE)).toBe(true);
    expect(isApproved('LEVER_R', TMP_FILE)).toBe(false);
    expect(listApprovedLeverIds(TMP_FILE)).toEqual([]);
  });

  it('revoke 미존재 → false (no-op, 파일 무변경)', () => {
    recordApproval('KEEP', 'operator', TMP_FILE);
    expect(revokeApproval('NOPE', TMP_FILE)).toBe(false);
    expect(listApprovedLeverIds(TMP_FILE)).toEqual(['KEEP']);
  });
});

describe('autoActivationApprovalRepo — self-heal & atomic', () => {
  it('파일 부재 → 빈 {} (throw 0)', () => {
    expect(loadApprovals(TMP_FILE)).toEqual({});
    expect(listApprovedLeverIds(TMP_FILE)).toEqual([]);
  });

  it('손상 JSON → 빈 {} self-heal (throw 0)', () => {
    fs.writeFileSync(TMP_FILE, '{not valid json');
    expect(loadApprovals(TMP_FILE)).toEqual({});
  });

  it('형 불일치(배열) → 빈 {} self-heal', () => {
    fs.writeFileSync(TMP_FILE, JSON.stringify([1, 2, 3]));
    expect(loadApprovals(TMP_FILE)).toEqual({});
  });

  it('형 불일치(entry 필드 누락) → 빈 {} self-heal', () => {
    fs.writeFileSync(TMP_FILE, JSON.stringify({ X: { approvedAt: 'now' } }));
    expect(loadApprovals(TMP_FILE)).toEqual({});
  });

  it('atomic write — tmp 파일 잔존 0, 최종 파일만 존재', () => {
    recordApproval('A', 'operator', TMP_FILE);
    expect(fs.existsSync(TMP_FILE)).toBe(true);
    expect(fs.existsSync(`${TMP_FILE}.tmp`)).toBe(false);
  });
});
