// server/alerts/mailer.ts
// nodemailer 공통 팩토리 — IPv4 강제 + Gmail SMTP + 공통 타임아웃.
// Railway/일부 호스트에서 발생하는 "ENETUNREACH 2607:f8b0:..." IPv6 실패를 차단한다.

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Gmail SMTP transporter 생성. EMAIL_USER/EMAIL_PASS 미설정 시 null.
 *
 * - `family: 4`: DNS lookup을 IPv4로 강제 (Node native)
 * - `host/port 465 + secure`: gmail service preset을 explicit SMTPS로 대체
 * - 서버 시작 시 dns.setDefaultResultOrder('ipv4first')도 함께 적용하면 100% 차단.
 */
export function createMailTransporter(): Transporter | null {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    family: 4,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}
