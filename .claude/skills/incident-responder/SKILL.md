---
name: incident-responder
description: "QuantMaster Pro 운영 인시던트 진단 보조. Telegram CRITICAL/에러 알림, Pre-Market Smoke Test 실패, Mutation Canary 실패, Shadow 격리·Kill Switch 관련 상황이 질문/보고되면 즉시 이 스킬을 호출한다."
---

# Incident Responder

`docs/incident-playbook.md` 를 자동 로드해 의사결정 트리대로 분류·진단·권고를 생성한다.
실제 복구 조치(env 변경, redeploy, setEmergencyStop 토글)는 **사용자 명시 승인 후에만** 수행.

## 언제 사용하는가

사용자 문장에 다음 신호가 포함될 때:
- "Telegram CRITICAL", "봇이 에러 보냄", "알림 왔어"
- "Smoke test 실패", "Pre-Market 실패"
- "Mutation Canary", "shadow 격리", "incidentFlag"
- "AUTO_TRADE_ENABLED", "kill switch", "긴급 중단"
- "reconcile", "캘리브레이션 스킵"

## Phase 0 — 플레이북 로드

1. `docs/incident-playbook.md` 읽기 (필수)
2. `server/trading/preOrderGuard.ts`, `server/persistence/incidentLogRepo.ts`,
   `server/alerts/contaminationBlastRadius.ts` 등 "관련 모듈" 섹션의 파일을 필요에 따라 확인
3. 사용자가 제공한 알림 내용을 playbook 의사결정 트리 노드에 매핑

## Phase 1 — 분류

트리 노드별 질문을 순서대로 사용자에게 확인:

1. **Q1**: 주문이 이미 LIVE 로 나갔는가? (Blast Radius "영향받은 Active")
2. **Q2** (LIVE 나감): `cancelAllPendingOrders()` 자동 취소 결과는?
3. **Q3**: 오염 샘플 수 (Blast Radius "생성된 Shadow")는 5건 이상인가?
4. **Q4**: 캘리브레이션 D-2 이내인가?

각 답에 따라 playbook 의 2-A / 2-B / 3 / 4 / 5 절차를 안내.

## Phase 2 — 진단 리포트 생성

아래 포맷으로 요약을 사용자에게 제시 (복구 실행 전):

```
## 인시던트 진단 — {YYYY-MM-DD HH:MM}

**분류**: <2-A LIVE 나감 | 2-B 사전 차단 | 기타>
**Blast Radius**: 활성 주문 N건 / 오염 Shadow M건
**자동 조치 상태**:
  - incident-log.json 기록됨 ✅/❓
  - setEmergencyStop(true) ✅/❓
  - cancelAllPendingOrders() ✅/❓

**권고 조치 순서**:
  1. ...
  2. ...
  3. ...

**재개 체크리스트** (playbook Phase 5 준수):
  - [ ] Mutation Canary 마지막 결과 PASS
  - [ ] incident-log 마지막 엔트리가 2h+ 과거
  - [ ] snapshots/ 복원 가능
  - [ ] orchestrator-state.json tradingDate 최신
  - [ ] Pre-Market Smoke Test 08:45 KST 통과

**안티패턴 주의**:
  - shadow-trades.json 수동 편집 ❌
  - 부분 스킵(주말만) ❌
  - 스모크 실패 상태에서 AUTO_TRADE_ENABLED=true ❌
```

## Phase 3 — 원인 분석 (코드 레벨)

로그·스택트레이스가 제공되면:
1. 해당 파일의 @responsibility 태그 확인 → 경계 위반 여부
2. 유사 패턴이 다른 모듈에 있는지 Grep
3. `scripts/silent_degradation_sentinel.js` 가 놓친 swallowed catch 가 있는지 확인
4. 근본 원인이 드러나면 `quantmaster-orchestrator` 로 인계하여 수정 PR 착수

## Phase 4 — 실행 (승인 필수)

다음 조치는 모두 **사용자 명시 승인** 후에만 수행:
- `.env` 또는 Railway 환경변수 변경 권고 메시지 생성
- redeploy 명령 가이드 (실제 실행은 사용자)
- `setEmergencyStop(false)` 호출 PR 작성
- 인시던트 플레이북에 누락된 케이스 추가 PR

## 금지 사항

- `shadow-trades.json`, `incident-log.json`, `snapshots/` 파일 직접 수정
- reconciliation 상태를 우회하는 어떤 조작
- Telegram 봇 설정 (웹훅 URL 등) 직접 변경
- 플레이북 절차를 건너뛰는 "빠른 복구" 시도

## 재호출 지침

같은 인시던트에 대한 후속 대화에서 재호출 시, `_workspace/incident-{timestamp}/`에
남긴 진단 리포트를 먼저 읽고 이후 단계만 진행한다.
