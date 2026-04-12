import { withRetry } from './aiClient';

export async function fetchHistoricalData(code: string, range: string = '1y', interval: string = '1d'): Promise<any> {
  // Try .KS (KOSPI) first, then .KQ (KOSDAQ) if it looks like a Korean stock code
  const baseCodeMatch = code.match(/^(\d{6})(\.(KS|KQ))?$/);
  const baseCode = baseCodeMatch ? baseCodeMatch[1] : null;

  const symbols = baseCode ? [`${baseCode}.KS`, `${baseCode}.KQ`] : [code];

  for (const symbol of symbols) {
    const url = `/api/historical-data?symbol=${symbol}&range=${range}&interval=${interval}`;
    try {
      const data = await withRetry(async () => {
        const response = await fetch(url);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        const json = await response.json();
        if (!json.chart?.result?.[0]) {
          throw new Error('Invalid data format from Yahoo API');
        }
        return json.chart.result[0];
      }, 2, 2000);

      if (data) return data;
    } catch (error) {
      console.error(`Error fetching historical data for ${symbol}:`, error);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return null;
}
