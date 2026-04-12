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
  /** LLM 5단계 임팩트 점수: -2/−1/0/+1/+2 */
  llmImpact?: number;
  /** LLM 임팩트 분류 근거 */
  llmReason?: string;
  /** 내부자 매수(대주주/임원 장내매수) 감지 여부 */
  insiderBuy?: boolean;
  /** 악재 소화 완료 신호: 부정 공시 후 주가 미하락 종목 */
  badNewsAbsorbed?: boolean;
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
