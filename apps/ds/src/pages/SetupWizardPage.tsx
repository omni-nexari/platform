import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CheckCircle2, Building2, UserCircle2, Key, ExternalLink } from 'lucide-react';
import { api } from '../lib/api.js';

// ── Schemas ──────────────────────────────────────────────────────────────────

const step1Schema = z.object({
  orgName: z.string().min(1, 'Organization name is required').max(200),
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

const step3Schema = z.object({
  licenseKey: z.string().optional(),
});

type Step1 = z.infer<typeof step1Schema>;
type Step2 = z.infer<typeof step2Schema>;
type Step3 = z.infer<typeof step3Schema>;

// ── Step indicator ────────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Organization', icon: Building2 },
  { label: 'Admin Account', icon: UserCircle2 },
  { label: 'License', icon: Key },
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

// ── Step 1 — Organization ─────────────────────────────────────────────────────

function Step1({ onNext }: { onNext: (data: Step1) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<Step1>({
    resolver: zodResolver(step1Schema),
  });

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text)]">Name your organization</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          This is the name of the company or organization operating this platform.
          It appears in the management portal and on-screen branding.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Organization name</label>
        <input
          {...register('orgName')}
          type="text"
          placeholder="e.g. Acme Digital Signage"
          className="input w-full"
          autoFocus
        />
        {errors.orgName && (
          <p className="text-xs text-[var(--danger)] mt-1">{errors.orgName.message}</p>
        )}
      </div>

      <button type="submit" className="btn-primary w-full">
        Continue
      </button>
    </form>
  );
}

// ── Step 2 — Admin Account ────────────────────────────────────────────────────

function Step2({
  onNext,
  onBack,
}: {
  onNext: (data: Step2) => void;
  onBack: () => void;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<Step2>({
    resolver: zodResolver(step2Schema),
  });

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text)]">Create your admin account</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          This is the primary platform administrator account. Keep the credentials safe —
          this account cannot be recovered through normal password reset.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Full name</label>
        <input
          {...register('name')}
          type="text"
          placeholder="Jane Smith"
          className="input w-full"
          autoFocus
          autoComplete="name"
        />
        {errors.name && (
          <p className="text-xs text-[var(--danger)] mt-1">{errors.name.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Email address</label>
        <input
          {...register('email')}
          type="email"
          placeholder="admin@mycompany.com"
          className="input w-full"
          autoComplete="username"
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
          placeholder="Min. 8 characters"
          className="input w-full"
          autoComplete="new-password"
        />
        {errors.password && (
          <p className="text-xs text-[var(--danger)] mt-1">{errors.password.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Confirm password</label>
        <input
          {...register('confirmPassword')}
          type="password"
          placeholder="Re-enter password"
          className="input w-full"
          autoComplete="new-password"
        />
        {errors.confirmPassword && (
          <p className="text-xs text-[var(--danger)] mt-1">{errors.confirmPassword.message}</p>
        )}
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onBack} className="btn-outline flex-1">
          Back
        </button>
        <button type="submit" className="btn-primary flex-1">
          Continue
        </button>
      </div>
    </form>
  );
}

// ── Step 3 — License key (optional) ──────────────────────────────────────────

function Step3({
  onSubmit: onFinish,
  onBack,
  isSubmitting,
}: {
  onSubmit: (data: Step3) => void;
  onBack: () => void;
  isSubmitting: boolean;
}) {
  const { register, handleSubmit } = useForm<Step3>({
    resolver: zodResolver(step3Schema),
  });

  return (
    <form onSubmit={handleSubmit(onFinish)} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text)]">License key</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          If you received a Nexari license key, enter it here. It enables the remote
          monitoring heartbeat so Nexari Support can proactively detect issues.
          You can also add or change this later in{' '}
          <span className="font-medium">Settings → License</span>.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          License key{' '}
          <span className="font-normal text-[var(--text-muted)]">(optional)</span>
        </label>
        <input
          {...register('licenseKey')}
          type="text"
          placeholder="NXR-XXXX-XXXX-XXXX-XXXX"
          className="input w-full font-mono"
          autoComplete="off"
        />
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onBack} className="btn-outline flex-1" disabled={isSubmitting}>
          Back
        </button>
        <button type="submit" className="btn-primary flex-1" disabled={isSubmitting}>
          {isSubmitting ? 'Setting up…' : 'Complete setup'}
        </button>
      </div>
    </form>
  );
}

