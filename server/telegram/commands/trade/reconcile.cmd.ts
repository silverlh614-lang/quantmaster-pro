// @responsibility reconcile.cmd 텔레그램 모듈
// @responsibility: /reconcile [apply|last|status|push|live [apply]] + /reconcile_qty alias — 서버 장부 vs 실잔고 동기화 (dry-run/apply/push/LIVE).
import {
  loadShadowTrades,
  getRemainingQty,
} from '../../../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from '../../../trading/signalScanner.js';
import {
  reconcileShadowQuantities,
  loadLastReconcileResult,
} from '../../../persistence/shadowAccountRepo.js';
import {
  reconcileLivePositions,
  formatLiveReconcileResult,
} from '../../../trading/liveReconciler.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

// ADR-0015: /reconcile live apply 60초 rate-limit 가드 — 오타 방지. 모듈 로컬 상태.
let _lastLiveReconcileApplyAt = 0;

interface ReconcileDetail {
  stockCode: string;
  stockName?: string;
  before: { qty: number; status: string };
  after: { qty: number; status: string };
}

function formatDetails(details: ReconcileDetail[] | undefined): string {
  if (!details || details.length === 0) return '\n변경 사항 없음';
  const lines = details
    .slice(0, 8)
    .map(
      d =>
        `• ${escapeHtml(d.stockName ?? '')}(${escapeHtml(d.stockCode)}): ` +
        `${d.before.qty}주/${escapeHtml(d.before.status)} → ${d.after.qty}주/${escapeHtml(d.after.status)}`,
    );
  const more = details.length > 8 ? `\n...외 ${details.length - 8}건` : '';
  return `\n${lines.join('\n')}${more}`;
}

