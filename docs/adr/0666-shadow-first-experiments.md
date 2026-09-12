# ADR-0666: 제약 없는 Shadow 기준 실험으로 재시작

@responsibility Define the default independent Shadow experiment path.

- Date: 2026-09-12
- Status: Accepted

## Context

사용자는 기존 레짐·Kelly 등 제약을 보존하는 리팩터 방향을 변경하고, 불필요한 제약을 제거하여 Shadow 매매부터 다시 시작하도록 지시했다. 기존 Shadow 실행기는 slot/sector 검사, 자동 손절·목표, 승인 경로와 연결되어 있다. 기존 원장에 새 실험을 넣으면 과거 exit 규칙과 연속손실 기반 정지·레짐 강등 및 학습 writer가 다시 적용된다.

## Decision

1. SHADOW 모드의 기본 스캔은 새 paper runner를 사용한다. 기존 preflight, Gate 점수, 레짐, Kelly, 포지션·섹터 한도, 승인 큐 및 학습 승격 조건을 경유하지 않는다. 새 opt-in flag를 추가하지 않는다. LIVE/PAPER 브로커 모드는 기존 실행 경로에 남는다.
2. 현재 관심종목, 관측 뉴스의 관련 종목, 열린 실험의 종목을 합쳐 단일 관측 snapshot을 만든다. 기존 데이터 collector를 재사용한다. 새로운 점수나 전략 조건으로 후보를 탈락시키지 않는다. 이 범위가 KRX 전체 종목의 무제한 수집을 뜻하지는 않는다.
3. 첫 전략 `shadow-baseline-v1`은 유효한 장중 가격을 관측한 종목을 거래일별 1회, 1주 단위로 모의 매수한다. 계좌 자산·슬롯·섹터 비중은 입력이 아니다. 종목·거래일 ID는 동일 실험의 중복 체결만 방지한다.
4. 뉴스와 추세는 허가 조건이 아닌 관측 feature다. 당시 알 수 있었던 뉴스의 ID·제목·관측 시각·출처 및 가격 추세를 기록한다. 사후 뉴스 성과나 전역 학습 가중치를 입력에 넣지 않는다.
5. D1/D3/D5는 진입일 이후 정확한 거래일의 실측 종가로 평가한다. 결손 날짜를 다음 가격으로 대체하지 않고, 아직 사용 가능한 시각이 되지 않은 종가도 사용하지 않는다. 비용·슬리피지 모델은 진입에 고정한다. D5 성숙 시 완료하며, 미성숙 결과는 0%가 아니다.
6. 새 원장 `paper-experiments.json`을 사용한다. 기존 거래 기록은 삭제하거나 새 실험으로 재해석하지 않는다. 새 결과는 독립 실험 평균으로 집계하며 실제 계좌의 포트폴리오 수익률로 표시하지 않는다. 기존 전역 weight·레짐·자동 정지 상태를 쓰지 않는다.
7. 스케줄·공개 스캔·수동 API·실제 Shadow 화면을 같은 runner/read-model에 연결한다. LIVE용 emergency/enable/적응형 scan 제약이 Shadow 실험을 중단시키지 않는다. 명시적인 사용자 일시정지는 존중한다. 관측이 불가능할 때는 실패/대기를 기록하고 가짜 체결을 만들지 않는다.
8. 실행 모드는 기존 canonical `getExecutionMode()` 한 곳에서 결정한다. 별도 `RUNTIME_MODE` override를 제거하고 legacy getter/setter도 같은 상태를 사용한다. canonical OFF는 SHADOW이며 legacy MANUAL도 이 모드로 통합한다. 화면 표시와 실제 dispatch가 서로 다른 모드를 보지 않게 한다.

## Consequences

실험이 쌓이기 전에 여러 전략 제약을 가정하지 않는다. 뉴스·추세별 성과를 보고 후속 진입/청산 전략을 설계할 수 있다. 첫 버전은 전체 후보의 기준 실험이며 검증된 수익 전략이나 자동 LIVE 승격 장치가 아니다.

새 원장의 기록 정확성, 재시작 복원, 중복 실행 방지와 표본 시각은 유지한다. 이는 레짐·Kelly 같은 매매 정책을 되살리는 조건이 아니다. 기존 모듈을 전부 물리적으로 삭제하지 않아도 새 실행 경로에서 그 제약을 제외할 수 있다.

## Alternatives Considered

- 기존 Shadow 실행기에 큰 슬롯/섹터 한도를 주기: 숨은 제약과 exit/learning 결합이 남는다.
- 구 원장에 lane 필드만 추가하기: 모든 기존 reader/writer를 수정해야 하며 누락 시 새 실험이 옛 정책을 받는다.
- flag를 추가하여 별도 관측만 수행하기: 기존 Shadow 기본 경로를 대체하지 못한다.
- 후보 중 점수가 높은 것만 실험하기: 초기부터 표본을 선택해 제약의 유효성을 평가하기 어렵다.

## Validation

실측 가격·장중 진입, 종목/거래일 중복, 재시작, exact-date 미래 종가, 미성숙/결손 처리, 비용 모델 고정, 뉴스 cutoff, 전역 정책 상태 불변, SHADOW 기본 분기 및 API/화면 연결을 검증한다. 실제 서버나 브로커 주문은 검증 과정에서 실행하지 않는다.

## References

- [공유 계약](../../src/types/paperExperiment.ts)
- [모듈 경계](../../ARCHITECTURE.md)
- [선행 사이징 경로 정리](0665-entry-sizing-single-path.md)
