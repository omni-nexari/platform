import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useEffect } from 'react';
import { api } from '../../lib/api.js';
import { useAuthStore } from '../../lib/auth.js';
import { queryClient } from '../../lib/query-client.js';

const schema = z.object({
  token: z
    .string()
    .length(6, 'Enter the 6-digit code')
    .regex(/^\d+$/, 'Digits only'),
});
type FormData = z.infer<typeof schema>;

export default function TwoFactorPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    if (!sessionStorage.getItem('2fa_temp')) navigate('/login', { replace: true });
  }, [navigate]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    const tempToken = sessionStorage.getItem('2fa_temp') ?? '';
    try {
      const res = await api.post<{ accessToken: string; user: { id: string; name: string; email: string; orgRole: string } }>(
        '/auth/login/2fa',
        { token: data.token, tempToken },
      );
      sessionStorage.removeItem('2fa_temp');
      setAuth(res.accessToken, res.user);
      try {
        await queryClient.fetchQuery({
          queryKey: ['me'],
          queryFn: () => api.get('/auth/me'),
          staleTime: 30_000,
          retry: 2,
        });
      } catch {
        // Let the dashboard attempt its own recovery path if bootstrap still races.
      }
      navigate('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid code');
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Two-factor authentication</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Enter the 6-digit code from your authenticator app
          </p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="rounded-2xl border p-6 space-y-4"
          style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
        >
          <div>
            <label className="block text-sm font-medium mb-1">Authentication code</label>
            <input
              {...register('token')}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              className="input w-full text-center tracking-widest text-xl"
              autoFocus
            />
            {errors.token && <p className="text-xs text-[var(--danger)] mt-1">{errors.token.message}</p>}
          </div>

          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            {isSubmitting ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--text-muted)] mt-4">
          <button onClick={() => navigate('/login')} className="text-[var(--blue)] hover:underline">
            Back to login
          </button>
        </p>
      </div>
    </div>
  );
}
