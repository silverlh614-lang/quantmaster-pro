/**
 * @responsibility AI 추천 universe 건강성 조회 endpoint — `/api/health/ai-universe` (PR-37, ADR-0016)
 *
 * 운영자 가시성을 위한 read-only 진단 라우터. snapshot 메타 (mode 별 4종) +
 * stockMasterHealthRepo 의 source 별 health score + Google/Naver/Yahoo 외부 소스 상태를
 * 한 응답에 모은다. 자동매매·매매엔진 진입점 영향 없음.
 */

import { Router, Request, Response } from 'express';
import { getSnapshotMeta } from '../persistence/aiUniverseSnapshotRepo.js';
import { getHealthSnapshot, computeOverallHealth } from '../persistence/stockMasterHealthRepo.js';
import { getRemainingGoogleSearchQuota } from '../clients/googleSearchClient.js';
import { classifyMarketDataMode } from '../utils/marketClock.js';
import type { AiUniverseMode } from '../services/aiUniverseTypes.js';

const router = Router();

const MODES: AiUniverseMode[] = ['MOMENTUM', 'EARLY_DETECT', 'QUANT_SCREEN', 'BEAR_SCREEN', 'SMALL_MID_CAP'];

interface SnapshotMetaResponse {
  tradingDate: string;
  ageDays: number;
  expired: boolean;
}

/**
 * 빈 snapshot 은 null, 손상된 snapshot 은 ageDays/expired null. 정상은 `SnapshotMetaResponse`.
 * 클라이언트가 `null` 만 보고 "snapshot 없음" 분기 가능.
 */
function buildSnapshotsBlock(now: number = Date.now()): Record<AiUniverseMode, SnapshotMetaResponse | null> {
  const out: Partial<Record<AiUniverseMode, SnapshotMetaResponse | null>> = {};
  for (const m of MODES) {
    const meta = getSnapshotMeta(m, now);
    if (!meta.exists || meta.tradingDate === null || meta.ageDays === null) {
      out[m] = null;
      continue;
    }
    out[m] = {
      tradingDate: meta.tradingDate,
      ageDays: meta.ageDays,
      expired: meta.expired,
    };
  }
  return out as Record<AiUniverseMode, SnapshotMetaResponse | null>;
}

interface MasterHealthBlock {
  overall: number;
  sources: Record<string, number>;
}

function buildMasterHealthBlock(now: number = Date.now()): MasterHealthBlock {
  const snapshots = getHealthSnapshot(now);
  const sources: Record<string, number> = {};
  for (const s of snapshots) sources[s.source] = s.score;
  return {
    overall: computeOverallHealth(now),
    sources,
  };
}

interface SourcesBlock {
  google: { status: 'OK' | 'NOT_CONFIGURED' | 'BUDGET_EXCEEDED'; remaining?: number };
  naver: { status: 'OK' };
  yahoo: { status: 'OK' };
}

function buildSourcesBlock(): SourcesBlock {
  const googleConfigured = Boolean(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX);
  const remaining = getRemainingGoogleSearchQuota();
  let googleStatus: SourcesBlock['google']['status'];
  if (!googleConfigured) googleStatus = 'NOT_CONFIGURED';
  else if (remaining <= 0) googleStatus = 'BUDGET_EXCEEDED';
  else googleStatus = 'OK';

  return {
    google: { status: googleStatus, remaining: googleConfigured ? remaining : undefined },
    naver: { status: 'OK' },
    yahoo: { status: 'OK' },
  };
}

/**
 * GET /api/health/ai-universe
 * 운영자 진단 — snapshot 4 mode + master 건강성 + 외부 소스 상태.
 */
router.get('/ai-universe', (_req: Request, res: Response) => {
  const now = Date.now();
  res.json({
    marketMode: classifyMarketDataMode(new Date(now)),
    snapshots: buildSnapshotsBlock(now),
    masterHealth: buildMasterHealthBlock(now),
    sources: buildSourcesBlock(),
    timestamp: new Date(now).toISOString(),
  });
});

/** 테스트 헬퍼 — 라우터 핸들러 직접 호출용. */
export const __testOnly = {
  buildSnapshotsBlock,
  buildMasterHealthBlock,
  buildSourcesBlock,
};

export default router;
