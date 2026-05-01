# ADR-0154: Phase 4 BLOCKED 영구 정책 + 정성 4 항목 영구 DECIDED_NOT_WIRING + #12 잔여 정책 + driftGuard 결함 차단

**날짜**: 2026-05-01
**상태**: 채택
**관련 PR**: PR-Phase4-Closeout (27 조건 격상 시리즈 마무리)
**관련 ADR**:
- ADR-0011 (PR-25-A/B/C, AI 추천 KIS/KRX 분리) — #12 잔여 정책의 의존
- ADR-0046 (PR-Y1, F2W Drift Detector) — driftGuard 회귀 테스트의 기반
- ADR-0149/0150/0151/0152/0153 — 27 조건 격상 시리즈 1~3

## 문제

27 조건 격상 시리즈 (ADR-0149 ~ ADR-0153) 가 진행도 **44% → 67%** 도달 후 잔여 항목의 처리 정책 명문화 필요. 사용자 명시 *"Phase 4 진행 + 잔여 작업 마무리"* 요청에 대한 *진정한 답*:

1. **Phase 4 외부 컨센서스 (#14 earningsSurprise + #13 consensusTarget)** — 외부 source (FnGuide / WiseFn / 컨센서스 API) 부재로 격상 *불가*. PENDING_WIRING C10 BLOCKED 표기만 있고 *영구 정책* 부재.
2. **#12 institutionalBuying 잔여** — ADR-0011 정책 변경 (옵션 A) 또는 KRX 기관 순매수 데이터 신규 ADR (옵션 C) 의존. *언제 진행할지* 정책 부재.
3. **정성 4 항목 (#9/#17/#20/#26)** — DECIDED_NOT_WIRING 등재 상태이지만 *영구 정성 잔존* 정책 ADR 부재.
4. **`feedbackLoop.driftGuard` baseline 결함** — `seedDriftHistory(2026-04-26)` 후 `evaluateFeedbackLoop` 가 실시간 `Date.now()` 사용 → 시간 의존 결함. 5일 차이 누적 시 7일 윈도우 시드 일부 빠짐. PR-Phase1 / Phase2 / Phase2-Real / Phase3 모두 동일 baseline fail 무시 처리.

## 결정

### 1. Phase 4 외부 컨센서스 — BLOCKED 영구 정책 명문화

**현 상태**: PENDING_WIRING.md C10 P2 BLOCKED 등재. 본 ADR 이 *영구 정책 SSOT* 격상.

**진입 조건** (3 중 1 이상 충족 시):
- (A) FnGuide / WiseFn 등 *공식 외부 컨센서스 API* 인증 키 확보 + API 비용 정책 결정
- (B) 사용자 *수동 입력 컨센서스* 도메인 — 영속 schema (`data/manual-consensus.json`) + UI 입력 + 영업일 갱신 정책
- (C) Naver Finance 컨센서스 페이지 scraping — 무료지만 robots.txt 검토 + 안정성 위험 (HTML 변경)

**현재 결정**: 옵션 A 가장 정합 (운영 안정 + 정확성). 인증 키 확보 + 비용 정책 결정 *전까지* PENDING_WIRING C10 BLOCKED 유지. 본 ADR 후속 진행 트리거 없을 시 *영구 22% AI 추정* 영속.

**Fallback 정책**: ADR-0011 정합. #14 / #13 은 stock.checklist (Gemini AI 추정) 보존. silent degradation 차단 — 0 박제 분기 절대 금지 (ADR-0151 정합).

### 2. #12 institutionalBuying 잔여 — 옵션별 진입 조건

**현 상태**: PENDING_WIRING C8 (Phase 2 audit) 의 일부로 처리 → DECIDED_NOT_WIRING 등재. AI 추정 fallback 보존 (ADR-0151).

**진입 조건** (옵션별):
- **옵션 A**: ADR-0011 정책 변경 — KIS 기관 순매수 호출 *제한적 허용*. 진입 트리거 = (i) KIS quota 영향 평가 + (ii) 자동매매 별도 통로 격리 검토 + (iii) ADR 발행
- **옵션 C**: KRX OpenAPI 기관 순매수 데이터 — 공개 통계 (`MDCSTAT01001` 또는 동등) 사용. 진입 트리거 = (i) KRX OpenAPI 기관 데이터 endpoint 검증 + (ii) 영속 schema (foreignerRatioRepo 패턴 차용) + (iii) ADR 발행

**현재 결정**: **옵션 C 권장** (ADR-0011 정책 무영향 + 공개 데이터 + 무료). 후속 PR (별도 ADR) 진행 시 본 ADR §"옵션 C 검토 매트릭스" 참조.

### 3. 정성 5 항목 영구 DECIDED_NOT_WIRING 정책

**대상**: #9 notPreviousLeader / #13 consensusTarget (Phase 4 BLOCKED) / #17 psychologicalObjectivity / #20 elliottWaveVerified / #26 divergenceCheck

**정책**: *정량 격상 영구 불가* — AI 추정 (Gemini 의 27조건 평가) 만 사용. 이유:

| ID | 키 | 정성 영구 잔존 사유 |
|----|------|------|
| 9 | notPreviousLeader | 직전 사이클 주도주 회피 — 시점 의존 + 정성 평가 |
| 13 | consensusTarget | 외부 컨센서스 source 부재 (Phase 4 BLOCKED) — 진입 시 #13 만 격상 가능, #14 와 별도 |
| 17 | psychologicalObjectivity | 사용자 메타 인지 — 정량 대리 지표 없음 |
| 20 | elliottWaveVerified | 엘리엇 파동 분석 — 정성 (파동 카운팅) |
| 26 | divergenceCheck | 다이버전스 — 정성 (역전 판단) |

→ **영구 22% AI 추정** 잔존. 운영자가 stock.checklist 정확성 위해 *Gemini 프롬프트 품질* + *AI 추정 가중치 학습 (ADR-0149 매핑 정정)* 두 영역 집중 권장.

### 4. `feedbackLoop.driftGuard` 시간 의존 결함 차단

**결함**: `seedDriftHistory(now=2026-04-26)` 후 `evaluateFeedbackLoop` 가 실시간 `Date.now()` 사용 → 5일 차이 누적 시 7일 윈도우 시드 일부 빠짐. PR-Phase1~Phase3 시리즈 baseline fail 1건.

**수정**: 본 PR 의 `quantEngine.feedbackLoop.driftGuard.test.ts:154-168` 케이스에 `vi.useFakeTimers()` + `vi.setSystemTime(now)` 적용. 시점 고정 후 시드 + 평가 동일 시점 보장. try/finally 로 `vi.useRealTimers()` 복원 — 다른 테스트 영향 0.

**근본 해결 (후속 PR scope 외)**: `evaluateFeedbackLoop` 시그니처에 옵셔널 `now?: Date` 인자 추가 → 호출자가 명시 inject. 본 PR 은 결함 차단만 (LIVE 호출은 실시간 Date.now() 그대로).

## 영향

### 27 조건 격상 진행도 — 영구 매트릭스

| 카테고리 | 키 개수 | 비율 | 출처 |
|----------|---------|------|------|
| REAL_DATA | 9 | 33% | 클라이언트 OHLCV/지표 직접 계산 |
| DART (5 키) | 5 | 19% | DART 사업보고서 (ADR-0150) |
| Naver 외인 추세 (1 키) | 1 | 4% | ADR-0152 |
| globalIntel 합성 (3 키) | 3 | 11% | ADR-0153 |
| **격상 누적** | **18** | **67%** | — |
| #12 institutionalBuying | 1 | 4% | 옵션 A/C 후속 ADR |
| #14 earningsSurprise | 1 | 4% | Phase 4 BLOCKED |
| 정성 영구 잔존 (5 키) | 5 | 19% | DECIDED_NOT_WIRING (#9/#13/#17/#20/#26) |
| **영구 진행도 한계** | **27** | **100%** | — |

**최대 가능 진행도**: 옵션 C (#12 격상) 진행 시 **70% (19개)**. Phase 4 (옵션 A) 진행 시 **74% (20개)**. #14 단독 진행 시 (옵션 A 또는 사용자 수동 입력) **74%**. 정성 5 키는 **영구 22% AI 추정 잔존**.

### LIVE 매매 영향

- 본 PR — driftGuard 회귀 테스트 1건 정합화. LIVE 매매 본체 0줄 변경.
- 27 조건 격상 시리즈 누적 영향 — 신규 매수 시점부터 18 키 정량 영속, 9 키 AI 추정 (5 정성 영구 + 4 후속 ADR 의존).

## 회귀 테스트

- driftGuard `vi.useFakeTimers` 적용 — 8/8 pass.
- ADR-0154 자체 회귀 테스트 — 정책 SSOT 라 별도 신규 회귀 부재 (markdown).

## ENV 우회

본 PR 미도입. 정책 SSOT — ADR 갱신으로 진행.

## 잔여 (영구 후속 — 본 PR scope 외)

- **#12 옵션 C** (KRX OpenAPI 기관 순매수) — 별도 ADR + foreignerRatioRepo 패턴 차용
- **Phase 4 옵션 A** (FnGuide/WiseFn) — 인증 키 + 비용 정책 결정 후 별도 ADR
- **driftGuard 근본 해결** — `evaluateFeedbackLoop` 옵셔널 `now?: Date` 인자 (별도 PR — LIVE 매매 영향 평가 필요)
- **AI 추정 가중치 학습** — ADR-0149 매핑 정정 후 신규 매수 30일 누적 후 attribution 가중치 자연 정합화
