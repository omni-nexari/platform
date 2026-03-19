import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useParams, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ResetPasswordSchema } from '@signage/shared';
import type { ResetPasswordInput } from '@signage/shared';
import { api } from '../../lib/api.js';

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(ResetPasswordSchema),
    defaultValues: { token: token ?? '' },
  });

  const onSubmit = async (data: ResetPasswordInput) => {
    try {
      await api.post('/auth/reset-password', data);
      toast.success('Password reset. Please sign in.');
      navigate('/login');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed');
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Reset password</h1>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="rounded-2xl border p-6 space-y-4"
          style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
        >
          <input type="hidden" {...register('token')} />
          <div>
            <label className="block text-sm font-medium mb-1">New password</label>
            <input {...register('password')} type="password" placeholder="••••••••" className="input w-full" />
            {errors.password && <p className="text-xs text-[var(--danger)] mt-1">{errors.password.message}</p>}
          </div>
          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            {isSubmitting ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  );
}
