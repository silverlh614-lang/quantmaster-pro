---
name: server-refactor-orchestrator
description: "QuantMaster Pro 1,000줄+ 서버 파일(signalScanner, webhookHandler, stockScreener, exitEngine 등) 분해 전용 오케스트레이터. 대형 파일 리팩토링 요청 시 사용한다."
---

# Server Refactor Orchestrator

`scripts/check_complexity.js` 임계를 초과한 대형 서버 파일을 안전하게 분해한다.
메인 `quantmaster-orchestrator` 와 다른 점: **구현보다 scaffolding·경계 분리가 선행**되며
architect가 전체 설계를 먼저 확정한다.

## 현재 대상 (CLAUDE.md 동기화)

| 파일 | 줄 수 | 우선순위 | 기대 분해 방향 |
|------|------:|----------|------------------|
| `server/trading/signalScanner.ts` | 1,820 | P0 | marketScan / conditionEval / orderDispatch / index |
| `server/telegram/webhookHandler.ts` | 1,700 | P1 | 명령 라우터 / 버튼 콜백 / 메시지 포매터 / 세션 스토어 |
| `server/screener/stockScreener.ts` | 1,571 | P1 | universe / scoring / ranking / report |
| `server/trading/exitEngine.ts` | 1,233 | P2 | trigger / sizing / execution / reconciliation |

## Phase 0 — 사전 확인

1. 대상 파일의 정확한 현재 줄 수 재측정 (`wc -l`)
2. 대상 파일에 붙어 있는 `*.test.ts` 회귀 커버리지 확인
3. ADR이 이미 존재하는지 확인: `docs/adr/NNNN-<target>-decomposition.md`
   - 있으면 ADR 결정을 따름
   - 없으면 **Phase 1에서 ADR 먼저 작성**

## Phase 1 — ADR 작성 (architect)

`docs/adr/NNNN-<target>-decomposition.md` 생성. 섹션:

- **Context**: 현재 파일이 왜 비대해졌는가, 어떤 책임들이 섞여 있는가
- **Decision**: 분해 후 폴더 구조 + 각 파일의 @responsibility 초안
- **Consequences**: 임포트 경로 변경, public API 유지 여부, 테스트 이동
- **Alternatives Considered**: 왜 더 작거나 더 큰 분해가 아닌지
- **Migration Plan**: (a) 파일 분리 → (b) 내부 호출 리라우트 → (c) 기존 파일은 얇은 재export → (d) 최종 삭제 시점

## Phase 2 — 스캐폴딩 (architect)

1. 새 폴더/파일 생성 (빈 껍데기 + `@responsibility` 태그 + 타입/시그니처)
2. `src/types/` 또는 해당 모듈 내부 공용 타입 정리
3. 원본 파일에서 이동할 함수 목록을 파일 단위로 마킹한 "이동 플랜 체크리스트"를
   `_workspace/.../refactor/plan.md` 에 남김

## Phase 3 — 순차 이동 (engine-dev)

반드시 **한 번에 한 하위 모듈**씩 이동:

1. 함수 그룹 하나를 새 파일로 이동
2. 원본 파일은 내부 re-export 유지 (외부 임포터가 깨지지 않도록)
3. 각 이동마다 `npm run lint` + 관련 테스트 실행 → 통과 후 다음 그룹 이동
4. 모든 그룹 이동이 끝나면 원본 파일이 얇아진 `index.ts` 성격이 됨

## Phase 4 — 최종 정리 (engine-dev)

1. 원본 파일을 `index.ts` 로 rename 하거나 barrel 형태로 축소
2. 외부 임포터의 경로를 `'server/trading/signalScanner'` 같이 폴더 임포트로 정리
3. 불필요한 re-export 제거

## Phase 5 — 검증 (quality-guard)

```bash
npm run lint
npm run validate:complexity   # 모든 신규 파일이 한계 내인가
npm run validate:responsibility
npm run validate:sds
npm run validate:all
npx vitest run <관련 테스트>
npm run precommit
```

**회귀 포인트 교차 비교**:
- KIS 호출 경로가 여전히 `kisClient.ts` 경유인가
- 주문 멱등성(operation_id) 로직이 깨지지 않았는가
- 스케줄러·cron·webhook 진입점이 새 경로를 정확히 참조하는가

## Phase 6 — 기록

- `CLAUDE.md` "기존 복잡도 위반" 표에서 해당 파일 제거 + 변경 이력 한 줄 추가
- `ARCHITECTURE.md` Module Boundaries 표 갱신 (분해된 하위 모듈 단일 책임 명시)
- 커밋 메시지(`refactor(signalScanner): split into 4 modules` 식)는
  `quantmaster-orchestrator` Phase 5 템플릿 그대로 사용

## 금지 사항

- 분해 중 기능 추가 금지 (리팩토링과 피처 추가 동시 진행 금지)
- Git 강제 푸시/히스토리 재작성 금지
- 테스트 미통과 상태로 중간 커밋 병합 금지
