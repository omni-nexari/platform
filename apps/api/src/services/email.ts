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
const APP_URL = (process.env['APP_URL'] ?? 'https://ds.chiho.app').replace(/\/+$/, '');

function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${APP_URL}${url}`;
  return `${APP_URL}/${url}`;
}

interface InviteEmailBranding {
  portalTitle?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
}

// ── Shared email wrapper ─────────────────────────────────────────────────────

function card(
  title: string,
  body: string,
  cta: { text: string; href: string },
  branding?: InviteEmailBranding,
): string {
  const brandPrimary = branding?.primaryColor ?? '#3a7bff';
  const brandAccent = branding?.accentColor ?? '#4ff2d1';
  const brandTitle = branding?.portalTitle ?? 'OmniHub Signage';
  const brandLogo = absoluteUrl(branding?.logoUrl);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f0f2f8;font-family:Inter,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f8;padding:40px 16px;">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:40px;box-shadow:0 4px 16px rgba(0,0,0,.08);border-top:4px solid ${brandPrimary};">
    <tr><td>
      ${brandLogo ? `<div style="text-align:center;margin:0 0 16px;"><img src="${brandLogo}" alt="${brandTitle}" style="max-height:42px;max-width:180px;object-fit:contain;"></div>` : ''}
      <p style="margin:0 0 32px;text-align:center;font-size:18px;font-weight:700;color:${brandPrimary};">${brandTitle}</p>
      <h1 style="margin:0 0 16px;font-size:22px;color:#0f1115;font-weight:700;">${title}</h1>
      ${body}
      <div style="height:1px;background:linear-gradient(90deg, ${brandPrimary}, ${brandAccent});opacity:.25;margin:24px 0 8px;"></div>
      <div style="text-align:center;margin:32px 0;">
        <a href="${cta.href}"
           style="display:inline-block;padding:14px 32px;background:${brandPrimary};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;box-shadow:0 8px 18px rgba(0,0,0,.12);">
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
  /** Determines which acceptance URL path is used in the email link */
  inviteType?: 'org_member' | 'management_company_admin' | 'client_org_owner';
  companyName?: string;
  branding?: InviteEmailBranding;
}

export async function sendInviteEmail(
  to: string,
  token: string,
  ctx: InviteEmailContext,
): Promise<void> {
  const linkPath =
    ctx.inviteType === 'management_company_admin'
      ? '/accept-management-company-invite/'
      : ctx.inviteType === 'client_org_owner'
        ? '/accept-client-org-invite/'
        : '/accept-invite/';
  const link = `${APP_URL}${linkPath}${token}`;
  const greeting = ctx.recipientName ? `Hi ${ctx.recipientName},` : 'Hi there,';
  const roleLabel = ctx.orgRole.charAt(0).toUpperCase() + ctx.orgRole.slice(1);

  let subject: string;
  let bodyHtml: string;
  let bodyText: string;

  if (ctx.inviteType === 'management_company_admin') {
    const companyName = ctx.companyName ?? 'your management company';
    subject = `You've been invited to manage ${companyName} on OmniHub Signage`;
    bodyHtml = `
      <p style="color:#444;line-height:1.6;margin:0 0 16px;">${greeting}</p>
      <p style="color:#444;line-height:1.6;margin:0 0 20px;">
        You've been invited to join <strong>${companyName}</strong> as a management company administrator on OmniHub Signage. Click the button below to create your account. This link expires in <strong>7 days</strong>.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8f9fc;border-radius:8px;padding:16px;margin-bottom:8px;">
        <tr><td style="padding:4px 0;">
          <span style="color:#888;font-size:13px;">Company</span><br>
          <strong style="color:#0f1115;">${companyName}</strong>
        </td></tr>
        <tr><td style="padding:4px 0;">
          <span style="color:#888;font-size:13px;">Your role</span><br>
          <strong style="color:${ctx.branding?.primaryColor ?? '#3a7bff'};">${roleLabel}</strong>
        </td></tr>
      </table>`;
    bodyText = `You've been invited to join ${companyName} as a management company ${roleLabel.toLowerCase()} on OmniHub Signage.\n\nAccept: ${link}\n\nExpires in 7 days.`;
  } else if (ctx.inviteType === 'client_org_owner') {
    const companyName = ctx.companyName ?? 'a management company';
    subject = `You've been invited to set up your organization on OmniHub Signage`;
    bodyHtml = `
      <p style="color:#444;line-height:1.6;margin:0 0 16px;">${greeting}</p>
      <p style="color:#444;line-height:1.6;margin:0 0 20px;">
        You've been invited by <strong>${companyName}</strong> to set up your organization on OmniHub Signage. Click the button below to create your account, name your organization, and configure your first workspace. This link expires in <strong>7 days</strong>.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8f9fc;border-radius:8px;padding:16px;margin-bottom:8px;">
        <tr><td style="padding:4px 0;">
          <span style="color:#888;font-size:13px;">Invited by</span><br>
          <strong style="color:#0f1115;">${companyName}</strong>
        </td></tr>
      </table>`;
    bodyText = `You've been invited by ${companyName} to set up your organization on OmniHub Signage.\n\nAccept: ${link}\n\nExpires in 7 days.`;
  } else {
    // Standard org member invite
    const isPendingSetup = !ctx.orgName;
    const displayOrgName = ctx.orgName ?? 'your organization';

    const workspaceBlock = ctx.workspaceName
      ? `<tr><td style="padding:4px 0;">
          <span style="color:#888;font-size:13px;">Workspace</span><br>
          <strong style="color:#0f1115;">${ctx.workspaceName}</strong>
          ${ctx.workspaceTimezone ? `<span style="color:#888;font-size:12px;"> · ${ctx.workspaceTimezone}</span>` : ''}
        </td></tr>`
      : '';

    subject = isPendingSetup
      ? `You've been invited to set up your organization on OmniHub Signage`
      : `You've been invited to ${displayOrgName}`;

    bodyHtml = `
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
          <strong style="color:${ctx.branding?.primaryColor ?? '#3a7bff'};">${roleLabel}</strong>
        </td></tr>
        ${workspaceBlock}
      </table>`;
    bodyText = isPendingSetup
      ? `You've been invited to set up your organization on OmniHub Signage.\n\nAccept: ${link}\n\nExpires in 7 days.`
      : `You've been invited to ${displayOrgName} (role: ${ctx.orgRole})${ctx.workspaceName ? `, workspace: ${ctx.workspaceName}` : ''}.\n\nAccept: ${link}\n\nExpires in 7 days.`;
  }

  await transporter.sendMail({
    from: FROM,
    to,
    subject,
    html: card(subject, bodyHtml, { text: 'Accept Invitation', href: link }, ctx.branding),
    text: bodyText,
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

export async function sendResellerOnboardingConfirmationEmail(
  to: string,
  ctx: {
    recipientName?: string;
    companyName: string;
    resellerPortalLink: string;
    dashboardLink: string;
    branding?: InviteEmailBranding;
  },
): Promise<void> {
  const greeting = ctx.recipientName ? `Hi ${ctx.recipientName},` : 'Hi there,';

  const bodyHtml = `
    <p style="color:#444;line-height:1.6;margin:0 0 16px;">${greeting}</p>
    <p style="color:#444;line-height:1.6;margin:0 0 20px;">
      Your reseller account for <strong>${ctx.companyName}</strong> is ready. You can now sign in to both your reseller portal and your client dashboard using the same email and password you just created.
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8f9fc;border-radius:8px;padding:16px;margin-bottom:16px;">
      <tr><td style="padding:4px 0;">
        <span style="color:#888;font-size:13px;">Reseller portal</span><br>
        <a href="${ctx.resellerPortalLink}" style="color:${ctx.branding?.primaryColor ?? '#3a7bff'};word-break:break-all;">${ctx.resellerPortalLink}</a>
      </td></tr>
      <tr><td style="padding:12px 0 4px;">
        <span style="color:#888;font-size:13px;">Client dashboard</span><br>
        <a href="${ctx.dashboardLink}" style="color:${ctx.branding?.primaryColor ?? '#3a7bff'};word-break:break-all;">${ctx.dashboardLink}</a>
      </td></tr>
    </table>
    <p style="color:#444;line-height:1.6;margin:0;">
      Save these links for your team. You can manage reseller operations from the reseller portal and access your newly provisioned dashboard organization from the main dashboard login.
    </p>`;

  const bodyText = `${greeting}\n\nYour reseller account for ${ctx.companyName} is ready.\n\nReseller portal: ${ctx.resellerPortalLink}\nClient dashboard: ${ctx.dashboardLink}\n\nUse the same email and password you just created to sign in to both.`;

  await transporter.sendMail({
    from: FROM,
    to,
    subject: `${ctx.companyName} is ready on OmniHub Signage`,
    html: card(
      'Your reseller setup is complete',
      bodyHtml,
      { text: 'Open Reseller Portal', href: ctx.resellerPortalLink },
      ctx.branding,
    ),
    text: bodyText,
  });
}
