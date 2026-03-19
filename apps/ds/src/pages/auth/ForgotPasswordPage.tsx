import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { useAuthStore } from '../../lib/auth.js';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
});
type FormData = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      await api.post('/auth/forgot-password', data);
    } catch {
      // Silently succeed regardless — prevents email enumeration
    }
  };

  if (isSubmitSuccessful) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-4">📬</div>
          <h1 className="text-2xl font-bold mb-2">Check your email</h1>
          <p className="text-sm text-[var(--text-muted)]">
            If that email is associated with an account, you'll receive a reset link shortly.
          </p>
          <Link to="/login" className="block mt-6 text-sm text-[var(--blue)] hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Forgot password</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Enter your email to receive a reset link
          </p>
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
            {errors.email && (
              <p className="text-xs text-[var(--danger)] mt-1">{errors.email.message}</p>
            )}
          </div>

          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--text-muted)] mt-4">
          <Link to="/login" className="text-[var(--blue)] hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