const reconcile: TelegramCommand = {
  name: '/reconcile',
  // /reconcile_qty 는 무인자 호출 시 apply 모드 호환 유지 (legacy).
  aliases: ['/reconcile_qty'],
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '서버 장부 ↔ 실데이터 동기화 (기본 dry-run; apply/last/status/push/live 서브)',
  usage: '/reconcile [apply|last|status|push|live [apply]]',
  async execute({ args, reply }) {
    const sub = (args[0] ?? '').toLowerCase();
    // /reconcile_qty 진입 시 isLegacyApply=true 로 기존 호환 유지.
    // commandRegistry 가 alias 를 호출명에서 추출하지 않으므로, args[0] 가 빈 경우엔
    // /reconcile_qty 사용자도 dry-run 으로 안전 진입한다 — 명시적 'apply' 만 적용 변경.
    const apply = sub === 'apply';

    if (sub === 'last') {
      const last = loadLastReconcileResult();
      if (!last) {
        await reply('📭 저장된 reconcile 결과가 없습니다. /reconcile 으로 점검을 실행하세요.');
        return;
      }
      await reply(
        `🗂 <b>[마지막 reconcile 결과]</b>\n` +
        `모드: ${last.mode === 'apply' ? '🔴 APPLY (실제 교정)' : '🟡 DRY-RUN (점검만)'}\n` +
        `실행시각: ${new Date(last.ranAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n` +
        `검사: ${last.checked}건 | 교정${last.mode === 'dryRun' ? ' 후보' : ''}: ${last.fixed}건` +
        formatDetails(last.details as ReconcileDetail[] | undefined),
      );
      return;
    }

    if (sub === 'status') {
      const last = loadLastReconcileResult();
      if (!last) {
        await reply('📭 reconcile 이력 없음 — /reconcile 으로 점검을 실행하세요.');
        return;
      }
      const driftSeverity = last.fixed === 0 ? '🟢 깨끗' : last.fixed <= 3 ? '🟡 경미' : '🔴 심각';
      await reply(
        `📊 <b>[reconcile 상태]</b>\n` +
        `마지막 모드: ${last.mode === 'apply' ? 'APPLY' : 'DRY-RUN'}\n` +
        `마지막 실행: ${new Date(last.ranAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n` +
        `검사 ${last.checked}건 → 교정${last.mode === 'dryRun' ? ' 후보' : ''} ${last.fixed}건 (${driftSeverity})\n` +
        (last.fixed > 0 && last.mode === 'dryRun'
          ? '\n⚠️ DRY-RUN 결과에 변경 후보가 있습니다 — /reconcile apply 로 적용하세요.'
          : ''),
      );
      return;
    }

    // PR-3 #9: /reconcile push — 서버 장부 스냅샷 강제 브로드캐스트.
    if (sub === 'push') {
      const shadowsNow = loadShadowTrades();
      const open = shadowsNow.filter(s => isOpenShadowStatus(s.status) && getRemainingQty(s) > 0);
      if (open.length === 0) {
        await reply('📤 <b>[Reconcile Push]</b>\n서버 장부: 활성 포지션 없음 — 동기화할 내용 없음.');
        return;
      }
      const lines = open.map(s => {
        const isShadow = s.mode !== 'LIVE';
        const modeTag = isShadow ? '[SHADOW]' : '[LIVE]';
        const realQty = getRemainingQty(s);
        const cacheDrift = s.quantity !== realQty ? ` ⚠️ 캐시 ${s.quantity}주 불일치` : '';
        return (
          `• ${modeTag} ${escapeHtml(s.stockName)}(${escapeHtml(s.stockCode)}) — ${realQty}주 @${s.shadowEntryPrice.toLocaleString()}원` +
          cacheDrift
        );
      });
      const hasShadow = open.some(s => s.mode !== 'LIVE');
      const suffix = hasShadow ? '\n⚠️ [SHADOW] 표시는 가상 잔고 — 실계좌 아님' : '';
      await reply(
        `📤 <b>[Reconcile Push]</b> 서버 장부 기준 현재 포지션 ${open.length}개\n` +
        `━━━━━━━━━━━━━━━━\n` +
        lines.join('\n') +
        suffix +
        `\n\n💡 수량 불일치 발견 시 <code>/reconcile apply</code>`,
      );
      return;
    }

    // ADR-0015: /reconcile live — KIS 실잔고 기준 LIVE 포지션 강제 동기화.
    if (sub === 'live') {
      const sub2 = (args[1] ?? '').toLowerCase();
      const liveApply = sub2 === 'apply';

      if (liveApply) {
        const now = Date.now();
        if (now - _lastLiveReconcileApplyAt < 60_000) {
          const wait = Math.ceil((60_000 - (now - _lastLiveReconcileApplyAt)) / 1000);
          await reply(
            `⏱ <b>[Reconcile Live Apply 차단]</b>\n` +
            `최근 ${wait}초 이내 동일 명령 실행 — 오타 방지 가드. ` +
            `${wait}초 후 재시도하세요.`,
          );
          return;
        }
        _lastLiveReconcileApplyAt = now;
      }

      await reply(
        liveApply
          ? '⚡ <b>[LIVE Reconcile APPLY]</b> KIS 잔고를 SSOT 로 로컬 포지션 동기화 중...'
          : '🔍 <b>[LIVE Reconcile DRY-RUN]</b> KIS vs 로컬 비교 중 — 변경 없이 결과만 표시합니다...',
      );

      try {
        const liveResult = await reconcileLivePositions({ dryRun: !liveApply });
        await reply(formatLiveReconcileResult(liveResult));
      } catch (e) {
        console.error('[TelegramBot] /reconcile live 실패:', e);
        await reply('❌ /reconcile live 실패 — 서버 로그를 확인하세요.');
      }
      return;
    }

    const banner = apply
      ? '🔄 Railway 서버 장부 기준 수량/상태 강제 동기화 (APPLY) 실행 중...'
      : '🔍 reconcile 점검 (DRY-RUN) 실행 중 — 변경 없이 후보만 표시합니다...';
    await reply(banner);

    try {
      const result = reconcileShadowQuantities(undefined, { dryRun: !apply });
      const headerEmoji = apply ? '✅' : '🔍';
      const headerLabel = apply ? '[수량 강제 동기화 완료]' : '[DRY-RUN 점검 결과]';
      const tail = apply
        ? ''
        : result.fixed > 0
          ? `\n\n💡 실제 적용은 <code>/reconcile apply</code>`
          : '\n\n변경할 항목이 없어 apply 도 동일하게 무변경입니다.';

      await reply(
        `${headerEmoji} <b>${headerLabel}</b>\n` +
        `기준: Railway 서버 장부(fills → quantity/status)\n` +
        `검사: ${result.checked}건 | 교정${apply ? '' : ' 후보'}: ${result.fixed}건` +
        formatDetails(result.details as ReconcileDetail[] | undefined) +
        tail,
      );
    } catch (e) {
      console.error('[TelegramBot] /reconcile 실패:', e);
      await reply('❌ reconcile 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(reconcile);

export default reconcile;
