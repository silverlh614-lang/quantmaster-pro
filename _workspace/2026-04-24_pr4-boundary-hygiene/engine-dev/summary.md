# PR-4 engine-dev 산출물 요약

## 변경 파일 (3개)
- `server/emergency.ts` — 전체 재작성. raw fetch 2곳 제거 → `kisGet`/`kisPost` 경유.
- `server/trading/regimeBridge.ts` — dedupeKey 2곳 `regime-change-down-${regime}` / `regime-change-up-${regime}` 로 분리.
- `docs/adr/0004-yahoo-adr-deprecation.md` — Scope Clarification 섹션 추가. Yahoo KOSPI 도메스틱 호출은 본 ADR 범위 밖임을 명시하고 후속 PR 과제로 기록.

## 이슈별 해결

### A. emergency.ts — kisClient 단일 통로 규칙 준수
- `cancelAllPendingOrders()` 내부의 raw `fetch()` 2개(미체결 조회 + 취소 주문) 제거.
- `kisGet(inquireTr, ...)` / `kisPost(cancelTr, ...)` 경유. 결과로 자동 적용:
  - 토큰 자동 갱신
  - 서킷 브레이커
  - 레이트 리미터(토큰 버킷)
  - LIVE/VTS TR ID 모드 호환성 검증(`assertModeCompatible`)
- @responsibility 태그 추가 (25단어 이내).

### B. regime-change dedupeKey 충돌
- 기존: `dedupeKey: \`regime-change-${currentRegime}\`` (up/down 공통).
- 수정: `regime-change-down-${regime}` vs `regime-change-up-${regime}` 분리.
- 효과: 같은 regime 수준에서 단시간 내 up↔down 교차 시 한쪽 알림을 dedupe 가 덮어쓰는 사례 차단.

### C. Yahoo KOSPI 호출 — 재분류 (코드 변경 없음)
- 남은 `fetchYahooQuote('{code}.KS'/'KQ')` 호출 6개 지점(`reportGenerator`, `stockPickReporter`, `intradayScanner`, `universeScanner`, `prefetchedContext`, `shadowDataGate`) 은 KOSPI/KOSDAQ 도메스틱 시세 소스로 ADR OTC 문제와 무관.
- ADR-0004 에 Scope Clarification 섹션으로 명문화. 후속 PR(KIS 일봉 기반 지표 재구현) 로 이관.

## 검증
- `npm run lint` 클라 + 서버 모두 통과.
- `npm run validate:all` 전부 OK.
  - responsibility WARN 623→622 (emergency.ts @responsibility 추가로 감소).
  - SDS WARN 4 baseline 유지.
- 테스트: 12개 파일 67/67 pass (회귀 없음).
- 경계 교차 비교:
  - `grep "fetch(" server/emergency.ts` → 0건 ✅
  - `grep "regime-change-" server/` → 4곳(코드 2 + 주석 2), 모두 방향별 분리 ✅

## 회귀 리스크
- `kisGet`/`kisPost` 는 서킷 차단 시 throw/null 반환 — emergency 경로에서 이를 catch 하지 못하면 비상정지 전체 실패. → 현 코드는 함수 전체를 try/catch 로 감싸고 로깅 후 진행하므로 문제 없음.
- dedupeKey 변경으로 저장된 기존 `regime-change-${regime}` dedupe 상태와 불일치 — 배포 직후 이전 regime up→down 전환 건은 1회 추가 알림 나갈 수 있음 (목적에 부합, 해가 없음).

## 남은 P1+ 이슈 (다음 PR 후보)
- **D**. `webhookHandler.ts` 1,758줄 분해 (server-refactor-orchestrator).
- **E**. `setInterval` 10+ 개소 → TanStack Query `refetchInterval` 통합.
- **F**. `.catch(() => null)` 98건 sweep + SDS-ignore 태깅 정책화.
- **G**. `process.env.KIS_APP_KEY!` non-null assertion 10+ 곳 → 부팅 시 `assertRequiredEnv()` fail-fast.
- **H**. `: any` / `as any` 173+82건 점진 타이핑 — Express Request/Response 부터.
- **I**. Yahoo KOSPI → KIS 지표 재구현 (ADR-0004 후속).

## quality-guard 체크포인트
1. lint ✅
2. validate:all ✅ (WARN 감소)
3. 회귀 67/67 ✅
4. 경계: kisClient 단일 통로 준수 ✅
5. precommit — 배포 창 차단 중 (16:30 이후)
