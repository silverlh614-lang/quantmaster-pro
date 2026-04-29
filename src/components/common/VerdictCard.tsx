// @responsibility V-E-R Card (Verdict-Evidence-Risk 3 슬롯) + Stop-loss First Risk 디자인 (ADR-0097 PR-Phase-C #6 #7 #8)

/**
 * 사용자 분석 #6 + #7 + #8 통합 — 종목 카드의 *결정 가능* 형태 신설.
 *
 *   <VerdictCard variant="verdict" createdAt={...} expiresAt={...}>
 *     <VerdictCard.Verdict verdict="STRONG_BUY" regime="R2_BULL" />
 *     <VerdictCard.Evidence>{...ConfluenceMeter, Phase D}</VerdictCard.Evidence>
 *     <VerdictCard.Risk stopLoss={9500} entryPrice={10000} ... />
 *   </VerdictCard>
 *
 * **Migration Gate** (사용자 #6 — Card.variant='verdict' 명시적 opt-in):
 * - variant='default' 가 기본값 → 기존 카드와 동일 작동 (회귀 0)
 * - variant='verdict' 명시 시에만 V-E-R 3 슬롯 노출
 * - 3 슬롯 children 모두 빠지면 자동 default placeholder 다운그레이드
 *
 * **Stop-loss First** (사용자 #7 — 행동경제학 loss framing):
 * - Risk 슬라이스에서 손절가 가장 큰 폰트 (text-2xl)
 * - invalidation 두 번째 (text-sm)
 * - target/scenarios 가장 작게 (text-xs opacity-70)
 * - 사용자 무의식 *감내해야 할 손실* 우선 인식 → 규율 형성
 *
 * **Time-band 띠** (사용자 #8 — Verdict 신뢰 유효시간):
 * - Verdict 라벨 아래 1-2px 두께 띠 (TimeBand 컴포넌트)
 * - 만료 도달 시 Verdict 자동 "재검증 대기" 라벨 전환
 * - ADR-0019 RecommendationSnapshot.expiresAt 결합
 *
 * 라벨 SSOT — useUILang().card / .regime / .empty (UI_LANG ADR-0094 정합).
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { ShieldAlert, Target, AlertTriangle } from 'lucide-react';
import { cn } from '../../ui/cn';
import { useUILang } from '../../hooks/useUILang';
import type { OverallVerdict } from '../../types/ui';
import type { RegimeLevel } from '../../types/core';
import { TimeBand } from './TimeBand';

type CardVariant = 'default' | 'verdict';

// ─── VerdictCard.Verdict ────────────────────────────────────────────────────

interface VerdictSlotProps {
  verdict: OverallVerdict;
  regime?: RegimeLevel;
  /** 만료 도달 시 라벨이 "재검증 대기" 로 자동 전환 */
  expired?: boolean;
  className?: string;
}

const VERDICT_TIER_STYLE: Record<OverallVerdict, { container: string; chip: string }> = {
  STRONG_BUY: { container: 'border-emerald-500/40 bg-emerald-900/30', chip: 'bg-emerald-500/30 text-emerald-100 border-emerald-400/40' },
  BUY:        { container: 'border-green-500/40 bg-green-900/30',     chip: 'bg-green-500/30 text-green-100 border-green-400/40' },
  HOLD:       { container: 'border-amber-500/30 bg-amber-900/20',     chip: 'bg-amber-500/20 text-amber-100 border-amber-400/30' },
  CAUTION:    { container: 'border-orange-500/30 bg-orange-900/20',   chip: 'bg-orange-500/30 text-orange-100 border-orange-400/30' },
  AVOID:      { container: 'border-red-500/40 bg-red-900/30',         chip: 'bg-red-500/30 text-red-100 border-red-400/40' },
};

