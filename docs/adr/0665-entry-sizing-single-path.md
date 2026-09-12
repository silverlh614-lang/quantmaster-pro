# ADR-0665: 진입 사이징 단일 경로

@responsibility Define one active entry sizing boundary while preserving legacy allocation behavior and persisted trade contracts.

- Date: 2026-09-12
- Status: Accepted
- Domain: Trading Engine / entry sizing

## Context

일반 매수, 장중 매수, 선행 진입, 후속 진입은 비중 계산, 현금·슬롯 기반 수량 계산, exposure cap을 서로 다른 모듈에서 가져온다. `positionSizingEngineWiring.shouldApplyPositionSizingEngine()`은 항상 false인데 네 경로는 Kelly/tier 입력과 적용 분기를 계속 구성한다. 활성 exposure cap이 이 비활성 엔진 wiring 파일에 함께 있어 실제 계산 경로를 알아보기 어렵다.

사용자는 레짐 제거와 뉴스·추세 전략 및 Shadow 학습 재구축에 앞서 참조 경로 통일을 요청했다. 현재 `REGIME_CONFIGS`와 실제 비중 정책의 한도는 서로 다르므로 이번 변경에서 수치를 합치면 구조 변경과 전략 변경이 섞인다.

## Decision

1. `server/trading/sizing/entrySizingPolicy.ts`를 실제 진입 사이징의 공개 경계로 둔다. 주문 수량 계산과 exposure cap 구현은 이 파일로 이동한다. 기존 regime 비중 계산은 순수 legacy adapter로 위임하며 중복 구현하지 않는다.
2. `src/types/entrySizing.ts`의 수량 입력에는 자산·주문 가능 현금·종목 비중·가격·잔여 슬롯만 둔다. Kelly 배수는 포함하지 않는다. 기존 `entryEngine`의 수량 API와 `positionSizingEngineWiring`의 exposure API는 호환 위임으로 유지한다.
3. 네 진입 경로에서 항상 비활성인 `applyPositionSizingEngine`과 그 입력 구성·결과 분기를 제거한다. 실제 수량·비중·floor·cap 소비자는 새 경계를 사용한다. 장전/추가매수/dry-run의 관련 계산 import도 같은 경계로 정리하되 실행 순서와 수치는 보존한다.
4. 영속 계약은 유지한다: `sizingSource='LEGACY_SSOT'`, `sizingEngineSnapshot=undefined`. `EntryKellySnapshot`은 현행 signalGrade/학습 소비자가 있으므로 삭제하거나 새 값으로 채우지 않는다.
5. 레짐별 수치, 활성 tier FAIL, provider health, RRR, 슬롯 계산, 30%/70% 분할 반올림, exposure flag는 변경하지 않는다. 실제 주문 제출·체결·보유 관리 및 학습 writer도 변경하지 않는다.
6. 추가 ENV 토글은 만들지 않는다. 동일 구현으로 향하는 호환 API와 회귀 테스트로 이관하고, 복구는 이 변경 커밋의 revert로 한다.

## Consequences

- 이후 레짐 비중 정책을 교체할 위치와 수량/노출 계산 위치가 명확해진다. 비활성 Kelly 엔진이 실행 경로의 정책 후보처럼 보이지 않는다.
- 기존 진단/과거 데이터/테스트 API의 호환성을 유지한다. 호환 export는 별도 계산 권한이 아니다.
- 이번 단계는 전체 전략 통일이나 레짐 제거의 완료가 아니다. Gate/exit/scan context/학습 경로는 후속 범위다.
- 새 provider 호출과 저장 스키마 변경이 없다. 실제 주문 수량 경로를 편집하므로 결과 동등성 검증이 필요하다.

## Alternatives Considered

- 파일명만 바꾸기: 비활성 엔진과 활성 budget 계산의 혼재를 해결하지 못한다.
- 레짐 한도·Kelly·Gate·Shadow를 동시에 교체하기: 회귀 원인과 전략 변경 효과를 분리하기 어렵다.
- 모든 소비자가 순수 legacy 모듈을 직접 참조하기: 후속 정책 교체 시 진입 경로별 수정이 반복된다.
- OFF/ON 신규 경로를 flag로 병존하기: 사용자가 해결하려는 다중 경로 문제를 늘린다.

## Validation

기존 수량/슬롯/현금 경계, exposure flag ON/OFF와 cap, 네 진입 경로의 실제 결과·영속 메타데이터를 검증한다. 활성 소비자가 비활성 wiring을 다시 import하지 않는 경계 검증을 추가한다. 타입 검사, validate:all, 관련 테스트, precommit 결과와 기존 실패를 구분해 작업 보고서에 기록한다.

## References

- [Module boundaries](../../ARCHITECTURE.md)
- [Trading engine rules](../ai/02-trading-engine-rules.md)
- [Refactor rules](../ai/09-refactor-rules.md)
- 기존 구현: `server/trading/{entryEngine,sizing/positionSizingEngineWiring,sizing/regimePositionPolicy}.ts`
