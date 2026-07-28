/**
 * @opennote/storage — SMTP transport (ticket 0006).
 *
 * Optional in v1: when SMTP_HOST is unset, the app falls back to showing invite
 * links in the UI and disabling password reset. This module returns a transport
 * only when configured, so callers can branch on `null`.
 */
import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "@opennote/config/env";

export interface SmtpService {
  /** The configured transport, or null when SMTP is unconfigured. */
  transport: Transporter | null;
  /** Whether transactional email is available. */
  isConfigured: boolean;
  /** The configured "From" address (when configured). */
  from: string | null;
  /** Send a transactional email; no-op returning false when unconfigured. */
  send(args: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<boolean>;
}

export function createSmtpService(env: Env): SmtpService {
  if (!env.SMTP_HOST || !env.SMTP_FROM) {
    return {
      transport: null,
      isConfigured: false,
      from: null,
      async send() {
        return false;
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  });
  return {
    transport,
    isConfigured: true,
    from: env.SMTP_FROM,
    async send({ to, subject, text, html }) {
      try {
        await transport.sendMail({
          from: env.SMTP_FROM,
          to,
          subject,
          text,
          html,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
