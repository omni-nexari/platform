import { useState } from 'react';
import { Link } from 'react-router';
import {
  Monitor,
  CalendarDays,
  LayoutGrid,
  Users,
  BarChart2,
  Layers,
  ChevronDown,
  Check,
  X,
  ArrowRight,
  RefreshCw,
  Shield,
  Clock,
  Building2,
  Utensils,
  Play,
  Tv,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanCardProps {
  name: string;
  price: string;
  period: string;
  badge?: string;
  badgeColor?: string;
  description: string;
  features: string[];
  cta: string;
  highlight?: boolean;
}

// ─── Plan data ────────────────────────────────────────────────────────────────

const SIGNAGE_PLANS: PlanCardProps[] = [
  {
    name: 'Basic',
    price: 'CA$12',
    period: '/ screen / month',
    description: 'Full-featured signage for offices, retail, and single-location venues.',
    features: [
      'Images, video, HTML5, PDFs, web URLs',
      'Full scheduling — recurrence, blackouts, day-parts',
      'Multi-workspace organization',
      'Device monitoring & remote commands',
      'Screenshots on demand',
      'Proof-of-play analytics',
      'Unlimited users',
      '60-day free trial',
    ],
    cta: 'Start free trial',
  },
  {
    name: 'Pro',
    price: 'CA$17',
    period: '/ screen / month',
    badge: 'Most Popular',
    badgeColor: '#3a7bff',
    description: 'For multi-location fleets, resellers, and synchronized multi-screen environments.',
    features: [
      'Everything in Basic',
      'SyncPlay — synchronized multi-screen playback',
      'Video walls — grid mapping & bezel compensation',
      'Smart playlists — tag & rule-based auto-population',
      'Multi-tenant reseller portal',
      'Priority support',
      '60-day free trial',
    ],
    cta: 'Start free trial',
    highlight: true,
  },
];

const POS_PLANS: PlanCardProps[] = [
  {
    name: 'Menu Board',
    price: 'CA$49',
    period: '/ location / month',
    description: 'POS-connected digital menu boards for restaurants and QSR venues. Includes 3 screens.',
    features: [
      'POS sync — Square, Toast, Lightspeed, Clover',
      'Item 86 / real-time availability toggle',
      'Day-part menus: Breakfast, Lunch, Dinner, Happy Hour',
      'Bilingual boards (English/French + more)',
      'Allergen & dietary badges (GF, Vegan, Halal…)',
      'QR code menu auto-synced with boards',
      'Nutritional info display (Canadian compliance)',
      'Extra screens: CA$10 / screen / mo',
      '60-day free trial',
    ],
    cta: 'Start free trial',
    highlight: true,
  },
];

const BUNDLE_PLANS: PlanCardProps[] = [
  {
    name: 'Menu Board + Basic',
    price: 'CA$59',
    period: '/ location / month',
    description: 'Menu Board plan + full Basic signage for up to 3 screens. Save CA$26/mo vs separate plans.',
    features: [
      'Everything in Menu Board',
      'Everything in Basic signage',
      'Up to 3 screens per location',
      'Save ~CA$26 / month vs separate plans',
      '60-day free trial',
    ],
    cta: 'Start free trial',
  },
  {
    name: 'Menu Board + Pro',
    price: 'CA$69',
    period: '/ location / month',
    badge: 'Best Value',
    badgeColor: '#22c55e',
    description: 'Full POS sync, SyncPlay, and video walls for restaurant groups and QSR chains. Save CA$31/mo.',
    features: [
      'Everything in Menu Board',
      'Everything in Pro signage',
      'SyncPlay + Video walls included',
      'Multi-tenant reseller portal',
      'Up to 3 screens per location',
      'Save ~CA$31 / month vs separate plans',
      '60-day free trial',
    ],
    cta: 'Start free trial',
    highlight: true,
  },
];

// ─── Competitor comparison ────────────────────────────────────────────────────

const COMPETITORS = [
  { name: 'Nexari Basic', price: 'CA$12/screen', pos: false, scheduling: true, syncplay: false, multitenant: false, nexari: true },
  { name: 'Nexari Pro', price: 'CA$17/screen', pos: false, scheduling: true, syncplay: true, multitenant: true, nexari: true },
  { name: 'Nexari Menu Board', price: 'CA$49/location', pos: true, scheduling: true, syncplay: false, multitenant: false, nexari: true },
  { name: 'Nexari Bundle Pro', price: 'CA$69/location', pos: true, scheduling: true, syncplay: true, multitenant: true, nexari: true },
  { name: 'Yodeck Basic', price: 'CA$12/screen', pos: false, scheduling: true, syncplay: false, multitenant: false, nexari: false },
  { name: 'Yodeck Enterprise', price: 'CA$24/screen', pos: false, scheduling: true, syncplay: false, multitenant: true, nexari: false },
  { name: 'NoviSign Business+', price: 'CA$23/screen', pos: 'Toast only', scheduling: true, syncplay: true, multitenant: false, nexari: false },
  { name: 'ScreenCloud Core', price: 'CA$37/screen', pos: false, scheduling: true, syncplay: false, multitenant: false, nexari: false },
  { name: 'Menuat', price: 'CA$198/location', pos: false, scheduling: false, syncplay: false, multitenant: false, nexari: false },
  { name: 'Toast (menu pub.)', price: 'CA$100–150/location', pos: 'Partial', scheduling: false, syncplay: false, multitenant: false, nexari: false },
];

// ─── FAQ data ─────────────────────────────────────────────────────────────────

const FAQS = [
  {
    q: 'How does the 60-day free trial work?',
    a: 'No credit card required. You get 60 days and up to 3 screens to evaluate the platform. Your platform administrator can extend trial duration and screen limits. After the trial you choose a plan or your account enters a grace period.',
  },
  {
    q: 'Can I mix Basic and Pro screens in the same organization?',
    a: 'No — the signage plan applies at the organization level. Upgrade to Pro to access SyncPlay and video wall features across all screens in that organization.',
  },
  {
    q: 'Does the Menu Board plan include the full signage dashboard?',
    a: 'Menu Board provides device management, monitoring, and scheduling for menu board screens. It does not include SyncPlay or video wall features. Add a bundle to get those capabilities.',
  },
  {
    q: 'Is annual billing available?',
    a: 'Yes — pay annually on any plan and receive 2 months free (approximately 16% savings). Annual billing is available on all signage, POS, and bundle plans.',
  },
  {
    q: 'What POS systems are supported?',
    a: 'Square, Toast, Lightspeed, and Clover at launch. Additional connectors are on the roadmap. Contact support for integration status.',
  },
  {
    q: 'Can I upgrade mid-billing cycle?',
    a: 'Yes. Upgrades are prorated and take effect immediately. You are charged only for the difference for the remainder of your billing period.',
  },
  {
    q: 'Are prices in USD or CAD?',
    a: 'All listed prices are in Canadian Dollars (CAD). USD, GBP, EUR, and AUD billing is available — contact sales to configure your preferred currency.',
  },
  {
    q: 'Is there a setup fee?',
    a: 'No setup fees on any self-serve plan. Assisted onboarding is available for enterprise and reseller accounts.',
  },
  {
    q: 'How does the reseller / management company model work?',
    a: 'Management companies can onboard and manage multiple client organizations from one branded portal. Nexari offers flexible billing models: you can invoice your clients independently (Reseller) or have Nexari bill them directly while you earn a commission (Direct), or choose per-client (Flexible).',
  },
];

// ─── Reusable small components ────────────────────────────────────────────────

function CheckIcon({ val }: { val: boolean | string }) {
  if (val === false) return <X size={16} className="text-[#ff3ea5] mx-auto" />;
  if (val === true) return <Check size={16} className="text-[#22c55e] mx-auto" />;
  return <span className="text-xs text-[#f59e0b] text-center block">{val}</span>;
}

function PlanCard({ name, price, period, badge, badgeColor, description, features, cta, highlight }: PlanCardProps) {
  return (
    <div
      className="nx-card-lift relative flex flex-col rounded-2xl p-7 border"
      style={{
        background: highlight ? 'rgba(58,123,255,0.08)' : 'rgba(255,255,255,0.04)',
        borderColor: highlight ? 'rgba(58,123,255,0.5)' : 'rgba(255,255,255,0.08)',
        boxShadow: highlight ? '0 0 0 1px rgba(58,123,255,0.3)' : undefined,
      }}
    >
      {badge && (
        <span
          className="absolute -top-3 left-6 text-xs font-bold px-3 py-1 rounded-full text-white"
          style={{ background: badgeColor }}
        >
          {badge}
        </span>
      )}
      <div className="mb-4">
        <h3 className="text-lg font-bold text-white">{name}</h3>
        <div className="mt-2 flex items-end gap-1">
          <span className="text-3xl font-extrabold text-white">{price}</span>
          <span className="text-sm text-[#7a8299] mb-1">{period}</span>
        </div>
        <p className="text-sm text-[#7a8299] mt-2">{description}</p>
      </div>
      <ul className="space-y-2 flex-1 mb-7">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-[#b0b8cc]">
            <Check size={14} className="text-[#3a7bff] shrink-0 mt-0.5" />
            {f}
          </li>
        ))}
      </ul>
      <Link
        to="/login"
        className="block text-center py-2.5 rounded-xl text-sm font-semibold transition-opacity"
        style={highlight
          ? { background: '#3a7bff', color: '#fff' }
          : { background: 'rgba(255,255,255,0.08)', color: '#e8eaf0' }}
      >
        {cta} <ArrowRight size={13} className="inline ml-1" />
      </Link>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 py-4 text-left text-sm font-medium text-[#e8eaf0] hover:text-white transition-colors"
      >
        {q}
        <ChevronDown
          size={16}
          className="shrink-0 text-[#7a8299] transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {open && (
        <p className="pb-4 text-sm text-[#7a8299] leading-relaxed">{a}</p>
      )}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ id, children, className = '', style }: { id?: string; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <section id={id} className={`relative py-20 px-4 ${className}`} style={style}>
      <div className="max-w-6xl mx-auto">{children}</div>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-center mb-4">
      <span
        className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full"
        style={{ background: 'rgba(58,123,255,0.12)', color: '#3a7bff' }}
      >
        {children}
      </span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-3xl md:text-4xl font-extrabold text-white text-center mb-4 leading-tight">{children}</h2>
  );
}

function SectionSubtitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-center text-[#7a8299] text-base max-w-2xl mx-auto mb-12">{children}</p>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type PricingTab = 'signage' | 'pos' | 'bundles';

export default function MarketingPage() {
  const [pricingTab, setPricingTab] = useState<PricingTab>('signage');

  return (
    <div className="min-h-dvh relative overflow-x-hidden" style={{ background: '#0b0d11', color: '#e8eaf0' }}>

      {/* ── Global styles & animations ──────────────────────────────────────── */}
      <style>{`
        @keyframes nx-fade-up {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes nx-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-14px); }
        }
        @keyframes nx-pulse-dot {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }
        .nx-anim { opacity: 0; animation: nx-fade-up 0.7s cubic-bezier(0.22,1,0.36,1) forwards; }
        .nx-d1 { animation-delay: 0.05s; }
        .nx-d2 { animation-delay: 0.15s; }
        .nx-d3 { animation-delay: 0.25s; }
        .nx-d4 { animation-delay: 0.35s; }
        .nx-d5 { animation-delay: 0.45s; }
        .nx-grid {
          background-image:
            linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px);
          background-size: 56px 56px;
          -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 75%);
          mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 75%);
        }
        .nx-card-lift { transition: transform 0.25s cubic-bezier(0.22,1,0.36,1), border-color 0.25s, box-shadow 0.25s; }
        .nx-card-lift:hover { transform: translateY(-4px); border-color: rgba(58,123,255,0.35) !important; box-shadow: 0 12px 40px -12px rgba(58,123,255,0.25); }
        @media (prefers-reduced-motion: reduce) {
          .nx-anim, .nx-card-lift { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      {/* Ambient background grid + glow orbs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 nx-grid" style={{ height: 900 }} />
      <div aria-hidden className="pointer-events-none absolute" style={{ top: -120, left: '15%', width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle, rgba(58,123,255,0.20), transparent 70%)', filter: 'blur(40px)' }} />
      <div aria-hidden className="pointer-events-none absolute" style={{ top: 40, right: '10%', width: 460, height: 460, borderRadius: '50%', background: 'radial-gradient(circle, rgba(79,242,209,0.14), transparent 70%)', filter: 'blur(40px)' }} />
      <div aria-hidden className="pointer-events-none absolute" style={{ top: 320, left: '40%', width: 380, height: 380, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,62,165,0.10), transparent 70%)', filter: 'blur(50px)' }} />

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 border-b"
        style={{ background: 'rgba(11,13,17,0.72)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderColor: 'rgba(255,255,255,0.07)' }}
      >
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo/nexari.png" alt="Nexari OmniHub" className="h-7" />
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm text-[#9aa3b8]">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#compare" className="hover:text-white transition-colors">Compare</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="text-sm text-[#9aa3b8] hover:text-white transition-colors hidden sm:block"
            >
              Sign In
            </Link>
            <Link
              to="/login"
              className="text-sm font-semibold px-4 py-2 rounded-lg transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #3a7bff, #5a93ff)', color: '#fff', boxShadow: '0 4px 16px -4px rgba(58,123,255,0.6)' }}
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="relative pt-24 pb-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="nx-anim nx-d1 inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mb-6"
            style={{ background: 'rgba(58,123,255,0.12)', color: '#6ea0ff', border: '1px solid rgba(58,123,255,0.3)' }}>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#4ff2d1]" style={{ animation: 'nx-pulse-dot 1.8s ease-in-out infinite' }} />
            </span>
            60-day free trial — no credit card required
          </div>
          <h1 className="nx-anim nx-d2 text-4xl md:text-6xl font-extrabold leading-[1.08] mb-6 tracking-tight">
            <span className="text-white">Manage every screen,</span><br />
            <span style={{ background: 'linear-gradient(135deg, #3a7bff, #4ff2d1)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>playlist</span>
            <span className="text-white"> and </span>
            <span style={{ background: 'linear-gradient(135deg, #4ff2d1, #ff3ea5)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>client</span>
            <br /><span className="text-white">from one platform.</span>
          </h1>
          <p className="nx-anim nx-d3 text-lg text-[#9aa3b8] max-w-2xl mx-auto mb-10">
            Nexari OmniHub is a multi-tenant digital signage platform for management companies and
            venue operators — content, scheduling, devices, SyncPlay, and POS-connected menu boards in one dashboard.
          </p>
          <div className="nx-anim nx-d4 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl text-base font-semibold transition-all hover:opacity-90 hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg, #3a7bff, #5a93ff)', color: '#fff', boxShadow: '0 8px 28px -8px rgba(58,123,255,0.7)' }}
            >
              Start Free Trial <ArrowRight size={16} />
            </Link>
            <a
              href="#pricing"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl text-base font-semibold border transition-colors hover:bg-white/5"
              style={{ borderColor: 'rgba(255,255,255,0.14)', color: '#e8eaf0' }}
            >
              See Pricing
            </a>
          </div>

          {/* Trust badges */}
          <div className="nx-anim nx-d5 mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs text-[#7a8299]">
            {[
              { icon: Clock, text: '60-day free trial' },
              { icon: Shield, text: 'No credit card needed' },
              { icon: RefreshCw, text: 'Cancel anytime' },
              { icon: Building2, text: 'Multi-tenant ready' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-1.5">
                <Icon size={13} className="text-[#4ff2d1]" />
                {text}
              </div>
            ))}
          </div>
        </div>

        {/* ── Dashboard mockup preview ──────────────────────────────────────── */}
        <div className="nx-anim nx-d5 max-w-5xl mx-auto mt-16 px-2">
          <div
            className="relative rounded-2xl border overflow-hidden"
            style={{
              borderColor: 'rgba(255,255,255,0.1)',
              background: 'linear-gradient(180deg, rgba(18,21,28,0.9), rgba(11,13,17,0.95))',
              boxShadow: '0 40px 120px -40px rgba(58,123,255,0.35), 0 0 0 1px rgba(255,255,255,0.04)',
            }}
          >
            {/* Browser chrome */}
            <div className="flex items-center gap-2 px-4 h-10 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff5f57' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#febc2e' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#28c840' }} />
              <div className="ml-4 flex-1 max-w-xs h-5 rounded-md text-[10px] flex items-center justify-center text-[#7a8299]" style={{ background: 'rgba(255,255,255,0.04)' }}>
                app.nexari.ai/dashboard
              </div>
            </div>
            {/* Mock dashboard body */}
            <div className="grid grid-cols-12 gap-px" style={{ background: 'rgba(255,255,255,0.05)' }}>
              {/* Sidebar */}
              <div className="hidden sm:flex col-span-3 lg:col-span-2 flex-col gap-2 p-4" style={{ background: '#0e1117' }}>
                {['Dashboard', 'Content', 'Playlists', 'Schedules', 'Devices', 'Analytics'].map((item, i) => (
                  <div key={item} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px]"
                    style={i === 0 ? { background: 'rgba(58,123,255,0.15)', color: '#6ea0ff' } : { color: '#7a8299' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: i === 0 ? '#3a7bff' : 'rgba(255,255,255,0.2)' }} />
                    {item}
                  </div>
                ))}
              </div>
              {/* Main panel */}
              <div className="col-span-12 sm:col-span-9 lg:col-span-10 p-5" style={{ background: '#0b0d11' }}>
                {/* Stat cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: 'Online Devices', value: '248', tone: '#22c55e' },
                    { label: 'Active Playlists', value: '36', tone: '#3a7bff' },
                    { label: 'Client Orgs', value: '14', tone: '#4ff2d1' },
                    { label: 'Plays Today', value: '12.4k', tone: '#ff3ea5' },
                  ].map((s) => (
                    <div key={s.label} className="rounded-lg p-3 border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.06)' }}>
                      <div className="text-[10px] text-[#7a8299] mb-1">{s.label}</div>
                      <div className="text-lg font-bold" style={{ color: s.tone }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {/* Chart + screen grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <div className="lg:col-span-2 rounded-lg p-4 border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.06)' }}>
                    <div className="text-[10px] text-[#7a8299] mb-3">Playback activity</div>
                    <div className="flex items-end gap-1.5 h-24">
                      {[40, 65, 50, 80, 55, 90, 70, 100, 60, 85, 45, 75].map((h, i) => (
                        <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: `linear-gradient(180deg, #3a7bff, rgba(58,123,255,0.2))` }} />
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg p-4 border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.06)' }}>
                    <div className="text-[10px] text-[#7a8299] mb-3">Live screens</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {Array.from({ length: 9 }).map((_, i) => (
                        <div key={i} className="aspect-video rounded" style={{ background: i % 4 === 0 ? 'rgba(79,242,209,0.25)' : i % 3 === 0 ? 'rgba(58,123,255,0.25)' : 'rgba(255,255,255,0.06)' }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Platform support strip ───────────────────────────────────────────── */}
      <div className="relative border-y py-5" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
        <div className="max-w-5xl mx-auto px-4 flex flex-wrap items-center justify-center gap-3 gap-y-3 text-xs text-[#7a8299]">
          <span className="font-semibold text-[#b0b8cc] mr-2">Runs on:</span>
          {['Samsung Tizen', 'Android', 'Windows', 'Raspberry Pi', 'ePaper Displays', 'ESP32'].map((p) => (
            <span
              key={p}
              className="px-3 py-1 rounded-full transition-colors hover:text-[#b0b8cc]"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {p}
            </span>
          ))}
        </div>
      </div>

      {/* ── Features ────────────────────────────────────────────────────────── */}
      <Section id="features">
        <SectionLabel>Platform Features</SectionLabel>
        <SectionTitle>Everything signage teams need</SectionTitle>
        <SectionSubtitle>
          Built for real venues — restaurants, retail, offices, and multi-location fleets.
          Manage content, playlists, schedules, devices, and synchronized playback from one dashboard.
        </SectionSubtitle>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            {
              icon: Users,
              color: '#3a7bff',
              title: 'Multi-Tenant Administration',
              body: 'Manage a portfolio of client organizations from one branded portal. Full data isolation between every client.',
            },
            {
              icon: Monitor,
              color: '#4ff2d1',
              title: 'Content & Playlist Management',
              body: 'Images, video, HTML5, PDFs, and web URLs. Build ordered playlists, set durations, and nest playlists inside each other.',
            },
            {
              icon: CalendarDays,
              color: '#a78bfa',
              title: 'Scheduling & Publishing',
              body: 'Recurring slots, day-part rules, blackout dates, priority overrides, and fallback defaults. Publish once, show everywhere.',
            },
            {
              icon: LayoutGrid,
              color: '#f59e0b',
              title: 'Device Fleet Operations',
              body: 'Monitor online/offline state, take screenshots, send remote commands, and view playback logs from the dashboard.',
            },
            {
              icon: Play,
              color: '#22c55e',
              title: 'SyncPlay & Video Walls',
              body: 'Lock multiple screens into synchronized playback. Build video walls with grid mapping, bezel compensation, and per-cell playlists.',
            },
            {
              icon: Utensils,
              color: '#ff3ea5',
              title: 'POS & Menu Boards',
              body: 'Live POS sync with Square, Toast, Lightspeed, and Clover. Day-part menus, item availability, bilingual boards, and QR codes.',
            },
            {
              icon: BarChart2,
              color: '#3a7bff',
              title: 'Analytics & Reporting',
              body: 'Proof-of-play logs, device state history, workspace and org-level reporting. See what played, when, and on which screens.',
            },
            {
              icon: Layers,
              color: '#4ff2d1',
              title: 'Smart Playlists',
              body: 'Auto-populate playlists from tag rules, folder filters, content type, or sort order. Content stays fresh without manual updates.',
            },
            {
              icon: Tv,
              color: '#a78bfa',
              title: 'Remote Support Tools',
              body: 'Screenshots on demand, forced refresh, cache clear, device logs, and connectivity diagnostics — all from the portal.',
            },
          ].map(({ icon: Icon, color, title, body }) => (
            <div
              key={title}
              className="nx-card-lift rounded-2xl p-6 border"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)' }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                style={{ background: `${color}1a` }}
              >
                <Icon size={18} style={{ color }} />
              </div>
              <h3 className="text-sm font-bold text-white mb-2">{title}</h3>
              <p className="text-sm text-[#7a8299] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Pricing ─────────────────────────────────────────────────────────── */}
      <Section id="pricing" className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' } as React.CSSProperties}>
        <SectionLabel>Pricing</SectionLabel>
        <SectionTitle>Simple, transparent pricing</SectionTitle>
        <SectionSubtitle>
          All prices in CAD. Annual billing available — 2 months free (~16% savings).
          Every plan includes a 60-day free trial with 3 screens, no credit card required.
        </SectionSubtitle>

        {/* Tab switcher */}
        <div className="flex justify-center mb-10">
          <div
            className="flex gap-1 p-1 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {(['signage', 'pos', 'bundles'] as PricingTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setPricingTab(tab)}
                className="px-5 py-2 rounded-lg text-sm font-medium transition-all"
                style={pricingTab === tab
                  ? { background: '#3a7bff', color: '#fff' }
                  : { color: '#7a8299' }}
              >
                {tab === 'signage' ? 'Signage' : tab === 'pos' ? 'Menu Board' : 'Bundles'}
              </button>
            ))}
          </div>
        </div>

        {pricingTab === 'signage' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {SIGNAGE_PLANS.map((p) => <PlanCard key={p.name} {...p} />)}
          </div>
        )}
        {pricingTab === 'pos' && (
          <div className="max-w-md mx-auto">
            {POS_PLANS.map((p) => <PlanCard key={p.name} {...p} />)}
          </div>
        )}
        {pricingTab === 'bundles' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {BUNDLE_PLANS.map((p) => <PlanCard key={p.name} {...p} />)}
          </div>
        )}

        <p className="text-center text-xs text-[#7a8299] mt-8">
          All prices exclude applicable taxes.{' '}
          Reseller / volume pricing available for partners managing 10+ client orgs —{' '}
          <a href="mailto:support@nexari.ai" className="text-[#3a7bff] hover:underline">contact sales</a>.
        </p>
      </Section>

      {/* ── Comparison ──────────────────────────────────────────────────────── */}
      <Section id="compare" className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' } as React.CSSProperties}>
        <SectionLabel>Compare</SectionLabel>
        <SectionTitle>How Nexari stacks up</SectionTitle>
        <SectionSubtitle>
          More features, lower cost — especially for POS-connected menu boards and multi-tenant reseller operations.
        </SectionSubtitle>

        <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <th className="text-left px-5 py-3.5 font-semibold text-[#b0b8cc]">Platform</th>
                <th className="text-left px-4 py-3.5 font-semibold text-[#b0b8cc]">Price</th>
                <th className="text-center px-4 py-3.5 font-semibold text-[#b0b8cc]">POS</th>
                <th className="text-center px-4 py-3.5 font-semibold text-[#b0b8cc]">Scheduling</th>
                <th className="text-center px-4 py-3.5 font-semibold text-[#b0b8cc]">SyncPlay / Video Wall</th>
                <th className="text-center px-4 py-3.5 font-semibold text-[#b0b8cc]">Multi-tenant</th>
              </tr>
            </thead>
            <tbody>
              {COMPETITORS.map((row, i) => (
                <tr
                  key={row.name}
                  style={{
                    background: row.nexari ? 'rgba(58,123,255,0.06)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <td className="px-5 py-3 font-medium" style={{ color: row.nexari ? '#fff' : '#b0b8cc' }}>
                    {row.nexari && <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#3a7bff] mr-2 mb-0.5" />}
                    {row.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: row.nexari ? '#4ff2d1' : '#7a8299' }}>{row.price}</td>
                  <td className="px-4 py-3 text-center"><CheckIcon val={row.pos} /></td>
                  <td className="px-4 py-3 text-center"><CheckIcon val={row.scheduling} /></td>
                  <td className="px-4 py-3 text-center"><CheckIcon val={row.syncplay} /></td>
                  <td className="px-4 py-3 text-center"><CheckIcon val={row.multitenant} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Use cases ───────────────────────────────────────────────────────── */}
      <Section className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' } as React.CSSProperties}>
        <SectionLabel>Use Cases</SectionLabel>
        <SectionTitle>Built for real venues</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            {
              icon: Utensils,
              color: '#ff3ea5',
              title: 'Restaurant Menu Boards',
              body: 'Breakfast, lunch, dinner, and happy-hour playlists that switch automatically through the day. Live POS sync keeps prices and availability current.',
            },
            {
              icon: Building2,
              color: '#3a7bff',
              title: 'Resellers & Management Companies',
              body: 'Manage a portfolio of client organizations from one branded portal. Each client gets their own workspace with full data isolation.',
            },
            {
              icon: Monitor,
              color: '#4ff2d1',
              title: 'Retail Promotions',
              body: 'Upload campaign assets once, tag by product line, schedule regional promotions, and refresh every store screen remotely.',
            },
            {
              icon: Play,
              color: '#22c55e',
              title: 'Multi-Screen Feature Walls',
              body: 'Create a sync playlist, publish to selected displays, and let the system synchronize playback across every screen.',
            },
            {
              icon: Tv,
              color: '#a78bfa',
              title: 'Video Walls',
              body: 'Map screens into a grid, assign cells, compensate for bezels, and publish a full-wall video or per-panel content.',
            },
            {
              icon: LayoutGrid,
              color: '#f59e0b',
              title: 'Corporate Lobbies',
              body: 'Default lobby playlist, event signage for specific dates, floor-specific content, and emergency alert overrides.',
            },
          ].map(({ icon: Icon, color, title, body }) => (
            <div
              key={title}
              className="nx-card-lift rounded-2xl p-6 border"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)' }}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-4" style={{ background: `${color}1a` }}>
                <Icon size={16} style={{ color }} />
              </div>
              <h3 className="text-sm font-bold text-white mb-2">{title}</h3>
              <p className="text-sm text-[#7a8299] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
      <Section id="faq" className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' } as React.CSSProperties}>
        <SectionLabel>FAQ</SectionLabel>
        <SectionTitle>Frequently asked questions</SectionTitle>
        <div className="max-w-2xl mx-auto">
          {FAQS.map(({ q, a }) => <FaqItem key={q} q={q} a={a} />)}
        </div>
      </Section>

      {/* ── CTA strip ───────────────────────────────────────────────────────── */}
      <section
        className="relative py-24 px-4 border-t overflow-hidden"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 60% 100% at 50% 100%, rgba(58,123,255,0.18), transparent 70%)' }} />
        <div aria-hidden className="pointer-events-none absolute" style={{ bottom: -160, left: '50%', transform: 'translateX(-50%)', width: 600, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(79,242,209,0.12), transparent 70%)', filter: 'blur(50px)' }} />
        <div className="relative max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Ready to get started?</h2>
          <p className="text-[#9aa3b8] mb-8 text-lg">
            60-day free trial, 3 screens, no credit card required. Set up your first workspace in minutes.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-base transition-all hover:opacity-90 hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, #3a7bff, #5a93ff)', color: '#fff', boxShadow: '0 8px 28px -8px rgba(58,123,255,0.7)' }}
          >
            Start Free Trial <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer
        className="relative border-t py-10 px-4"
        style={{ borderColor: 'rgba(255,255,255,0.07)', background: '#0b0d11' }}
      >
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src="/logo/nexari.png" alt="Nexari OmniHub" className="h-6" />
              <span className="text-xs text-[#7a8299]">© {new Date().getFullYear()} Nexari Technologies</span>
            </div>
            <div className="flex flex-wrap gap-6 text-xs text-[#7a8299]">
              <a href="#features" className="hover:text-white transition-colors">Features</a>
              <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
              <a href="#compare" className="hover:text-white transition-colors">Compare</a>
              <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
              <Link to="/login" className="hover:text-white transition-colors">Sign In</Link>
              <a
                href="mailto:support@nexari.ai"
                className="hover:text-white transition-colors"
              >
                support@nexari.ai
              </a>
            </div>
            <div className="flex gap-5 text-xs text-[#7a8299]">
              <Link to="/marketing/terms" className="hover:text-white transition-colors">Terms</Link>
              <Link to="/marketing/privacy" className="hover:text-white transition-colors">Privacy</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