// ── Success screen ────────────────────────────────────────────────────────────

interface SetupResult {
  managementSlug: string;
  appUrl: string | null;
  lanUrl: string | null;
}

function LinkRow({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 hover:bg-[var(--surface-elevated,var(--surface))] transition-colors"
      style={{ borderColor: 'var(--card-border)' }}
    >
      <div>
        <p className="text-xs text-[var(--text-muted)] mb-0.5">{label}</p>
        <p className="text-sm font-mono text-[var(--text)] break-all">{href}</p>
      </div>
      <ExternalLink className="w-4 h-4 shrink-0 text-[var(--text-muted)]" />
    </a>
  );
}

function SuccessScreen({ result }: { result: SetupResult }) {
  const { managementSlug, appUrl, lanUrl } = result;
  const domainPortalLogin = appUrl ? `${appUrl}/${managementSlug}/login` : null;
  const lanPortalLogin = lanUrl ? `${lanUrl}/${managementSlug}/login` : null;
  const domainDashboard = appUrl ?? null;
  const lanDashboard = lanUrl ?? null;

  return (
    <div className="space-y-6">
      {/* Success banner */}
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="w-14 h-14 rounded-full bg-[var(--green)]/15 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-[var(--green)]" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-[var(--text)]">Setup complete!</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Your platform is ready. Use the links below to get started.
          </p>
        </div>
      </div>

      {/* Management portal */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
          Management portal login
        </p>
        <div className="space-y-2">
          {domainPortalLogin && <LinkRow label="Via domain" href={domainPortalLogin} />}
          {lanPortalLogin && <LinkRow label="Via local network" href={lanPortalLogin} />}
        </div>
      </div>

      {/* Dashboard */}
      {(domainDashboard || lanDashboard) && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Platform dashboard
          </p>
          <div className="space-y-2">
            {domainDashboard && <LinkRow label="Via domain" href={domainDashboard} />}
            {lanDashboard && <LinkRow label="Via local network" href={lanDashboard} />}
          </div>
        </div>
      )}

      <p className="text-xs text-center text-[var(--text-muted)]">
        Sign in with the email and password you just created.
      </p>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function SetupWizardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [step1Data, setStep1Data] = useState<Step1 | null>(null);
  const [step2Data, setStep2Data] = useState<Step2 | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null);
    setStep1Data(data);
    setStep(1);
  };

  const handleStep2 = (data: Step2) => {
    setStep2Data(data);
    setStep(2);
  };

  const handleStep3 = async (data: Step3) => {
    if (!step1Data || !step2Data) return;

    setIsSubmitting(true);
    try {
      const result = await api.post<{
        ok: boolean;
        adminUrl: string | null;
        managementSlug: string;
        appUrl: string | null;
        lanUrl: string | null;
      }>('/setup', {
        orgName: step1Data.orgName,
        name: step2Data.name,
        email: step2Data.email,
        password: step2Data.password,
        licenseKey: data.licenseKey || undefined,
      });

      toast.success('Platform setup complete!');
      setSetupResult({
        managementSlug: result.managementSlug,
        appUrl: result.appUrl,
        lanUrl: result.lanUrl,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Setup failed. Please try again.');
      setIsSubmitting(false);
    }
  };

  // Show success screen once setup completes
  if (setupResult) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <img src="/logo/nexari.png" alt="Nexari" className="h-10 mx-auto mb-4" />
          </div>
          <div
            className="rounded-2xl border p-6"
            style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
          >
            <SuccessScreen result={setupResult} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <img src="/logo/nexari.png" alt="Nexari" className="h-10 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-[var(--text)]">Platform Setup</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Complete these steps to get started
          </p>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} />

        {/* Step content */}
        <div
          className="rounded-2xl border p-6"
          style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
        >
          {step === 0 && <Step1 onNext={handleStep1} />}
          {step === 1 && (
            <Step2 onNext={handleStep2} onBack={() => setStep(0)} />
          )}
          {step === 2 && (
            <Step3
              onSubmit={handleStep3}
              onBack={() => setStep(1)}
              isSubmitting={isSubmitting}
            />
          )}
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-4">
          Need help? Visit{' '}
          <a
            href="https://docs.nexari.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--blue)] hover:underline"
          >
            docs.nexari.io
          </a>
        </p>
      </div>
    </div>
  );
}
