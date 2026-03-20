import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { saFetch, useSAStore } from '../../lib/superadmin-auth.js';
import type { SAUser } from '../../lib/superadmin-auth.js';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type FormData = z.infer<typeof schema>;

export default function SuperAdminLoginPage() {
  const navigate = useNavigate();
  const setAuth = useSAStore((s) => s.setAuth);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    try {
      const res = await saFetch<{ accessToken: string; user: SAUser }>('/superadmin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      setAuth(res.accessToken, res.user);
      navigate('/superadmin');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/logo/nexari.png" alt="OmniHub" className="h-10 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">Platform Owner Portal</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Sign in with your platform owner credentials</p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="rounded-2xl border p-6 space-y-4"
          style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
        >
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              {...register('email')}
              type="email"
              placeholder="owner@signage.local"
              className="input w-full"
            />
            {errors.email && (
              <p className="text-xs text-[var(--danger)] mt-1">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              {...register('password')}
              type="password"
              placeholder="••••••••"
              className="input w-full"
            />
            {errors.password && (
              <p className="text-xs text-[var(--danger)] mt-1">{errors.password.message}</p>
            )}
          </div>

          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
