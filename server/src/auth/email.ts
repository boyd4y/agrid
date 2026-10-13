import { Resend } from "resend";

const from = process.env.EMAIL_FROM || "tabdo <onboarding@resend.dev>";

export function getResend() {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return new Resend(key);
}

export async function sendInviteEmail(opts: {
  to: string;
  organizationName: string;
  inviterName: string;
  inviteLink: string;
}) {
  const resend = getResend();
  const subject = `邀请你加入 ${opts.organizationName}`;
  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#37352f">
      <h1 style="font-size:20px;font-weight:600;margin:0 0 12px">${opts.organizationName}</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px">
        <strong>${opts.inviterName}</strong> 邀请你加入 tabdo 工作区。接受后即可与同事和 Agent 共用同一套表格 / 看板操作。
      </p>
      <a href="${opts.inviteLink}" style="display:inline-block;background:#2383e2;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:500">
        接受邀请
      </a>
      <p style="font-size:12px;color:#9b9a97;margin:24px 0 0">若按钮无效，请复制链接：<br/>${opts.inviteLink}</p>
      <p style="font-size:11px;color:#9b9a97;margin:16px 0 0">— tabdo</p>
    </div>
  `;

  if (!resend) {
    console.log("[email:mock] invite →", opts.to, opts.inviteLink);
    return { mocked: true as const };
  }

  await resend.emails.send({
    from,
    to: opts.to,
    subject,
    html,
  });
  return { mocked: false as const };
}
