# FRED Relay — Railway↔Akamai egress 우회 (FRED 복구)

> 목적: 배포지(Railway)에서 `api.stlouisfed.org`(Akamai 엣지) 로의 TCP 가 silently drop 되어
> FRED 가 미연결(`fred=false`) 인 문제를, **다른 네트워크(Cloudflare)에서 대신 호출하는 릴레이**로 우회한다.
> 근본 원인 진단·근거: ADR-0583 / 메모리 `fred-ecos-connectivity`. **서버 코드 변경 0줄** — `FRED_API_BASE`
> env 만 릴레이 URL 로 바꾸면 `fredClient` 의 모든 호출·`/macro_source_probe` 가 자동으로 릴레이 경유.

## 왜 릴레이인가

- 실측: DNS 는 정상 resolve(dnsV4=23.15.108.195 Akamai), **TCP 만 hang**(timeout, RST 아님).
- ECOS(한국)는 정상 → Railway 가 *모든* egress 를 막는 게 아니라 **이 목적지만** 막힘 → Akamai 가
  Railway 데이터센터 ASN 을 드롭하는 쪽이 유력.
- 릴레이는 차단 주체가 Akamai-side 든 Railway-side 든 **둘 다 우회**(가장 확실).
- Cloudflare Workers 가 아니어도 됨 — FRED 에 도달 가능한 호스트(Vercel / Deno Deploy / 작은 VPS)면
  무엇이든 OK. 아래는 무료·무카드 표준안인 Cloudflare Workers 기준.

## 배포 (Cloudflare Workers)

1. Cloudflare 계정(무료) → **Workers & Pages** → **Create** → **Create Worker**.
2. 에디터에 [`worker.js`](./worker.js) 전체를 붙여넣고 **Deploy**.
3. 배포 URL 확인 — 예: `https://fred-relay.<your-subdomain>.workers.dev`.

> CLI 선호 시: `npx wrangler deploy worker.js`(wrangler.toml 에 `name`/`main = "worker.js"`/`compatibility_date` 지정).

## 검증 (서버 연결 전 — Worker 단독)

```
curl "https://fred-relay.<sub>.workers.dev/fred/series/observations?series_id=T10Y2Y&api_key=<FRED_API_KEY>&file_type=json&sort_order=desc&limit=1"
```
- 기대: `{"observations":[{...,"value":"..."}]}` JSON. → 릴레이가 FRED 에 도달 성공.
- 404 면 path 오타(`/fred/` 로 시작해야 함). HTTP 4xx + 에러 본문이면 키 문제.

## 서버 연결

> ⚠️ **`<sub>` 는 placeholder다 — 그대로 복사하지 말 것.** 위 배포 3단계에서 대시보드에 표시된
> *실제* 서브도메인(계정마다 다름)으로 반드시 치환한다. `<`, `>` 가 남아 있으면 URL 파싱 실패로
> `/macro_source_probe` 가 `CONFIG_ERROR — BAD_FRED_API_BASE` 를 반환한다.

1. Railway → 해당 서비스 → **Variables** 에 추가(따옴표·끝슬래시 없이, `<sub>` → 실제 값):
   ```
   FRED_API_BASE=https://fred-relay.your-actual-subdomain.workers.dev
   ```
2. 서비스 재배포/재시작 (env 반영).
3. **인밴드 검증** — 텔레그램 `/macro_source_probe`:
   - 기대: `FRED verdict=OK · reachedNetwork=true · httpStatus=200 · observationCount>0`,
     `dnsV4` 가 Cloudflare 대역으로 표시.
4. **MHS 확인** — `/refresh_macro` 후 `/regime`:
   - 기대: `🛰 MHS 신뢰도: FULL (ecos=✅ fred=✅)` (다음 refresh 사이클 반영, 장중 3분 cron).

## 롤백

- Railway 에서 `FRED_API_BASE` 변수 **삭제** → 서버가 즉시 `api.stlouisfed.org` 직결로 복귀
  (default 분기, byte-equivalent). Worker 는 그대로 둬도 무해.

## (선택) 하드닝 — 나중에

MVP 는 클라이언트(서버)가 `api_key` 를 쿼리에 실어 보내고 Worker 는 투명 포워딩한다. 키가
서버→Worker 한 홉을 더 거치므로(둘 다 HTTPS), 더 잠그려면:

1. **키를 Worker 로 이전**: Worker 에 secret `FRED_API_KEY` 설정 + 서버가 URL 에 키를 빼고 전송
   (`fredClient` 에서 `api_key` 미부착 분기 — 작은 서버 수정 필요). Worker 5)번 분기가 키 주입.
2. **공유 시크릿 게이트**: Worker 에 `RELAY_SHARED_SECRET` 설정 + 서버가 `X-Relay-Secret` 헤더 전송
   (`fredClient` fetch 헤더 1줄 추가 — 작은 서버 수정 필요). 임의 제3자의 릴레이 사용 차단.

두 하드닝 모두 후속 작업(서버 코드 1~2줄). 본 릴레이 자체는 `/fred/*` path 만 포워딩하고 FRED
데이터는 공개 데이터라, MVP 단계에서도 노출 위험은 낮음(우리 키는 서버→Worker 호출에만 존재).

## 대안 경로 (릴레이가 막힐 경우)

- Railway **리전 변경** 후 `/macro_source_probe` 재실행(코드 0). ASN 전체 차단이면 무효.
- `fred.stlouisfed.org` **CSV 엔드포인트**(`/graph/fredgraph.csv?id=...`)가 다른 엣지면 도달 가능 —
  되면 CSV 파서로 전환(소규모 서버 수정).
- 시리즈별 **대체 출처**(SOFR=NY Fed `markets.newyorkfed.org` / T10Y2Y=Treasury) — FRED 의존 제거,
  작업량 큼.
- 못 고쳐도 **ADR-0583 degrade 처리**가 안전망(MHS 반쪽임 가시화 + flag 로 낙관 억제).
