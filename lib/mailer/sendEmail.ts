import nodemailer from "nodemailer";

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
};

// Transport-only wrapper around Gmail SMTP.
//
// NOTE on T4.3 wording: the plan's Done line says this module "calls
// buildEmailContent rather than inlining content". The frozen contract in
// tests/unit/cron.test.ts (header comment) clarifies the intended split:
// "Pipeline (not sendEmail itself) calls buildEmailContent then
// sendEmail({ to, subject, text })". This module therefore stays a pure
// transport — it sends the already-built subject/text — and the cron route
// (app/api/cron/send-due/route.ts) is the sole caller of
// buildEmailContent. Keeping template logic out of here preserves the
// modularity rule (one feature per file) and matches the mocked
// sendEmail({ to, subject, text }) signature the tests assert on.
export async function sendEmail({
  to,
  subject,
  text,
}: SendEmailInput): Promise<void> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("Missing GMAIL_USER or GMAIL_APP_PASSWORD.");
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  await transporter.sendMail({ from: user, to, subject, text });
}
