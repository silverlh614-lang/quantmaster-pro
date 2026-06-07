// @responsibility FRED relay worker — Cloudflare Worker transparent reverse-proxy to api.stlouisfed.org (Railway↔Akamai egress 우회).
//
// 배경: 배포지(Railway)에서 api.stlouisfed.org(Akamai 엣지)로의 TCP 가 silently drop 되어
// FRED 미연결([[fred-ecos-connectivity]], ADR-0583). DNS 는 정상 resolve 되나 TCP hang =
// Railway egress 또는 Akamai 의 datacenter-ASN 차단. 둘 다 "다른 네트워크에서 대신 호출"로 우회.
//
// 동작: 서버가 FRED_API_BASE=https://<this-worker>.workers.dev 로 부르면, fredClient 이 만든
// `/fred/series/observations?series_id=...&api_key=...&file_type=json...` 경로+쿼리를 그대로
// api.stlouisfed.org 로 1:1 포워딩하고 응답(상태코드 포함)을 되돌린다. 서버 코드 변경 0줄.
//
// 배포: Cloudflare 대시보드 → Workers → Create → 본 파일 붙여넣기 → Deploy. (또는 wrangler deploy)
// 검증/롤백/하드닝은 같은 폴더 README.md 참조.

const FRED_ORIGIN = 'https://api.stlouisfed.org';

export default {
  async fetch(request, env) {
    const inUrl = new URL(request.url);

    // 1) GET 만 허용 (FRED observations 는 GET).
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // 2) open-proxy 남용 차단 — 우리가 쓰는 /fred/* surface 만 포워딩.
    if (!inUrl.pathname.startsWith('/fred/')) {
      return new Response('Not Found', { status: 404 });
    }

    // 3) (선택) 공유 시크릿 게이트 — env.RELAY_SHARED_SECRET 설정 시 X-Relay-Secret 헤더 일치 요구.
    //    서버가 헤더를 보내야 하므로 fredClient 1줄 수정 필요(하드닝, README 참조). 미설정 시 통과.
    if (env && env.RELAY_SHARED_SECRET) {
      if (request.headers.get('x-relay-secret') !== env.RELAY_SHARED_SECRET) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    // 4) 대상 URL = api.stlouisfed.org + 동일 path + 동일 query.
    const target = new URL(FRED_ORIGIN);
    target.pathname = inUrl.pathname;
    target.search = inUrl.search;

    // 5) (선택) 키 주입 — Worker secret env.FRED_API_KEY 가 있고 클라가 키를 안 보냈을 때만.
    //    하드닝 모드(클라가 키를 URL 에 안 싣고 Worker 가 주입)에서만 발동. MVP(클라가 키 포함)에선 no-op.
    if (env && env.FRED_API_KEY && !target.searchParams.get('api_key')) {
      target.searchParams.set('api_key', env.FRED_API_KEY);
    }

    try {
      const upstream = await fetch(target.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
        // FRED quota 보호용 짧은 엣지 캐시(5분) — fredClient 자체 캐시(5분)와 정합.
        cf: { cacheTtl: 300, cacheEverything: true },
      });

      const body = await upstream.arrayBuffer();
      return new Response(body, {
        status: upstream.status,
        headers: {
          'content-type': upstream.headers.get('content-type') ?? 'application/json',
          'x-fred-relay': 'cloudflare-worker',
        },
      });
    } catch (e) {
      // Worker→FRED 단계 실패(드묾) — 502 로 명시(서버 probe 가 HTTP_502 로 인지).
      return new Response(
        JSON.stringify({ error: 'relay_upstream_failed', detail: String(e && e.message ? e.message : e) }),
        { status: 502, headers: { 'content-type': 'application/json', 'x-fred-relay': 'cloudflare-worker' } },
      );
    }
  },
};
