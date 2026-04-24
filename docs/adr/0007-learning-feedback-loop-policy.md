# ADR-0007: 학습 모듈 폐쇄루프 정책 — 하이브리드 (수동 승인)

- 상태: 채택
- 날짜: 2026-04-24
- 작성: QuantMaster Harness (architect)
- 선행: ADR-0005 (STRONG_BUY/Telegram trim), ADR-0006 (Attribution 복합키)
- 관련 PR: PR-22

## 배경

사용자 자기루프 감사 결과, 4개 학습 모듈은 데이터 쌓기·결론 산출까지는 정상
동작하지만 **결론이 Gate/Kelly/레짐 가중치로 피드백되지 않는다**. 운영자가 매번
텔레그램 명령으로 꺼내 보고 수동 판단해야 한다.

| 모듈 | 현재 소비자 | 닫혀 있지 않은 지점 |
|------|-------------|---------------------|
| `counterfactualShadow` | `/counterfactual` 명령 | Gate 과잉 여부의 통계적 증거가 운영자 머릿속에만 |
| `ledgerSimulator` | `/universe` 명령 | off-policy 대안의 우세가 발견돼도 실제 사이징·TP/SL 에 반영 안 됨 |
| `kellySurfaceMap` | `/kelly_surface` (형식) | Kelly 표면 최대점과 현재 운용점 괴리 발견돼도 자동 조정 없음 |
| `regimeBalancedSampler` | `/regime_coverage` | 부족 레짐 경고가 학습 샘플 수집 스케줄러에 feedback 안 됨 |

## 결정

**전부 하이브리드**. 자동 closed-loop 는 이번 PR 에서 채택하지 않는다.

이유:
1. 모든 학습 모듈이 아직 ESS·coverage 가 통계적 유의성 임계 미달. 섣부른 자동
   반영은 작은 샘플에서 Gate/Kelly 를 크게 흔드는 리스크.
2. 이 모듈들은 "감사 도구" 성격이 강함. 감사 결과를 자동으로 집행하면 오히려
   감시 레이어가 실행 레이어를 흔드는 모순.
3. 운영자 개입 지점이 1곳 있어야 회귀 시 원복 지점이 명확.

### 공통 파이프라인

각 모듈은 내부에 `evaluateSuggestion()` 을 추가한다:

1. **데이터 로드**: 기존 해상도 결과 (`resolveCounterfactuals` 등).
2. **임계 체크**: 아래 "모듈별 임계" 를 전부 만족해야 suggest.
3. **Dedupe**: 같은 모듈의 같은 signature 는 24h 내 1회만 송출 (`aiCacheRepo`
   기반 또는 자체 JSON 링버퍼).
4. **Feature flag**: `process.env.LEARNING_SUGGEST_ENABLED !== 'false'` 일 때만
   활성 (기본 on). 긴급 차단용 `LEARNING_SUGGEST_ENABLED=false` 로 즉시 off.
5. **알림 송출**: `sendSuggestAlert({ moduleKey, title, rationale, suggested,
   currentValue, threshold })` 공통 포매터로 `TELEGRAM_CHAT_ID` 전송.
6. **운영자 응답**: 이번 PR 에서는 "알림만". 수동 반영 명령 (`/accept-suggest
   <id>`) 은 Phase 2 로 유보.

호출 지점은 `scheduler/learningJobs.ts` 의 기존 resolve 후크 직후. 해상도가
업데이트된 후에만 임계 체크가 의미가 있다.

### 모듈별 임계 (의도적으로 보수적)

| 모듈 | 발동 조건 (모두 AND) | 알림 내용 |
|------|---------------------|-----------|
| `counterfactualShadow` | sample ≥ 30 · return30d 집계 완료 · 탈락 후보 평균 수익 > 통과 후보 평균 수익 × 0.8 | "Gate 과잉 가능성: 탈락 후보 상위 N개 평균 수익이 통과 후보의 80% 이상" |
| `ledgerSimulator` | resolved universe 쌍 ≥ 30 · 대안 정책 누적 수익이 실제 정책 +5%p 이상 · 대안의 MaxDD ≤ 실제 | "Universe B/C 이 A 대비 우세 — Kelly 배율 검토 권고" |
| `kellySurfaceMap` | 셀 sample ≥ 20 · 95% CI 폭 ≤ 10%p · (p̂, b̂) 이 현재 배율 대비 |Δ Kelly| ≥ 0.5 | "신호 카테고리 X 의 표면 최대점과 현재 배율 괴리" |
| `regimeBalancedSampler` | 특정 레짐 sample < target × 0.5 · 최근 30일 진입 0건 | "레짐 X 샘플 부족 — 데이터 수집 스케줄 확대 권고" |

수치는 ADR 가이드. 구현 단계에서 상수화하여 `server/learning/suggestThresholds.ts`
에 단일 SSOT 로 모은다.

## Dead Code 처분 (Appendix)

- **`syntheticReplay.ts` (153줄) — 삭제.** 파일 작성 이후 `server/`, `src/`,
  `scripts/` 어디에서도 import 된 적 없음. "Idea 8 reduced scope" 초안 상태로
  남아 있고, 내부 히스토리 기반 유사도 매칭 기능은 현재 운영 요구에 없음. 필요
  시 `failurePatternDB` 경로로 대체 가능.
- **`newsLagBayesian.ts` — 유지.** `newsSupplyLogger.ts:30` 에서 static import
  (`recordLagObservation`, `inferLagFromTSeries`), `telegram/webhookHandler.ts:1481`
  에서 dynamic import (`listAllOptimalWindows`) 로 현역이다. 사용자 자기루프
  분석의 해당 항목은 오탐. 본 PR scope 에서 제외.

## 후속 과제

1. **Phase 2 — 수동 승인 명령** (`/accept-suggest <id>`): 운영자가 알림을 승인
   하면 해당 모듈의 권고값을 Gate/Kelly/레짐 스케줄러에 단발 적용. 승인 전
   상태는 "알림만".
2. **자동 반영 재검토**: 각 모듈의 sample 이 현 임계의 3배를 안정적으로 초과한
   이후에만 자동 모드 전환 논의. 별도 ADR.
3. **알림 중복 방지 정식 지원**: `aiCacheRepo` 와 유사한 suggest 전용 JSON
   링버퍼를 도입해 signature 기반 dedupe. 이번 PR 은 메모리 1시간 캐시로 MVP.

## 검증

- 신규 테스트 `server/learning/suggestThresholds.test.ts`:
  - 각 모듈 no-op 보장 (sample 부족 시)
  - 임계 충족 시 `sendSuggestAlert` 1회 호출
  - 24h dedupe (동일 signature 2회 호출 시 1회만 송출)
  - `LEARNING_SUGGEST_ENABLED=false` 시 no-op
- `syntheticReplay.test.ts` 존재 여부 확인 후 함께 삭제.

## 롤백

- `LEARNING_SUGGEST_ENABLED=false` 환경변수 배포로 즉시 차단.
- 파일 레벨 롤백 시 `suggestNotifier` import 제거 + 각 모듈의 `evaluateSuggestion`
  호출만 주석 처리. 기록 경로 (`recordCounterfactual` 등) 는 영향 없음.
