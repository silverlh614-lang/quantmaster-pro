// @responsibility quant ipsEngine 엔진 모듈
import {
  IpsSignal,
  IpsSignalId,
  IpsResult,
  IpsLevel,
  MacroEnvironment,
  Gate0Result,
  BearRegimeResult,
} from '../../types/quant';

// ─── 아이디어 11: IPS 통합 변곡점 확률 엔진 ─────────────────────────────────────

/**
 * IPS (Integrated Probability Score) 통합 변곡점 확률 계산.
 *
 * 6개 신호의 가중합으로 변곡점 확률을 산출한다:
 *   IPS = THS역전(20%) + VDA(15%) + FSS음수(20%) +
 *         FBS_2단계(20%) + TMA감속(15%) + SRR역전(10%)
 *
 * 임계치:
 *   IPS ≥ 60 → ⚠️ WARNING  (경보)
 *   IPS ≥ 80 → 🚨 CRITICAL (50% 비중 축소 트리거)
 *   IPS ≥ 90 → 🔴 EXTREME  (Pre-Mortem 체크리스트)
 *
 * @param macroEnv  MacroEnvironment (Gate -1 보조 지표 포함)
 * @param gate0     Gate 0 평가 결과 (MHS / buyingHalted)
 * @param bearRegime Gate -1 Bear Regime 감지 결과
 */
