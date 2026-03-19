import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, Link } from 'react-router';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { useAuthStore } from '../../lib/auth.js';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    try {
      const res = await api.post<
        | { requiresTwoFactor: true; tempToken: string }
        | { accessToken: string; user: { id: string; name: string; email: string; orgRole: string } }
      >('/auth/login', data);

      if ('requiresTwoFactor' in res && res.requiresTwoFactor) {
        sessionStorage.setItem('2fa_temp', res.tempToken);
        navigate('/login/2fa');
      } else if ('accessToken' in res) {
        setAuth(res.accessToken, res.user);
        navigate('/');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/logo/nexari.png" alt="OmniHub" className="h-10 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-[var(--text)]">Sign in</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Welcome back</p>
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
              placeholder="you@example.com"
              className="input w-full"
            />
            {errors.email && <p className="text-xs text-[var(--danger)] mt-1">{errors.email.message}</p>}
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

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary w-full"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--text-muted)] mt-4">
          <Link to="/forgot-password" className="text-[var(--blue)] hover:underline">
            Forgot password?
          </Link>
        </p>
      </div>
    </div>
  );
}
