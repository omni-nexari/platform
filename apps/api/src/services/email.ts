import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env['SMTP_HOST'] ?? 'smtp.gmail.com',
  port: Number(process.env['SMTP_PORT'] ?? '587'),
  secure: false, // STARTTLS on port 587
  auth: {
    user: process.env['SMTP_USER'] ?? '',
    pass: process.env['SMTP_PASS'] ?? '',
  },
});

const FROM = `"OmniHub Signage" <${process.env['SMTP_FROM'] ?? process.env['SMTP_USER'] ?? 'noreply@signage.local'}>`;
const APP_URL = (process.env['APP_URL'] ?? 'https://ds.chiho.app').replace(/\/$/, '');

// ── Shared email wrapper ─────────────────────────────────────────────────────

function card(title: string, body: string, cta: { text: string; href: string }): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f0f2f8;font-family:Inter,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f8;padding:40px 16px;">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:40px;box-shadow:0 4px 16px rgba(0,0,0,.08);">
    <tr><td>
      <p style="margin:0 0 32px;text-align:center;font-size:18px;font-weight:700;color:#3a7bff;">OmniHub Signage</p>
      <h1 style="margin:0 0 16px;font-size:22px;color:#0f1115;font-weight:700;">${title}</h1>
      ${body}
      <div style="text-align:center;margin:32px 0;">
        <a href="${cta.href}"
           style="display:inline-block;padding:14px 32px;background:#3a7bff;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
          ${cta.text}
        </a>
      </div>
      <p style="margin:0;color:#888;font-size:12px;text-align:center;">
        If you didn't expect this email, you can safely ignore it.
      </p>
    </td></tr>
    </table>
  </td></tr>
  </table>
</body></html>`;
}

// ── Invite email ─────────────────────────────────────────────────────────────

export interface InviteEmailContext {
  recipientName?: string;
  orgName?: string;
  orgRole: string;
  workspaceName?: string;
  workspaceTimezone?: string;
}

export async function sendInviteEmail(
  to: string,
  token: string,
  ctx: InviteEmailContext,
): Promise<void> {
  const link = `${APP_URL}/accept-invite/${token}`;
  const greeting = ctx.recipientName ? `Hi ${ctx.recipientName},` : 'Hi there,';
  const roleLabel = ctx.orgRole.charAt(0).toUpperCase() + ctx.orgRole.slice(1);
  const isPendingSetup = !ctx.orgName;
  const displayOrgName = ctx.orgName ?? 'your organization';

  const workspaceBlock = ctx.workspaceName
    ? `<tr><td style="padding:4px 0;">
        <span style="color:#888;font-size:13px;">Workspace</span><br>
        <strong style="color:#0f1115;">${ctx.workspaceName}</strong>
        ${ctx.workspaceTimezone ? `<span style="color:#888;font-size:12px;"> · ${ctx.workspaceTimezone}</span>` : ''}
      </td></tr>`
    : '';

  const body = `
    <p style="color:#444;line-height:1.6;margin:0 0 16px;">${greeting}</p>
    <p style="color:#444;line-height:1.6;margin:0 0 20px;">
      ${isPendingSetup
        ? `You've been invited to <strong>set up your organization</strong> on OmniHub Signage. Click the button below to create your account, name your organization, and configure your first workspace. This link expires in <strong>7 days</strong>.`
        : `You've been invited to join <strong>${displayOrgName}</strong> on OmniHub Signage. Click the button below to accept and set your password. This link expires in <strong>7 days</strong>.`
      }
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8f9fc;border-radius:8px;padding:16px;margin-bottom:8px;">
      ${!isPendingSetup ? `<tr><td style="padding:4px 0;">
        <span style="color:#888;font-size:13px;">Organization</span><br>
        <strong style="color:#0f1115;">${displayOrgName}</strong>
      </td></tr>` : ''}
      <tr><td style="padding:4px 0;">
        <span style="color:#888;font-size:13px;">Your role</span><br>
        <strong style="color:#3a7bff;">${roleLabel}</strong>
      </td></tr>
      ${workspaceBlock}
    </table>`;

  await transporter.sendMail({
    from: FROM,
    to,
    subject: isPendingSetup ? `You've been invited to set up your organization on OmniHub Signage` : `You've been invited to ${displayOrgName}`,
    html: card(isPendingSetup ? `Set up your organization` : `You've been invited to ${displayOrgName}`, body, { text: 'Accept Invitation', href: link }),
    text: isPendingSetup
      ? `You've been invited to set up your organization on OmniHub Signage.\n\nAccept: ${link}\n\nExpires in 7 days.`
      : `You've been invited to ${displayOrgName} (role: ${ctx.orgRole})${ctx.workspaceName ? `, workspace: ${ctx.workspaceName}` : ''}.\n\nAccept: ${link}\n\nExpires in 7 days.`,
  });
}

// ── Password reset email ─────────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  to: string,
  resetToken: string,
): Promise<void> {
  const link = `${APP_URL}/reset-password/${encodeURIComponent(resetToken)}`;
  await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Reset your OmniHub Signage password',
    html: card(
      'Reset your password',
      `<p style="color:#444;line-height:1.6;margin:0 0 0;">
        Click the button below to choose a new password.
        This link expires in <strong>1 hour</strong>.
      </p>`,
      { text: 'Reset Password', href: link },
    ),
    text: `Reset your OmniHub Signage password:\n${link}\n\nExpires in 1 hour.`,
  });
}
