import fs from 'fs';
import { DART_ALERTS_FILE, ensureDataDir } from './paths.js';

export interface DartAlert {
  corp_name: string;
  stock_code: string;
  report_nm: string;
  rcept_dt: string;      // 접수일자 YYYYMMDD
  rcept_no: string;
  sentiment: 'MAJOR_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  alertedAt: string;
}

export function loadDartAlerts(): DartAlert[] {
  ensureDataDir();
  if (!fs.existsSync(DART_ALERTS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DART_ALERTS_FILE, 'utf-8')); } catch { return []; }
}

export function saveDartAlerts(alerts: DartAlert[]): void {
  ensureDataDir();
  fs.writeFileSync(DART_ALERTS_FILE, JSON.stringify(alerts.slice(-200), null, 2));
}

export function getDartAlerts(): DartAlert[] { return loadDartAlerts(); }
