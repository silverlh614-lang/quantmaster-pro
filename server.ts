import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // API routes
  app.get("/api/historical-data", async (req, res) => {
    const { symbol, range, interval } = req.query;
    if (!symbol) return res.status(400).json({ error: "Symbol is required" });
    
    // Try query2 first as it's often more reliable/less throttled
    const urls = [
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range || '1y'}&interval=${interval || '1d'}`,
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range || '1y'}&interval=${interval || '1d'}`
    ];
    
    let lastError = null;
    
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`Proxying request to Yahoo (${url.includes('query2') ? 'query2' : 'query1'}): ${url}`);
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          // Check if we actually got data
          if (data.chart?.result?.[0]) {
            return res.json(data);
          } else if (data.chart?.error) {
            console.warn(`Yahoo API returned error for ${symbol}:`, data.chart.error);
            lastError = data.chart.error;
            // Wait a bit before trying next URL
            if (i < urls.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
            continue; 
          }
        } else if (response.status === 404) {
          console.warn(`Yahoo API symbol not found (404) for ${symbol}`);
          return res.status(404).json({ error: "Symbol not found", symbol });
        }
        
        const errorText = await response.text();
        console.error(`Yahoo API error (${response.status}) for ${symbol}:`, errorText);
        lastError = { status: response.status, details: errorText };
        // Wait a bit before trying next URL
        if (i < urls.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(`Proxy error for ${symbol} using ${url.includes('query2') ? 'query2' : 'query1'}:`, error.message);
        lastError = error;
        // Wait a bit before trying next URL
        if (i < urls.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    res.status(502).json({ 
      error: "Failed to fetch data from Yahoo after multiple attempts", 
      details: lastError?.message || lastError?.details || "Unknown error",
      symbol
    });
  });

  // ─────────────────────────────────────────────────────────────
  // KIS API Proxy
  // ─────────────────────────────────────────────────────────────
  let kisToken: { token: string; expiry: number } | null = null;

  async function getKisToken(): Promise<string> {
    if (kisToken && Date.now() < kisToken.expiry) return kisToken.token;
    const isReal = process.env.KIS_IS_REAL === 'true';
    const base = isReal
      ? 'https://openapi.koreainvestment.com:9443'
      : 'https://openapivts.koreainvestment.com:29443';
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

  async function kisGet(trId: string, path: string, params: Record<string, string>) {
    const isReal = process.env.KIS_IS_REAL === 'true';
    const base = isReal
      ? 'https://openapi.koreainvestment.com:9443'
      : 'https://openapivts.koreainvestment.com:29443';
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

  // [KIS-1] 외국인/기관 수급
  app.get('/api/kis/supply', async (req: any, res: any) => {
    const { code } = req.query;
    if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
    if (!code) return res.status(400).json({ error: 'code 파라미터 필요' });
    try {
      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0].replace(/-/g, '');
      const data = await kisGet(
        'FHKST01010900',
        '/uapi/domestic-stock/v1/quotations/investor',
        {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: code as string,
          FID_BEGIN_DATE: weekAgo,
          FID_END_DATE: today,
        }
      );
      res.json(data);
    } catch (e: any) {
      console.error('KIS supply error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // [KIS-2] 공매도 현황
  app.get('/api/kis/short-selling', async (req: any, res: any) => {
    const { code } = req.query;
    if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
    if (!code) return res.status(400).json({ error: 'code 파라미터 필요' });
    try {
      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0].replace(/-/g, '');
      const data = await kisGet(
        'FHKST01010100',
        '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
        {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: code as string,
          FID_INPUT_DATE_1: monthAgo,
          FID_INPUT_DATE_2: today,
          FID_PERIOD_DIV_CODE: 'D',
          FID_ORG_ADJ_PRC: '0',
        }
      );
      res.json(data);
    } catch (e: any) {
      console.error('KIS short-selling error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // [KIS-3] 현재가 (Yahoo 폴백용)
  app.get('/api/kis/price', async (req: any, res: any) => {
    const { code } = req.query;
    if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
    if (!code) return res.status(400).json({ error: 'code 파라미터 필요' });
    try {
      const data = await kisGet(
        'FHKST01010100',
        '/uapi/domestic-stock/v1/quotations/inquire-price',
        { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code as string }
      );
      res.json(data);
    } catch (e: any) {
      console.error('KIS price error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // DART API Proxy
  app.get('/api/dart', async (req, res) => {
    const { corp_code, bsns_year, reprt_code, fs_div } = req.query;
    if (!process.env.DART_API_KEY) {
      return res.status(500).json({ error: "DART_API_KEY is not set" });
    }
    const url = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json` +
      `?crtfc_key=${process.env.DART_API_KEY}` +
      `&corp_code=${corp_code}&bsns_year=${bsns_year}` +
      `&reprt_code=${reprt_code}&fs_div=${fs_div}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("DART Proxy Error:", error);
      res.status(500).json({ error: "Failed to fetch from DART", details: error.message });
    }
  });

  // DART 법인코드 검색 프록시
  app.get('/api/dart/company', async (req, res) => {
    const { stock_code } = req.query;
    if (!process.env.DART_API_KEY) {
      return res.status(500).json({ error: "DART_API_KEY is not set" });
    }
    const url = `https://opendart.fss.or.kr/api/company.json` +
      `?crtfc_key=${process.env.DART_API_KEY}&stock_code=${stock_code}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("DART Company Proxy Error:", error);
      res.status(500).json({ error: "Failed to fetch company info from DART", details: error.message });
    }
  });

  app.post("/api/send-email", async (req, res) => {
    const { email, subject, text, pdfBase64, filename } = req.body;

    if (!email || !pdfBase64) {
      return res.status(400).json({ error: "Email and PDF data are required" });
    }

    try {
      // Check if environment variables are set
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.error("Email credentials missing in environment variables");
        return res.status(500).json({ 
          error: "이메일 서버가 설정되지 않았습니다.", 
          details: "서버의 EMAIL_USER 또는 EMAIL_PASS 환경 변수가 누락되었습니다. AI Studio 설정에서 이를 추가해주세요." 
        });
      }

      // Create a transporter
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: subject || "Stock Analysis Report",
        text: text || "Please find the attached stock analysis report.",
        attachments: [
          {
            filename: filename || "report.pdf",
            content: pdfBase64.split("base64,")[1],
            encoding: 'base64'
          }
        ]
      };

      await transporter.sendMail(mailOptions);
      res.json({ success: true, message: "Email sent successfully" });
    } catch (error: any) {
      console.error("Error sending email:", error);
      res.status(500).json({ error: "Failed to send email", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, the static files are either in 'dist' (if running from root)
    // or in the same directory (if running from inside 'dist')
    const distPath = fs.existsSync(path.join(__dirname, 'dist', 'index.html'))
      ? path.join(__dirname, 'dist')
      : fs.existsSync(path.join(__dirname, 'index.html'))
        ? __dirname
        : path.join(process.cwd(), 'dist');
        
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