export function evaluateIPS(
  macroEnv: MacroEnvironment,
  gate0: Gate0Result,
  bearRegime: BearRegimeResult,
): IpsResult {
  const now = new Date().toISOString();

  // ── 신호별 발동 조건 ──────────────────────────────────────────────────────────

  // THS 역전 (20%): Trend Health Score 악화
  // MHS가 감소 추세이거나 매수 중단 임계값(40) 미만
  const thsTriggered =
    gate0.buyingHalted ||
    macroEnv.mhsTrend === 'DETERIORATING' ||
    gate0.macroHealthScore < 50;

  // VDA (15%): VIX Divergence Alert — 공포지수 상승 이탈
  // VIX ≥ 22 또는 VKOSPI ≥ 22이면서 상승 추세
  const vdaTriggered =
    macroEnv.vix >= 22 ||
    macroEnv.vkospi >= 22 ||
    macroEnv.vkospiRising === true;

  // FSS 음수 (20%): Fundamental Stress Score 음수 영역
  // Bear Regime 조건 3개 이상 발동 → 근본적 스트레스 누적
  const fssTriggered = bearRegime.triggeredCount >= 3;

  // FBS 2단계 (20%): Fundamental Bias Score 2단계 이상
  // Bear Regime이 BEAR 또는 방어모드 진입
  const fbsTriggered =
    bearRegime.regime === 'BEAR' ||
    bearRegime.defenseMode;

  // TMA 감속 (15%): Trend Momentum Acceleration 감속
  // OECD CLI 100 미만(경기 하강) 또는 수출 증가율 음수
  const tmaTriggered =
    macroEnv.oeciCliKorea < 100 ||
    macroEnv.exportGrowth3mAvg < 0;

  // SRR 역전 (10%): Sector Rotation Rate 역전
  // 달러 강세(위험회피 섹터 로테이션) 또는 KOSPI 120일선 하회
  const srrTriggered =
    macroEnv.dxyBullish === true ||
    macroEnv.kospiBelow120ma === true;

  // ── 신호 목록 구성 ────────────────────────────────────────────────────────────

  const signals: IpsSignal[] = [
    {
      id: 'THS',
      name: 'Trend Health Score Reversal',
      nameKo: 'THS 역전',
      weight: 0.20,
      triggered: thsTriggered,
      contribution: thsTriggered ? 20 : 0,
      description: thsTriggered
        ? `MHS ${gate0.macroHealthScore}/100 — ${gate0.buyingHalted ? '매수 중단(MHS<40)' : macroEnv.mhsTrend === 'DETERIORATING' ? '하락 추세' : 'MHS<50 약세'}`
        : `MHS ${gate0.macroHealthScore}/100 — 건전한 추세`,
    },
    {
      id: 'VDA',
      name: 'VIX Divergence Alert',
      nameKo: 'VDA',
      weight: 0.15,
      triggered: vdaTriggered,
      contribution: vdaTriggered ? 15 : 0,
      description: vdaTriggered
        ? `VIX ${macroEnv.vix.toFixed(1)} / VKOSPI ${macroEnv.vkospi.toFixed(1)}${macroEnv.vkospiRising ? ' (상승 추세)' : ''} — 공포지수 이탈`
        : `VIX ${macroEnv.vix.toFixed(1)} / VKOSPI ${macroEnv.vkospi.toFixed(1)} — 정상 범위`,
    },
    {
      id: 'FSS',
      name: 'Fundamental Stress Score Negative',
      nameKo: 'FSS 음수',
      weight: 0.20,
      triggered: fssTriggered,
      contribution: fssTriggered ? 20 : 0,
      description: fssTriggered
        ? `Bear Regime 조건 ${bearRegime.triggeredCount}/${bearRegime.conditions.length}개 발동 — 펀더멘털 스트레스 누적`
        : `Bear Regime 조건 ${bearRegime.triggeredCount}/${bearRegime.conditions.length}개 발동 — 임계 미달`,
    },
    {
      id: 'FBS',
      name: 'Fundamental Bias Score Stage 2',
      nameKo: 'FBS 2단계',
      weight: 0.20,
      triggered: fbsTriggered,
      contribution: fbsTriggered ? 20 : 0,
      description: fbsTriggered
        ? `레짐: ${bearRegime.regime}${bearRegime.defenseMode ? ' (방어 모드 활성)' : ''} — 하락 편향 2단계 진입`
        : `레짐: ${bearRegime.regime} — 방어 모드 미발동`,
    },
    {
      id: 'TMA',
      name: 'Trend Momentum Acceleration Deceleration',
      nameKo: 'TMA 감속',
      weight: 0.15,
      triggered: tmaTriggered,
      contribution: tmaTriggered ? 15 : 0,
      description: tmaTriggered
        ? `OECD CLI ${macroEnv.oeciCliKorea.toFixed(1)} / 수출 ${macroEnv.exportGrowth3mAvg >= 0 ? '+' : ''}${macroEnv.exportGrowth3mAvg.toFixed(1)}% — 모멘텀 감속`
        : `OECD CLI ${macroEnv.oeciCliKorea.toFixed(1)} / 수출 +${macroEnv.exportGrowth3mAvg.toFixed(1)}% — 모멘텀 유지`,
    },
    {
      id: 'SRR',
      name: 'Sector Rotation Rate Reversal',
      nameKo: 'SRR 역전',
      weight: 0.10,
      triggered: srrTriggered,
      contribution: srrTriggered ? 10 : 0,
      description: srrTriggered
        ? `${macroEnv.dxyBullish ? 'DXY 강세(위험 회피)' : ''}${macroEnv.dxyBullish && macroEnv.kospiBelow120ma ? ' + ' : ''}${macroEnv.kospiBelow120ma ? 'KOSPI 120일선 하회' : ''} — 방어 섹터 로테이션`
        : 'DXY 중립 · KOSPI 120일선 상회 — 섹터 로테이션 정상',
    },
  ];

  // ── IPS 점수 및 단계 ─────────────────────────────────────────────────────────

  const ips = signals.reduce((sum, s) => sum + s.contribution, 0);

  let level: IpsLevel;
  if (ips >= 90) level = 'EXTREME';
  else if (ips >= 80) level = 'CRITICAL';
  else if (ips >= 60) level = 'WARNING';
  else level = 'NORMAL';

  const triggeredSignals = signals.filter(s => s.triggered).map(s => s.id);

  const positionReduceRecommended = ips >= 80;
  const preMortemRequired = ips >= 90;

  let actionMessage: string;
  if (level === 'EXTREME') {
    actionMessage = `🔴 IPS ${ips}% — Pre-Mortem 체크리스트 즉시 실행. 포지션 전면 재검토 및 손절 라인 재설정 요망.`;
  } else if (level === 'CRITICAL') {
    actionMessage = `🚨 IPS ${ips}% — 포지션 50% 비중 축소 트리거. 인버스 ETF 또는 현금 전환 검토.`;
  } else if (level === 'WARNING') {
    actionMessage = `⚠️ IPS ${ips}% — 변곡점 경보. 신규 매수 자제 및 손절 강화 권고.`;
  } else {
    actionMessage = `🟢 IPS ${ips}% — 정상 범위. 현재 시스템 신호에 따라 운용 유지.`;
  }

  return {
    ips,
    level,
    signals,
    triggeredSignals,
    actionMessage,
    positionReduceRecommended,
    preMortemRequired,
    lastUpdated: now,
  };
}
