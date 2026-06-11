# ADR-0603: 미국 지수의 KIS-primary 승격 — SPX Yahoo→KIS 해외지수 일봉 + NDX 관측 수집

@responsibility policy — 레짐이 이미 소비 중인 SPX(1d/20d)의 소스를 Yahoo(L3)에서 KIS 공식 해외지수 일봉(FHKST03030100)으로 승격하고(Yahoo 는 최후 fallback 강등, ADR-0561 정합), 나스닥100 을 관측 전용으로 동반 수집해 미국 선행지수↔한국 레짐 연결 강화의 데이터 기반을 연다

## Status

Accepted (1단계 구현 — default ON `!== 'false'` · Yahoo fallback 보존)

## Context — 2026-06-11 가능성 검토("미국 선행지수↔한국 지수 연결")

연결은 이미 부분 존재: `regimeBridge.ts:47` usOvernightBoost(spxDayReturn>+1.5%→MHS+10) ·
MHS 합성식(spx20d×2·dxy5d×−2·vix 페널티) · `regimeEngine.ts:203/216/229` 레짐 분류 직접 조건.
약점 2가지 — ① 소스가 Yahoo(L3)인데 레짐(=Kelly·게이트 영향 경로)이 소비, ② 나스닥100(한국
성장주 상관 우위)·반도체(SOX) 미사용. 공식 open-trading-api 로 **KIS 해외지수 일봉 지원 확정**
(`overseas-price/inquire-daily-chartprice`, `N: 해외지수` — 다우30/나스닥100/S&P500 명시).

## Decision

### 1단계 (구현) — 소스 승격 + 관측 수집

- 신규 `kisClient/query/overseasIndex.ts` — `fetchKisOverseasIndexDaily(code)` (TR FHKST03030100,
  단일통로 realDataKisGet 경유·'LOW' 우선순위). **지수×KST일자 메모 캐시** — 미국 일봉은 한국
  장중 불변이므로 quota ~지수당 1콜/일. 실패는 당일 재시도 억제 + null 반환.
- `refreshSpxSection` — **KIS 우선, 실패 시 기존 Yahoo(^GSPC) fallback 그대로** (소비식
  spxDayReturn/spx20dReturn 무변경 — 소스 등급만 승격, 로그에 KIS/YAHOO_FALLBACK source 표기).
- **NDX 관측**: `macroState.ndxDayReturn/ndx20dReturn` additive 수집(레짐 미소비 — 한국
  성장주·코스닥 상관의 실증 데이터 축적용). ISCD 는 ENV 정정 가능
  (`KIS_OVERSEAS_SPX_ISCD`/`KIS_OVERSEAS_NDX_ISCD`, default 'SPX'/'NDX' — 마스터 코드 상이 시
  재배포 없이 교정, 미일치 시 null→fallback 으로 무해).

### 2/3단계 (미구현 — 검토 문서 로드맵)

② usOvernight 레짐 학습 stratify(미국 야간 밴드별 한국 익일 수익 실측 — 상관 가정 금지) →
③ 데이터 확인 후 게이트 반영 ADR: 야간 급락 개장 전 보수 강등(ADR-0592/0593 상방 fast-path 의
미국판 대칭) · ADR-0593 fast-upgrade 보조 AND · Gate2 반도체 섹터축 SOXX r20 보조(SOX 는 해외지수
API 미지원 — 해외주식 시세로 SOXX ETF 우회). FOMC/VIX 중복 계상 주의(신규 입력은 가중 아닌
게이트형) · lookahead 금지(전일 종가만).

## Guardrails

- kisClient 단일통로(raw REST 0) · 레짐 소비식 0줄 변경(값 소스만 교체) · NDX 는 기록 전용 ·
  결손→신호 변환 0 (실패 시 fallback/생략, 불변식 #6).

## Rollback

`KIS_OVERSEAS_INDEX_DAILY_ENABLED=false` 1줄 → 전 호출 null → Yahoo 경로 100% 복원.

## References

- 가능성 검토 2026-06-11 · ADR-0561(KIS Primary Absolute — Yahoo 최후 fallback) ·
  공식 API `overseas_stock/inquire_daily_chartprice`(N: 해외지수, ovrs_nmix_* 필드) ·
  `regimeBridge.ts:27-47`·`regimeEngine.ts:203-229`(기존 SPX 소비) · ADR-0592/0593(대칭 선례)
