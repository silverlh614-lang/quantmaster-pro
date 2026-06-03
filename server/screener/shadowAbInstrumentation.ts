// @responsibility 프로덕션 shadow A/B 계측 — top-N survivor에 KIS Gate quote 병행평가·델타 로깅 only. 결정 미반영, flag OFF dormant.
/**
 * shadowAbInstrumentation.ts — Yahoo vs KIS Gate quote 프로덕션 shadow A/B 계측 (ADR-0547 §D / ADR-0561).
 *
 * 목적: 풀스캔 survivor 중 top-N 후보에 대해 KIS-first Gate quote 를 *병행 계산*하여 Yahoo-vs-KIS
 * 실측 델타(score/signal/MTAS flip)를 구조화 로그로 수집한다. 운영자가 ~20거래일 노이즈밴드를
 * 확정하여 flag flip 결정에 사용한다. 본 모듈은 결정에 **0 영향** — 순수 로깅(불변식 #8 shadow≠live).
 *
 * 절대 경계:
 *   - flag `KIS_SHADOW_AB_ENABLED` OFF(default) → byte-equivalent: 계측 미실행, KIS 신규호출 0콜.
 *   - shadow Gate 결과는 후보집합/점수/주문에 절대 들어가지 않는다 (executionImpact NONE).
 *   - KIS 조회 실패는 약세 신호가 아니다(불변식 #6 providerIssue≠marketSignal) — 로그만, throw 0.
 *   - KIS 호출은 fetchTechnicalQuoteByCode(code,{kisFirst:true}) 단일 통로(6h 캐시 재사용, quota bound).
 */

import { fetchTechnicalQuoteByCode } from './adapters/technicalQuoteRouter.js';
import { evaluateServerGate, type ServerGateResult, type ConditionWeights } from '../quantFilter.js';
import type { RegimeLevel } from '../../src/types/core.js';

/** ENV 글로벌 토글(default OFF) — byte-equivalent dormant 롤백. */
export function isShadowAbEnabled(): boolean {
  return process.env.KIS_SHADOW_AB_ENABLED === 'true';
}

/** top-N 한정(quota bound) — survivor 우선 정렬 후 상위 N 만 dual-eval. */
export const SHADOW_AB_TOP_N = 30;

/**
 * Live(Yahoo 경로) Gate 평가 결과 + shadow 재평가에 필요한 동일 입력 컨텍스트.
 * yahooGate 는 이미 *결정에 사용된* live 결과(불변) — 본 계측은 이를 읽기만 한다.
 */
export interface ShadowAbCandidate {
  code: string;
  name: string;
  /** 이미 결정에 사용된 live(Yahoo 경로) Gate 결과. 읽기 전용 — 변형 금지. */
  yahooGate: ServerGateResult;
  /** shadow Gate 재평가가 live 와 동일 조건이 되도록 동일 입력을 보존. */
  weights: ConditionWeights;
  kospi20dReturn?: number | null;
  regime?: RegimeLevel | string;
}

/**
 * Shadow A/B 계측 버퍼 — 스캔 루프가 survivor 후보를 push, 루프 종료 후 flush 로 top-N dual-eval.
 * 인스턴스 단위(스캔 1회)로 생성·소비 — 전역 상태 누적 없음(재진입 안전).
 */
export class ShadowAbCollector {
  private readonly candidates: ShadowAbCandidate[] = [];
  private readonly enabled: boolean;

  constructor() {
    // 생성 시점 flag snapshot — 스캔 1회 동안 일관(중간 토글 무시).
    this.enabled = isShadowAbEnabled();
  }

  /** flag OFF면 즉시 no-op(dormant) — push 자체가 일어나지 않아 byte-equivalent. */
  add(candidate: ShadowAbCandidate): void {
    if (!this.enabled) return;
    this.candidates.push(candidate);
  }

  /**
   * top-N survivor 에 KIS-first quote 병행 평가 후 델타 로깅. **결정 미반영(로깅만)**.
   * flag OFF → 즉시 return(KIS 신규호출 0, 로그 0). 실패는 throw 하지 않음(불변식 #6).
   * @returns dual-eval 한 심볼 수(테스트 단언용; 결정에는 미사용).
   */
  async flush(): Promise<number> {
    if (!this.enabled || this.candidates.length === 0) return 0;

    // survivor 우선 → gateScore 내림차순 정렬 후 top-N 한정(quota bound).
    const topN = [...this.candidates]
      .sort((a, b) => b.yahooGate.gateScore - a.yahooGate.gateScore)
      .slice(0, SHADOW_AB_TOP_N);

    let evaluated = 0;
    for (const c of topN) {
      await this.measureOne(c);
      evaluated++;
    }
    return evaluated;
  }

  /**
   * 단일 심볼 dual-eval — KIS-first quote(6h 캐시 재사용) → shadow Gate → 델타 1라인 로깅.
   * 결정에 영향 0: yahooGate 는 변형하지 않고, shadow 결과는 반환·저장·소비 안 함(순수 로깅).
   */
  private async measureOne(c: ShadowAbCandidate): Promise<void> {
    let kisQuote = null;
    let providerIssue = false;
    try {
      // 단일 통로 + 6h/휴장 TTL 캐시 재사용(반복 0콜). live 결정 경로와 별개 shadow fetch.
      kisQuote = await fetchTechnicalQuoteByCode(c.code, { kisFirst: true });
    } catch (e) {
      // KIS 조회 실패는 약세 신호가 아니다(불변식 #6) — providerIssue 라벨만, marketSignal=false.
      providerIssue = true;
      console.warn(
        `[KIS_SHADOW_AB] code=${c.code} kisQuoteError — providerIssue=true marketSignal=false executionImpact=NONE`
        + ` reason=${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    if (!kisQuote || kisQuote.price <= 0) {
      // 데이터 부재 = provider 이슈(불변식 #6). 약세 신호로 변환하지 않음 — 로그만.
      console.warn(
        `[KIS_SHADOW_AB] code=${c.code} kisQuoteEmpty — providerIssue=true marketSignal=false executionImpact=NONE`,
      );
      return;
    }

    // shadow Gate 재평가 — live 와 동일 weights/regime/kospi20dReturn 입력(공정 비교). 결과는 로깅만.
    const kisGate = evaluateServerGate(
      kisQuote,
      c.weights,
      c.kospi20dReturn,
      null,
      null,
      c.regime,
    );

    const yahooScore = c.yahooGate.gateScore;
    const kisScore = kisGate.gateScore;
    const dScore = kisScore - yahooScore;
    const yahooSignal = c.yahooGate.signalType;
    const kisSignal = kisGate.signalType;
    const signalFlip = yahooSignal !== kisSignal;
    const mtasDelta = kisGate.mtas - c.yahooGate.mtas;

    // 구조화 1라인/심볼 — 운영자 집계용. marketSignal=false / executionImpact=NONE literal.
    console.info(
      `[KIS_SHADOW_AB] code=${c.code}`
      + ` yahooScore=${yahooScore.toFixed(3)}`
      + ` kisScore=${kisScore.toFixed(3)}`
      + ` dScore=${dScore.toFixed(3)}`
      + ` yahooSignal=${yahooSignal}`
      + ` kisSignal=${kisSignal}`
      + ` signalFlip=${signalFlip}`
      + ` mtasDelta=${mtasDelta.toFixed(3)}`
      + ` providerIssue=${providerIssue}`
      + ` marketSignal=false`
      + ` executionImpact=NONE`,
    );
  }
}
