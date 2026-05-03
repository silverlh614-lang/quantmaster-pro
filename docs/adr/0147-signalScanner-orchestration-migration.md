# ADR-0147 — signalScanner 오케스트레이션 6단계 마이그레이션 (Phase 3)

**Status**: Accepted
**Date**: 2026-05-03
**Context**:
ADR-0001 (Phase A) 및 ADR-0134 (perSymbolEvaluation 분해) 이후, 기존 `signalScanner.ts`에 잔존해 있는 파이프라인의 거대 제어 흐름을 `signalScanner/index.ts`로 이관하여 1,820줄 파일의 해체를 최종 마무리해야 한다.
현재 `index.ts`는 TODO 에러를 던지는 스터브(stub) 상태이며, 실제 메인 루프와의 연결점이 필요한 시점이다.

**Decision**:
`signalScanner/index.ts`를 스캔 파이프라인의 **6단계 오케스트레이터**로 공식 승격한다.
제어 흐름은 다음과 같은 단방향 파이프라인으로 구성된다:
1. **Preflight**: 거시/시스템 환경 평가 및 매수 차단 게이트 판정
2. **Candidate Select**: 스윙/카탈리스트/모멘텀 및 장중 강세 관심종목 선정
3. **Per-Symbol Evaluation**: 종목별 진입 조건 및 포지션 사이징 산출
4. **Approval Queue**: 조건 충족 종목의 승인 큐 대기 및 권한 판정
5. **Order Dispatch**: 승인 완료 종목의 KIS 실주문 발송 처리
6. **Diagnostics**: 스캔 이력, 차단 사유 통계 및 영속화

**Consequences**:
- **Positive**: 자동매매 파이프라인의 거시적 제어 흐름이 50줄 이내의 코드(index.ts)로 한눈에 요약되어 유지보수성이 극대화된다.
- **Positive**: 각 하위 모듈이 완벽히 분리되어 Mocking 및 단위 테스트가 매우 용이해진다.
- **Negative**: LIVE 매매의 핵심 경로를 수정하므로 회귀 오류의 위험이 따른다.
  - *Mitigation*: 기존 `signalScanner.ts`는 완전히 삭제하지 않고 외부 인터페이스용 Barrel re-export로 남겨두며, byte-equivalent 수준의 호출 이관으로 점진적 마이그레이션을 수행한다.