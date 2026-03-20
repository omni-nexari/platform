import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useParams, useNavigate } from 'react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AcceptClientOrgInviteSchema } from '@signage/shared';
import type { AcceptClientOrgInviteInput } from '@signage/shared';
import { api } from '../../lib/api.js';
import { Skeleton } from '../../components/UiPrimitives.js';

interface InviteInfo {
  email: string;
  managingCompanyName: string;
}

export default function AcceptClientOrgInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api
      .get<InviteInfo>(`/auth/accept-client-org-invite/${token}`)
      .then(setInviteInfo)
      .catch(() => setLoadError('This invite link is invalid or has expired.'));
  }, [token]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AcceptClientOrgInviteInput>({
    resolver: zodResolver(AcceptClientOrgInviteSchema),
    defaultValues: { workspaceTimezone: 'UTC' },
  });

  // Auto-generate slug from org name
  const orgNameValue = watch('orgName');
  useEffect(() => {
    if (orgNameValue) {
      const slug = orgNameValue
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      setValue('orgSlug', slug, { shouldValidate: false });
    }
  }, [orgNameValue, setValue]);

  const onSubmit = async (data: AcceptClientOrgInviteInput) => {
    try {
      await api.post(`/auth/accept-client-org-invite/${token}`, data);
      toast.success('Organization created! You can now sign in.');
      navigate('/login');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to accept invite');
    }
  };

  if (loadError) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4">
        <p className="text-[var(--danger)]">{loadError}</p>
      </div>
    );
  }

  if (!inviteInfo) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border p-6 space-y-5" style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}>
          <div className="space-y-2 text-center">
            <Skeleton className="mx-auto h-7 w-56 rounded-lg" />
            <Skeleton className="mx-auto h-4 w-72 rounded" />
            <Skeleton className="mx-auto h-3 w-40 rounded" />
          </div>
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-11 rounded-xl" />
          <Skeleton className="h-11 rounded-xl" />
          <Skeleton className="h-11 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Set up your organization</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            You've been invited by{' '}
            <strong>{inviteInfo.managingCompanyName}</strong> to create an organization
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{inviteInfo.email}</p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="rounded-2xl border p-6 space-y-5"
          style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
        >
          {/* Account */}
          <section className="space-y-3">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Your account</p>
            <div>
              <label className="block text-sm font-medium mb-1">Full name</label>
              <input {...register('name')} placeholder="Jane Smith" className="input w-full" />
              {errors.name && <p className="text-xs text-[var(--danger)] mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <input
                {...register('password')}
                type="password"
                placeholder="••••••••"
                className="input w-full"
              />
              {errors.password && <p className="text-xs text-[var(--danger)] mt-1">{errors.password.message}</p>}
            </div>
          </section>

          <hr style={{ borderColor: 'var(--card-border)' }} />

          {/* Organization */}
          <section className="space-y-3">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Organization</p>
            <div>
              <label className="block text-sm font-medium mb-1">Organization name</label>
              <input {...register('orgName')} placeholder="Acme Corp" className="input w-full" />
              {errors.orgName && <p className="text-xs text-[var(--danger)] mt-1">{errors.orgName.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">URL identifier</label>
              <input
                {...register('orgSlug')}
                placeholder="acme-corp"
                className="input w-full font-mono"
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Lowercase letters, numbers, and hyphens only
              </p>
              {errors.orgSlug && <p className="text-xs text-[var(--danger)] mt-1">{errors.orgSlug.message}</p>}
            </div>
          </section>

          <hr style={{ borderColor: 'var(--card-border)' }} />

          {/* Workspace */}
          <section className="space-y-3">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Initial workspace</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Workspace name</label>
                <input
                  {...register('workspaceName')}
                  placeholder="Main Office"
                  className="input w-full"
                />
                {errors.workspaceName && (
                  <p className="text-xs text-[var(--danger)] mt-1">{errors.workspaceName.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Timezone</label>
                <input
                  {...register('workspaceTimezone')}
                  placeholder="UTC"
                  className="input w-full font-mono"
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">e.g. Asia/Singapore</p>
                {errors.workspaceTimezone && (
                  <p className="text-xs text-[var(--danger)] mt-1">{errors.workspaceTimezone.message}</p>
                )}
              </div>
            </div>
          </section>

          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            {isSubmitting ? 'Creating…' : 'Create account & organization'}
          </button>
        </form>
      </div>
    </div>
  );
}
