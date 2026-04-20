/**
 * @responsibility UI 관제실에서 매수 신호 승인 대기열을 조회하고 수동으로 승인/차단하는 엔드포인트 제공.
 *
 * 엔드포인트:
 *   GET  /auto-trade/signals/pending            — 현재 대기 중인 승인 목록
 *   POST /auto-trade/signals/:tradeId/approve   — UI 에서 강제 승인
 *   POST /auto-trade/signals/:tradeId/reject    — UI 에서 차단 (reason 필수, 실패패턴 DB 기록)
 *
 * 텔레그램 bot 이 이미 제공하던 승인 루프와 동일한 pendingApprovals 맵을 공유한다.
 * 양쪽 어느 한 곳에서 resolve 되면 나머지는 "이미 처리됨" 으로 404 를 반환.
 */
import { Router } from 'express';
import {
  listPendingApprovals,
  resolvePendingApproval,
} from '../../telegram/buyApproval.js';
import { saveFailureSnapshot } from '../../learning/failurePatternDB.js';
import type { FailurePatternEntry } from '../../persistence/failurePatternRepo.js';

const router = Router();

router.get('/auto-trade/signals/pending', (_req: any, res: any) => {
  res.json({ entries: listPendingApprovals() });
});

router.post('/auto-trade/signals/:tradeId/approve', async (req: any, res: any) => {
  const tradeId = String(req.params.tradeId ?? '').trim();
  if (!tradeId) return res.status(400).json({ error: 'tradeId 필수' });
  const resolved = await resolvePendingApproval(tradeId, 'APPROVE', 'UI');
  if (!resolved) return res.status(404).json({ error: '대기 중인 승인이 없습니다 (이미 처리되었거나 만료됨)' });
  res.json({ ok: true, action: 'APPROVE', tradeId });
});

router.post('/auto-trade/signals/:tradeId/reject', async (req: any, res: any) => {
  const tradeId = String(req.params.tradeId ?? '').trim();
  if (!tradeId) return res.status(400).json({ error: 'tradeId 필수' });

  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason) return res.status(400).json({ error: '차단 사유(reason)는 필수 입력입니다.' });

  // 대기 목록에서 스냅샷을 먼저 확보(resolve 후에는 사라짐) — 실패패턴 DB 기록에 사용.
  const pending = listPendingApprovals().find((p) => p.tradeId === tradeId);

  const resolved = await resolvePendingApproval(tradeId, 'REJECT', 'UI');
  if (!resolved) return res.status(404).json({ error: '대기 중인 승인이 없습니다 (이미 처리되었거나 만료됨)' });

  // 실패패턴 DB 자동 기록 — 차단 사유는 종목명에 연결해 사람이 읽을 수 있도록 남긴다.
  // 조건 스코어 미상의 UI-reject 는 빈 벡터로 기록(코사인 유사도 0) — 검색 노이즈 최소화.
  if (pending) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const entry: FailurePatternEntry = {
      id: `ui-reject-${pending.tradeId}`,
      stockCode: pending.stockCode,
      stockName: `${pending.stockName} [UI-REJECT: ${reason}]`,
      entryDate: todayIso,
      exitDate: todayIso,
      returnPct: 0,
      conditionScores: {},
      gate1Score: 0,
      gate2Score: 0,
      gate3Score: 0,
      finalScore: 0,
      marketRegime: null,
      sector: null,
      savedAt: new Date().toISOString(),
    };
    try {
      saveFailureSnapshot(entry);
    } catch (e) {
      console.warn('[signalsRouter] 실패 패턴 기록 실패:', (e as Error).message);
    }
  }

  res.json({ ok: true, action: 'REJECT', tradeId, reason });
});

export default router;