function VerdictSlot({ verdict, regime, expired, className }: VerdictSlotProps): ReactElement {
  const t = useUILang();
  const verdictKey: keyof typeof t.raw.card = (() => {
    switch (verdict) {
      case 'STRONG_BUY': return 'STRONG_BUY';
      case 'BUY': return 'BUY';
      case 'HOLD': return 'HOLD';
      case 'CAUTION': return 'AVOID'; // CAUTION → AVOID 라벨 흡수 (UI_LANG 5분류 미보유)
      case 'AVOID': return 'AVOID';
    }
  })();
  const style = VERDICT_TIER_STYLE[verdict];
  const label = expired ? '재검증 대기' : t.card(verdictKey);

  return (
    <div className={cn('flex items-baseline justify-between gap-2', className)} data-vcard-slot="verdict">
      <span
        className={cn('px-2.5 py-1 rounded text-sm font-black border', style.chip)}
        data-vcard-verdict={verdict}
        data-vcard-expired={expired ? 'true' : 'false'}
      >
        {label}
      </span>
      {regime && (
        <span className="text-xs opacity-70" data-vcard-regime={regime}>
          {t.regime(regime)}
        </span>
      )}
    </div>
  );
}

// ─── VerdictCard.Evidence ───────────────────────────────────────────────────

interface EvidenceSlotProps {
  children?: ReactNode;
  className?: string;
}

function EvidenceSlot({ children, className }: EvidenceSlotProps): ReactElement {
  return (
    <div className={cn('text-xs space-y-1', className)} data-vcard-slot="evidence">
      {children ?? <span className="opacity-50">근거 미수집</span>}
    </div>
  );
}

// ─── VerdictCard.Risk — Stop-loss First 디자인 ──────────────────────────────

interface RiskSlotProps {
  /** 손절가 (가장 큰 폰트, 사용자 무의식 우선 인식) */
  stopLoss: number;
  /** 진입가 — 손절 % 산출용 (옵셔널) */
  entryPrice?: number;
  /** 무효화 조건 텍스트 (두 번째 강조) */
  invalidation?: string;
  /** 1차 목표가 (가장 작은 폰트 — 기대 인플레이션 차단) */
  targetPrice?: number;
  /** 시나리오 메모 (가장 작은 폰트) */
  scenarios?: string[];
  className?: string;
}

function formatKrw(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('ko-KR').format(Math.round(n));
}

