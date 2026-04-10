// server/clients/kisClient.ts
// KIS (한국투자증권) API 클라이언트 — 토큰 관리 및 공용 HTTP 헬퍼

let kisToken: { token: string; expiry: number } | null = null;

export function getKisBase(): string {
  const isReal = process.env.KIS_IS_REAL === 'true';
  return isReal
    ? 'https://openapi.koreainvestment.com:9443'
    : 'https://openapivts.koreainvestment.com:29443';
}

export async function getKisToken(): Promise<string> {
  if (kisToken && Date.now() < kisToken.expiry) return kisToken.token;
  const base = getKisBase();
  const res = await fetch(`${base}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`KIS 토큰 발급 실패: ${JSON.stringify(data)}`);
  kisToken = { token: data.access_token, expiry: Date.now() + 23 * 60 * 60 * 1000 };
  console.log('KIS 토큰 발급 완료');
  return kisToken.token;
}

/** 토큰 만료까지 남은 시간(시간 단위). 토큰 미발급 시 0 반환 */
export function getKisTokenRemainingHours(): number {
  if (!kisToken) return 0;
  return Math.floor((kisToken.expiry - Date.now()) / 1000 / 60 / 60);
}

export async function kisGet(trId: string, path: string, params: Record<string, string>) {
  const base = getKisBase();
  const token = await getKisToken();
  const url = `${base}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'appkey': process.env.KIS_APP_KEY!,
      'appsecret': process.env.KIS_APP_SECRET!,
      'tr_id': trId,
      'custtype': 'P',
    },
  });
  const text = await res.text();
  if (!text || text.trim() === '') {
    console.warn(`KIS ${trId} 빈 응답 (장 외 시간일 수 있음)`);
    return { rt_cd: '1', msg1: '빈 응답 (장 외 시간일 수 있음)', output: [] };
  }
  try {
    return JSON.parse(text);
  } catch {
    console.error(`KIS ${trId} JSON 파싱 실패:`, text.substring(0, 200));
    return { rt_cd: '1', msg1: 'JSON 파싱 실패', output: [] };
  }
}
