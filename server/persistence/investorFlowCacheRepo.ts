/**
 * @responsibility 기관/외인 수급 cache 저장소.
 *
 * PR-585: investor-flow policy router 의 CACHE provider 를 실제 파일 cache 로 연결한다.
 * 이 repo 는 실데이터 검증을 통과한 KRX/Naver/manual backfill row 만 신뢰한다.
 * KIS diagnostic / provider-mismatch / accepted-empty 결과는 저장 대상이 아니다.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './paths.js';
import type { InvestorFlowSample } from '../supply/investorFlowRouter.js';

export const INVESTOR_FLOW_CACHE_FILE = path.join(DATA_DIR, 'investor-flow-cache.json');
export const INVESTOR_FLOW_CACHE_MAX_DAYS = 7;

export interface InvestorFlowCacheRow {
  stockCode: string;
  date: string;
  foreignNetBuy: number;
  institutionalNetBuy: number;
  individualNetBuy: number;
  provider: 'KRX_INVESTOR_FLOW' | 'NAVER_INVESTOR_TREND' | 'CACHE';
  fetchedAt: string;
}

type InvestorFlowCacheShape = Record<string, InvestorFlowCacheRow[]>;

function normalizeCode(code: string): string {
  return code.replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function isValidRow(row: unknown): row is InvestorFlowCacheRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return typeof r.stockCode === 'string'
    && isValidDate(typeof r.date === 'string' ? r.date : '')
    && Number.isFinite(Number(r.foreignNetBuy))
    && Number.isFinite(Number(r.institutionalNetBuy))
    && Number.isFinite(Number(r.individualNetBuy))
    && typeof r.fetchedAt === 'string';
}

function ensureDir(): void {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* idempotent */ }
}

function loadAll(): InvestorFlowCacheShape {
  if (!fs.existsSync(INVESTOR_FLOW_CACHE_FILE)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(INVESTOR_FLOW_CACHE_FILE, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: InvestorFlowCacheShape = {};
    for (const [code, rows] of Object.entries(parsed as Record<string, unknown>)) {
      const safe = normalizeCode(code);
      if (!Array.isArray(rows)) continue;
      const validRows = rows.filter(isValidRow).map((r) => ({ ...r, stockCode: normalizeCode(r.stockCode) }));
      validRows.sort((a, b) => a.date.localeCompare(b.date));
      if (validRows.length > 0) out[safe] = validRows;
    }
    return out;
  } catch {
    return {};
  }
}

function saveAll(cache: InvestorFlowCacheShape): void {
  ensureDir();
  const tmp = `${INVESTOR_FLOW_CACHE_FILE}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, INVESTOR_FLOW_CACHE_FILE);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* idempotent */ }
  }
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function toSample(row: InvestorFlowCacheRow): InvestorFlowSample {
  return {
    stockCode: row.stockCode,
    foreignNetBuy: Number(row.foreignNetBuy),
    institutionalNetBuy: Number(row.institutionalNetBuy),
    individualNetBuy: Number(row.individualNetBuy),
    provider: 'CACHE',
    fetchedAt: row.fetchedAt,
  };
}

export function loadInvestorFlowCache(code: string, asOfDate = todayKst()): InvestorFlowSample | null {
  const safe = normalizeCode(code);
  const rows = loadAll()[safe] ?? [];
  if (rows.length === 0) return null;
  const sameDay = [...rows].reverse().find((row) => row.date === asOfDate);
  if (sameDay) return toSample(sameDay);
  const previous = [...rows].reverse().find((row) => row.date < asOfDate);
  return previous ? toSample(previous) : null;
}

export function upsertInvestorFlowCache(row: InvestorFlowCacheRow): void {
  if (!isValidRow(row)) return;
  const safe = normalizeCode(row.stockCode);
  const cache = loadAll();
  const rows = cache[safe] ?? [];
  const byDate = new Map<string, InvestorFlowCacheRow>();
  for (const existing of rows) byDate.set(existing.date, existing);
  byDate.set(row.date, { ...row, stockCode: safe });
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  cache[safe] = merged.slice(Math.max(0, merged.length - INVESTOR_FLOW_CACHE_MAX_DAYS));
  saveAll(cache);
}

export function __resetInvestorFlowCacheForTests(): void {
  try { fs.unlinkSync(INVESTOR_FLOW_CACHE_FILE); } catch { /* idempotent */ }
}
