import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CheckCircle2, Building2, UserCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { api, buildApiUrl } from '../lib/api.js';

const step1Schema = z.object({
  orgName: z.string().min(1, 'Organization name is required').max(200),
  workspaceName: z.string().min(1, 'Workspace name is required').max(200),
});

const step2Schema = z.object({
  name: z.string().min(1, 'Your name is required').max(100),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type Step1 = z.infer<typeof step1Schema>;
type Step2 = z.infer<typeof step2Schema>;

const STEPS = [
  { label: 'Organization', icon: Building2 },
  { label: 'Admin Account', icon: UserCircle2 },
];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const done = i < current;
        const active = i === current;
        return (
          <div key={step.label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                  done
                    ? 'bg-[var(--blue)] text-white'
                    : active
                    ? 'bg-[var(--blue)] text-white ring-2 ring-[var(--blue)]/30'
                    : 'bg-[var(--surface-elevated,var(--surface))] border border-[var(--border)] text-[var(--text-muted)]'
                }`}
              >
                {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span
                className={`text-[11px] mt-1.5 font-medium ${
                  active ? 'text-[var(--blue)]' : done ? 'text-[var(--text-muted)]' : 'text-[var(--text-muted)]'
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-16 h-0.5 mx-1 mb-5 transition-colors ${
                  done ? 'bg-[var(--blue)]' : 'bg-[var(--border)]'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Step1({ onNext }: { onNext: (data: Step1) => void }) {
  const { register, handleSubmit, formState: { errors }, watch } = useForm<Step1>({
    resolver: zodResolver(step1Schema),
  });
  const orgName = watch('orgName', '');
  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text)]">Name your organization</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          This is the company operating this platform. It appears in on-screen branding.
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Organization name</label>
        <input {...register('orgName')} type="text" placeholder="e.g. Acme Digital Signage" className="input w-full" autoFocus />
        {errors.orgName && <p className="text-xs text-[var(--danger)] mt-1">{errors.orgName.message}</p>}
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">First workspace name</label>
        <input {...register('workspaceName')} type="text" placeholder={orgName || 'e.g. Main Office'} className="input w-full" />
        <p className="text-xs text-[var(--text-muted)] mt-1">A workspace groups your screens and content. You can create more later.</p>
        {errors.workspaceName && <p className="text-xs text-[var(--danger)] mt-1">{errors.workspaceName.message}</p>}
      </div>
      <button type="submit" className="btn-primary w-full">Continue</button>
    </form>
  );
}

function Step2({
  onNext,
  onBack,
  isSubmitting,
}: {
  onNext: (data: Step2) => void;
  onBack: () => void;
  isSubmitting: boolean;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<Step2>({
    resolver: zodResolver(step2Schema),
  });
  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text)]">Create your admin account</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          This is the primary platform administrator account. Keep the credentials safe.
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Full name</label>
        <input {...register('name')} type="text" placeholder="Jane Smith" className="input w-full" autoFocus autoComplete="name" />
        {errors.name && <p className="text-xs text-[var(--danger)] mt-1">{errors.name.message}</p>}
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Email address</label>
        <input {...register('email')} type="email" placeholder="admin@mycompany.com" className="input w-full" autoComplete="username" />
        {errors.email && <p className="text-xs text-[var(--danger)] mt-1">{errors.email.message}</p>}
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Password</label>
        <input {...register('password')} type="password" placeholder="Min. 8 characters" className="input w-full" autoComplete="new-password" />
        {errors.password && <p className="text-xs text-[var(--danger)] mt-1">{errors.password.message}</p>}
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Confirm password</label>
        <input {...register('confirmPassword')} type="password" placeholder="Re-enter password" className="input w-full" autoComplete="new-password" />
        {errors.confirmPassword && <p className="text-xs text-[var(--danger)] mt-1">{errors.confirmPassword.message}</p>}
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={onBack} className="btn-outline flex-1" disabled={isSubmitting}>Back</button>
        <button type="submit" className="btn-primary flex-1" disabled={isSubmitting}>
          {isSubmitting ? 'Setting up...' : 'Create account'}
        </button>
      </div>
    </form>
  );
}

function SuccessScreen({ email }: { email: string }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="w-14 h-14 rounded-full bg-[var(--green)]/15 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-[var(--green)]" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-[var(--text)]">Setup complete!</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Sign in with <span className="font-medium text-[var(--text)]">{email}</span> to get started.
          </p>
        </div>
      </div>
      <a href="/login" className="btn-primary w-full flex items-center justify-center">
        Go to sign in
      </a>
    </div>
  );
}

export default function SetupWizardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [step1Data, setStep1Data] = useState<Step1 | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [setupEmail, setSetupEmail] = useState<string | null>(null);

  // Redirect to login if setup already done -- signup is disabled once an owner exists
  useEffect(() => {
    fetch(buildApiUrl('/setup/status'))
      .then((r) => r.json() as Promise<{ complete: boolean }>)
      .then(({ complete }) => { if (complete) navigate('/login', { replace: true }); })
      .catch(() => undefined);
  }, [navigate]);

  const handleStep1 = (data: Step1) => { setStep1Data(data); setStep(1); };

  const handleStep2 = async (data: Step2) => {
    if (!step1Data) return;
    setIsSubmitting(true);
    try {
      await api.post('/setup', {
        orgName: step1Data.orgName,
        workspaceName: step1Data.workspaceName,
        name: data.name,
        email: data.email,
        password: data.password,
      });
      toast.success('Platform setup complete!');
      setSetupEmail(data.email);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Setup failed. Please try again.');
      setIsSubmitting(false);
    }
  };

  if (setupEmail) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <img src="/logo/nexari.png" alt="Nexari" className="h-10 mx-auto mb-4" />
          </div>
          <div className="rounded-2xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}>
            <SuccessScreen email={setupEmail} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img src="/logo/nexari.png" alt="Nexari" className="h-10 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-[var(--text)]">Platform Setup</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Complete these steps to get started</p>
        </div>
        <StepIndicator current={step} />
        <div className="rounded-2xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}>
          {step === 0 && <Step1 onNext={handleStep1} />}
          {step === 1 && <Step2 onNext={handleStep2} onBack={() => setStep(0)} isSubmitting={isSubmitting} />}
        </div>
      </div>
    </div>
  );
}