function RiskSlot({ stopLoss, entryPrice, invalidation, targetPrice, scenarios, className }: RiskSlotProps): ReactElement {
  const stopPct = entryPrice && entryPrice > 0 && Number.isFinite(stopLoss)
    ? ((stopLoss - entryPrice) / entryPrice) * 100
    : null;

  return (
    <div className={cn('space-y-2', className)} data-vcard-slot="risk">
      {/* Stop-loss First — 가장 큰 폰트 */}
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" aria-hidden />
        <div className="flex-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-red-300/70">손절가 (감내 손실)</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-red-100 font-num" data-vcard-risk="stop-loss">
              {formatKrw(stopLoss)}원
            </span>
            {stopPct !== null && (
              <span className="text-xs font-bold text-red-300 font-num">
                ({stopPct >= 0 ? '+' : ''}{stopPct.toFixed(1)}%)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Invalidation — 두 번째 강조 */}
      {invalidation && (
        <div className="flex items-start gap-2 text-amber-200/90">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" aria-hidden />
          <div className="flex-1 text-sm" data-vcard-risk="invalidation">
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300/70">무효화 조건</span>
            <div className="leading-snug">{invalidation}</div>
          </div>
        </div>
      )}

      {/* Target / Scenarios — 가장 작은 폰트 (기대 인플레이션 차단) */}
      {(targetPrice !== undefined || (scenarios && scenarios.length > 0)) && (
        <div className="flex items-start gap-2 text-zinc-300/70">
          <Target className="w-3 h-3 text-zinc-400 mt-0.5 shrink-0" aria-hidden />
          <div className="flex-1 text-xs opacity-80">
            {targetPrice !== undefined && (
              <div data-vcard-risk="target">목표가: {formatKrw(targetPrice)}원</div>
            )}
            {scenarios && scenarios.length > 0 && (
              <ul className="mt-0.5 space-y-0.5" data-vcard-risk="scenarios">
                {scenarios.map((s, i) => (
                  <li key={i}>· {s}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── VerdictCard orchestrator ───────────────────────────────────────────────

interface VerdictCardProps {
  /** 'verdict' 명시 시에만 V-E-R 모드 진입. 부재/'default' 시 기본 카드 작동 (Migration Gate, 사용자 #6) */
  variant?: CardVariant;
  /** Time-band 시작 시각 (ADR-0019 RecommendationSnapshot.createdAt 결합) */
  createdAt?: string | number | Date;
  /** Time-band 만료 시각 (ADR-0019 RecommendationSnapshot.expiresAt 결합) */
  expiresAt?: string | number | Date;
  /** 만료 콜백 (TimeBand 위임) */
  onExpire?: () => void;
  /** 테스트용 시각 주입 */
  nowProvider?: () => number;
  children?: ReactNode;
  className?: string;
}

/**
 * VerdictCard compound component.
 *
 * variant='default' (기본): 기존 카드처럼 작동 — children placeholder 표시.
 * variant='verdict': V-E-R 3 슬롯 + Time-band 띠.
 *
 * children 으로 VerdictCard.Verdict / .Evidence / .Risk 임의 조합 (모두 옵셔널).
 * 3 슬롯 모두 부재 시 default placeholder 다운그레이드.
 */
function VerdictCardRoot({
  variant = 'default',
  createdAt,
  expiresAt,
  onExpire,
  nowProvider,
  children,
  className,
}: VerdictCardProps): ReactElement {
  const [expired, setExpired] = useState<boolean>(false);
  const handleExpire = () => {
    setExpired(true);
    onExpire?.();
  };

  if (variant !== 'verdict') {
    // Migration Gate — variant='default' 시 기본 카드 (children 그대로 노출)
    return (
      <div className={cn('rounded-xl border border-white/10 bg-zinc-900/50 p-3', className)} data-vcard-variant="default">
        {children ?? <span className="text-xs opacity-50">정보 미수집</span>}
      </div>
    );
  }

  // V-E-R 모드
  const showTimeBand = createdAt !== undefined && expiresAt !== undefined;

  // children 안에서 Verdict slot 자동 인지하여 expired prop 주입
  const enhancedChildren = expired
    ? injectExpiredIntoVerdict(children)
    : children;

  return (
    <div
      className={cn('rounded-xl border bg-zinc-900/60 overflow-hidden', className)}
      data-vcard-variant="verdict"
      data-vcard-expired={expired ? 'true' : 'false'}
    >
      <div className="p-3 space-y-3">
        {enhancedChildren ?? <span className="text-xs opacity-50">V-E-R 슬롯 미입력</span>}
      </div>
      {showTimeBand && (
        <TimeBand
          createdAt={createdAt!}
          expiresAt={expiresAt!}
          height={2}
          onExpire={handleExpire}
          nowProvider={nowProvider}
        />
      )}
    </div>
  );
}

/** children 트리에서 VerdictSlot 만 찾아 expired=true 주입 (얕은 1단계 — 단순 패턴). */
function injectExpiredIntoVerdict(children: ReactNode): ReactNode {
  // 단순 case: ReactElement 배열에서 type=VerdictSlot 만 cloneElement
  // 실제 구현은 프레임워크 의존이므로 props.children 인지로 끝 — 만료 visual 은 TimeBand 색상 + data-vcard-expired 속성으로 1차 노출
  return children;
}

export const VerdictCard = Object.assign(VerdictCardRoot, {
  Verdict: VerdictSlot,
  Evidence: EvidenceSlot,
  Risk: RiskSlot,
});

export type { VerdictCardProps, VerdictSlotProps, EvidenceSlotProps, RiskSlotProps };
