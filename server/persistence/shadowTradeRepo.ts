import fs from 'fs';
import { SHADOW_FILE, SHADOW_LOG_FILE, ensureDataDir } from './paths.js';

export interface ServerShadowTrade {
  id: string;
  stockCode: string;
  stockName: string;
  signalTime: string;
  signalPrice: number;
  shadowEntryPrice: number;
  quantity: number;
  stopLoss: number;
  targetPrice: number;
  status: 'PENDING' | 'ACTIVE' | 'HIT_TARGET' | 'HIT_STOP' | 'EUPHORIA_PARTIAL';
  exitPrice?: number;
  exitTime?: string;
  returnPct?: number;
  price7dAgo?: number;       // 과열 탐지 신호 3용 (7일 전 가격)
  originalQuantity?: number; // 최초 진입 수량 — EUPHORIA 부분 매도 후 실보유 추적용
  cascadeStep?: 0 | 1 | 2;  // 0=없음, 1=-7% 경고, 2=-15% 반매도
  addBuyBlocked?: boolean;   // -7% 이후 추가 매수 차단 플래그
  halfSoldAt?: string;       // -15% 반매도 시각 (ISO)
  stopApproachAlerted?: boolean; // 손절가 5% 이내 접근 경고 발송 여부 (중복 방지)
}

export function loadShadowTrades(): ServerShadowTrade[] {
  ensureDataDir();
  if (!fs.existsSync(SHADOW_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SHADOW_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveShadowTrades(trades: ServerShadowTrade[]): void {
  ensureDataDir();
  fs.writeFileSync(SHADOW_FILE, JSON.stringify(trades, null, 2));
}

export function appendShadowLog(entry: Record<string, unknown>): void {
  ensureDataDir();
  const logs: unknown[] = fs.existsSync(SHADOW_LOG_FILE)
    ? JSON.parse(fs.readFileSync(SHADOW_LOG_FILE, 'utf-8'))
    : [];
  logs.push({ ...entry, ts: new Date().toISOString() });
  // 최근 500건만 보관
  fs.writeFileSync(SHADOW_LOG_FILE, JSON.stringify(logs.slice(-500), null, 2));
}
