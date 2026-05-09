import { Resend } from 'resend';

const resend = new Resend(process.env['RESEND_API_KEY']);

// admin@mail.chiho.app — platform-level: superadmin invites, reseller onboarding
const FROM_ADMIN = `"OmniHub Signage" <${process.env['RESEND_FROM_ADMIN'] ?? 'admin@mail.chiho.app'}>`;
// mail@mail.chiho.app — user-level: org member invites, password reset
const FROM_MAIL = `"OmniHub Signage" <${process.env['RESEND_FROM_MAIL'] ?? 'mail@mail.chiho.app'}>`;
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
    <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.09);">
    <tr><td style="background:${brandPrimary};padding:0;line-height:0;">
      <div style="height:5px;background:linear-gradient(90deg,${brandPrimary},${brandAccent});"></div>
    </td></tr>
    <tr><td style="padding:36px 40px 0;">
      ${brandLogo
        ? `<div style="margin:0 0 20px;"><img src="${brandLogo}" alt="${brandTitle}" style="max-height:40px;max-width:160px;object-fit:contain;border-radius:4px;display:block;"></div>`
        : `<p style="margin:0 0 20px;font-size:17px;font-weight:700;color:${brandPrimary};">${brandTitle}</p>`}
      <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#0f1115;font-weight:700;">${title}</h1>
      ${body}
      <div style="text-align:center;margin:32px 0 28px;">
        <a href="${cta.href}"
           style="display:inline-block;padding:14px 36px;background:${brandPrimary};color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;letter-spacing:.01em;box-shadow:0 6px 20px rgba(0,0,0,.14);">
          ${cta.text}
        </a>
      </div>
    </td></tr>
    <tr><td style="padding:20px 40px 28px;border-top:1px solid #eef0f4;">
      <p style="margin:0 0 6px;color:#a0a8b8;font-size:12px;text-align:center;">
        If you didn't expect this email, you can safely ignore it.
      </p>
      <p style="margin:0;color:#c0c8d4;font-size:11px;text-align:center;">
        Powered by OmniHub Signage &nbsp;·&nbsp; <a href="mailto:support@chiho.app" style="color:#c0c8d4;">support@chiho.app</a>
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
  /** SI/company subscription plan — shown in management_company_admin invite */
  plan?: string;
  /** Active modules licensed to the SI — shown in management_company_admin invite */
  allowedModules?: string;
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
    const companyName = ctx.companyName ?? 'your reseller account';
    const planLabel = ctx.plan
      ? ctx.plan.charAt(0).toUpperCase() + ctx.plan.slice(1)
      : 'Starter';
    const modulesLabel =
      ctx.allowedModules === 'both'
        ? 'CMS + POS'
        : ctx.allowedModules === 'pos'
          ? 'POS Only'
          : 'CMS Only';
    const roleLabel2 = ctx.orgRole.charAt(0).toUpperCase() + ctx.orgRole.slice(1);
    subject = `Welcome to OmniHub — ${companyName} is ready for you to set up`;
    bodyHtml = `
      <p style="color:#444;line-height:1.7;margin:0 0 18px;">${greeting}</p>
      <p style="color:#444;line-height:1.7;margin:0 0 20px;">
        You've been invited to lead <strong>${companyName}</strong> as a reseller on <strong>OmniHub Signage</strong>.
        Click the button below to create your account and complete the setup — it only takes a few minutes.
        This invitation link expires in <strong>7 days</strong>.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;background:#f5f7fb;border-radius:10px;padding:18px;margin:0 0 24px;">
        <tr><td style="padding:6px 0;border-bottom:1px solid #e8eaf0;">
          <span style="display:block;color:#8892a4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Company</span>
          <strong style="color:#0f1115;font-size:15px;">${companyName}</strong>
        </td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #e8eaf0;">
          <span style="display:block;color:#8892a4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Your Role</span>
          <strong style="color:${ctx.branding?.primaryColor ?? '#3a7bff'};font-size:15px;">${roleLabel2}</strong>
        </td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #e8eaf0;">
          <span style="display:block;color:#8892a4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Plan</span>
          <strong style="color:#0f1115;font-size:15px;">${planLabel}</strong>
        </td></tr>
        <tr><td style="padding:6px 0;">
          <span style="display:block;color:#8892a4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Active Modules</span>
          <strong style="color:#0f1115;font-size:15px;">${modulesLabel}</strong>
        </td></tr>
      </table>
      <p style="color:#444;font-size:14px;font-weight:600;margin:0 0 10px;">What happens next</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 8px;">
        <tr>
          <td style="width:28px;vertical-align:top;padding-top:1px;">
            <div style="width:22px;height:22px;border-radius:50%;background:${ctx.branding?.primaryColor ?? '#3a7bff'};color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:22px;">1</div>
          </td>
          <td style="color:#555;font-size:14px;line-height:1.5;padding-bottom:10px;">Set your password and create your admin account</td>
        </tr>
        <tr>
          <td style="width:28px;vertical-align:top;padding-top:1px;">
            <div style="width:22px;height:22px;border-radius:50%;background:${ctx.branding?.primaryColor ?? '#3a7bff'};color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:22px;">2</div>
          </td>
          <td style="color:#555;font-size:14px;line-height:1.5;padding-bottom:10px;">Name your reseller portal and choose your portal URL</td>
        </tr>
        <tr>
          <td style="width:28px;vertical-align:top;padding-top:1px;">
            <div style="width:22px;height:22px;border-radius:50%;background:${ctx.branding?.primaryColor ?? '#3a7bff'};color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:22px;">3</div>
          </td>
          <td style="color:#555;font-size:14px;line-height:1.5;">Invite your team members and start adding client organizations</td>
        </tr>
      </table>`;
    bodyText = `${greeting}\n\nYou've been invited to lead ${companyName} as a ${roleLabel.toLowerCase()} on OmniHub Signage.\n\nPlan: ${planLabel}\nActive Modules: ${modulesLabel}\n\nWhat happens next:\n1. Set your password and create your admin account\n2. Name your reseller portal and choose your portal URL\n3. Invite your team members and start adding client organizations\n\nAccept invitation (expires in 7 days):\n${link}`;
  } else if (ctx.inviteType === 'client_org_owner') {
    const companyName = ctx.companyName ?? 'a management company';
    subject = `${companyName} has invited you to OmniHub Signage`;
    bodyHtml = `
      <p style="color:#444;line-height:1.7;margin:0 0 18px;">${greeting}</p>
      <p style="color:#444;line-height:1.7;margin:0 0 20px;">
        <strong>${companyName}</strong> has set up an organization on <strong>OmniHub Signage</strong> for you.
        Click the button below to create your account, name your organization, and configure your first workspace.
        This invitation link expires in <strong>7 days</strong>.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;background:#f5f7fb;border-radius:10px;padding:18px;margin:0 0 24px;">
        <tr><td style="padding:6px 0;border-bottom:1px solid #e8eaf0;">
          <span style="display:block;color:#8892a4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Invited by</span>
          <strong style="color:#0f1115;font-size:15px;">${companyName}</strong>
        </td></tr>
        <tr><td style="padding:6px 0;">
          <span style="display:block;color:#8892a4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Platform</span>
          <strong style="color:#0f1115;font-size:15px;">OmniHub Signage</strong>
        </td></tr>
      </table>
      <p style="color:#444;font-size:14px;font-weight:600;margin:0 0 10px;">What happens next</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 8px;">
        <tr>
          <td style="width:28px;vertical-align:top;padding-top:1px;">
            <div style="width:22px;height:22px;border-radius:50%;background:${ctx.branding?.primaryColor ?? '#3a7bff'};color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:22px;">1</div>
          </td>
          <td style="color:#555;font-size:14px;line-height:1.5;padding-bottom:10px;">Create your account and set your password</td>
        </tr>
        <tr>
          <td style="width:28px;vertical-align:top;padding-top:1px;">
            <div style="width:22px;height:22px;border-radius:50%;background:${ctx.branding?.primaryColor ?? '#3a7bff'};color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:22px;">2</div>
          </td>
          <td style="color:#555;font-size:14px;line-height:1.5;padding-bottom:10px;">Name your organization and choose your unique URL</td>
        </tr>
        <tr>
          <td style="width:28px;vertical-align:top;padding-top:1px;">
            <div style="width:22px;height:22px;border-radius:50%;background:${ctx.branding?.primaryColor ?? '#3a7bff'};color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:22px;">3</div>
          </td>
          <td style="color:#555;font-size:14px;line-height:1.5;">Configure your first workspace and start managing your displays</td>
        </tr>
      </table>`;
    bodyText = `${greeting}\n\n${companyName} has set up an organization on OmniHub Signage for you.\n\nWhat happens next:\n1. Create your account and set your password\n2. Name your organization and choose your unique URL\n3. Configure your first workspace and start managing your displays\n\nAccept invitation (expires in 7 days):\n${link}`;
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

  const from =
    ctx.inviteType === 'management_company_admin' || ctx.inviteType === 'client_org_owner'
      ? FROM_ADMIN
      : FROM_MAIL;
  const ctaText =
    ctx.inviteType === 'management_company_admin'
      ? 'Set Up Your Reseller Account'
      : ctx.inviteType === 'client_org_owner'
        ? 'Accept & Set Up Your Organization'
        : 'Accept Invitation';
  const { error } = await resend.emails.send({
    from,
    to: [to],
    subject,
    html: card(subject, bodyHtml, { text: ctaText, href: link }, ctx.branding),
    text: bodyText,
  });
  if (error) throw new Error(error.message);
}

// ── Password reset email ─────────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  to: string,
  resetToken: string,
): Promise<void> {
  const link = `${APP_URL}/reset-password/${encodeURIComponent(resetToken)}`;
  const { error } = await resend.emails.send({
    from: FROM_MAIL,
    to: [to],
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
  if (error) throw new Error(error.message);
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

  const { error } = await resend.emails.send({
    from: FROM_ADMIN,
    to: [to],
    subject: `${ctx.companyName} is ready on OmniHub Signage`,
    html: card(
      'Your reseller setup is complete',
      bodyHtml,
      { text: 'Open Reseller Portal', href: ctx.resellerPortalLink },
      ctx.branding,
    ),
    text: bodyText,
  });
  if (error) throw new Error(error.message);
}
