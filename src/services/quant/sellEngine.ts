// @responsibility quant sellEngine 엔진 모듈
/**
 * sellEngine.ts — 매도 로직 (thin facade)
 *
 * Phase 1 리팩토링: 실제 구현은 sell/ 디렉토리로 수직 분해됨.
 * 이 파일은 하위 호환 re-export 지점이다. 신규 코드는 `./sell`에서 직접 import하자.
 *
 * 4레이어 설계:
 *   L1 기계적 손절  → 감정 개입 불가, 즉시 시장가 (최우선)
 *   L2 펀더멘털 붕괴 → Pre-Mortem 5조건, 조건 도달 즉시 자동 청산
 *   L3 분할 익절    → 수익 단계적 확정 + 트레일링 스톱
 *   L4 과열 탐지    → 탐욕 차단, 4개 신호 중 3개 이상 시 50% 익절
 */

export * from './sell';
