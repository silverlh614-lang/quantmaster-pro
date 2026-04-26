// @responsibility tradingSettingsRepo 영속화 저장소 모듈
import fs from 'fs';
import { TRADING_SETTINGS_FILE, SESSION_STATE_FILE, ensureDataDir } from './paths.js';

// ─── Trading Settings 타입 ─────────────────────────────────────────────────

export interface TradingSettings {
  // 매수 조건: Gate 통과 + 최소 스코어 임계값
  buyCondition: {
    gatePassRequired: boolean;       // Gate 통과 필수 여부
    minScoreThreshold: number;       // 최소 스코어 임계값 (0~100)
  };
  // 자동 손절: 3단계 강제 청산
  autoStopLoss: {
    enabled: boolean;
    level1: number;  // 1차 (기본 -7%)
    level2: number;  // 2차 (기본 -15%)
    level3: number;  // 3차 (기본 -25%)
  };
  // 포지션 한도: 단일 종목 최대 비중
  positionLimit: {
    enabled: boolean;
    maxSingleStockPercent: number;  // 기본 15%
  };
  // 운용 시간: 장중 자동매매 시간대
  tradingHours: {
    enabled: boolean;
    startTime: string;  // "09:00"
    endTime: string;    // "15:30"
  };
  // OCO 등록: 진입 시 자동 손절/익절 동시 등록
  ocoAutoRegister: {
    enabled: boolean;
  };
  // 섀도우 계좌 시작 원금 (원화)
  startingCapital: number;
  // 메타 정보
  updatedAt: string;
}

export const DEFAULT_TRADING_SETTINGS: TradingSettings = {
  buyCondition: {
    gatePassRequired: true,
    minScoreThreshold: 60,
  },
  autoStopLoss: {
    enabled: true,
    level1: -7,
    level2: -15,
    level3: -25,
  },
  positionLimit: {
    enabled: true,
    maxSingleStockPercent: 15,
  },
  tradingHours: {
    enabled: true,
    startTime: '09:00',
    endTime: '15:30',
  },
  ocoAutoRegister: {
    enabled: true,
  },
  startingCapital: 100_000_000,
  updatedAt: new Date().toISOString(),
};

export function loadTradingSettings(): TradingSettings {
  ensureDataDir();
  try {
    if (fs.existsSync(TRADING_SETTINGS_FILE)) {
      const raw = fs.readFileSync(TRADING_SETTINGS_FILE, 'utf-8');
      return { ...DEFAULT_TRADING_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('[TradingSettings] 로드 실패:', e);
  }
  return { ...DEFAULT_TRADING_SETTINGS };
}

export function saveTradingSettings(settings: TradingSettings): void {
  ensureDataDir();
  settings.updatedAt = new Date().toISOString();
  fs.writeFileSync(TRADING_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// ─── Session State 타입 ────────────────────────────────────────────────────

export interface SessionState {
  gateWeights: Record<string, number>;
  universeSelection: string[];
  initialInvestment: number;
  tradingSettings: TradingSettings;
  savedAt: string;
}

export function loadSessionState(): SessionState | null {
  ensureDataDir();
  try {
    if (fs.existsSync(SESSION_STATE_FILE)) {
      const raw = fs.readFileSync(SESSION_STATE_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('[SessionState] 로드 실패:', e);
  }
  return null;
}

export function saveSessionState(state: SessionState): void {
  ensureDataDir();
  state.savedAt = new Date().toISOString();
  fs.writeFileSync(SESSION_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}
