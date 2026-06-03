import { useQuery } from '@tanstack/react-query';
import { DollarSign, Info } from 'lucide-react';
import { saApi } from '../../lib/superadmin-auth.js';
import {
  Badge,
  EmptyState,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface McPricing {
  planId: string;
  planKey: string;
  planName: string;
  currency: string;
  wholesaleAmountCents: number;
  retailAmountCents: number;
  screensIncluded: number;
  billingPeriod: 'monthly' | 'annual';
  module: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number, currency: string) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

const PERIOD_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  annual: 'Annual',
};

const MODULE_LABELS: Record<string, string> = {
  signage: 'CMS',
  pos: 'POS',
  both: 'CMS + POS',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ManagementPricingPage() {
  const { data: pricing, isLoading, isError } = useQuery<McPricing[]>({
    queryKey: ['my-mc-pricing'],
    queryFn: () => saApi.get('/pricing/my-mc/pricing'),
  });

  const byCurrency = pricing
    ? pricing.reduce<Record<string, McPricing[]>>((acc, row) => {
        (acc[row.currency] ??= []).push(row);
        return acc;
      }, {})
    : {};

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        icon={<DollarSign size={20} />}
        title="Pricing"
        description="Wholesale pricing applied to your account for each plan."
      />

      <div
        className="flex items-start gap-2 rounded-lg p-3 mb-6 text-sm"
        style={{ background: 'var(--bg2)', border: '1px solid var(--border)' }}
      >
        <Info size={15} className="shrink-0 mt-0.5 text-[var(--text-muted)]" />
        <p className="text-[var(--text-muted)]">
          These are the wholesale rates negotiated for your account. Retail prices shown are the standard rates
          your client organisations see. The difference is your margin.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      )}

      {isError && (
        <EmptyState
          icon={<DollarSign size={28} />}
          title="Unable to load pricing"
          description="Please try again or contact platform support."
        />
      )}

      {!isLoading && !isError && (!pricing || pricing.length === 0) && (
        <EmptyState
          icon={<DollarSign size={28} />}
          title="No pricing configured"
          description="No wholesale pricing has been configured for your account yet. Contact platform support."
        />
      )}

      {!isLoading && !isError && Object.entries(byCurrency).map(([currency, rows]) => (
        <SectionCard key={currency} className="mb-4">
          <SectionCardHeader>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold font-mono">{currency}</span>
              <Badge tone="neutral">{rows.length} plan{rows.length !== 1 ? 's' : ''}</Badge>
            </div>
          </SectionCardHeader>
          <SectionCardBody>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                  <th className="text-left pb-2">Plan</th>
                  <th className="text-left pb-2">Module</th>
                  <th className="text-left pb-2">Period</th>
                  <th className="text-left pb-2">Screens</th>
                  <th className="text-right pb-2">Retail</th>
                  <th className="text-right pb-2">Your Wholesale</th>
                  <th className="text-right pb-2">Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const margin = row.retailAmountCents - row.wholesaleAmountCents;
                  const marginPct =
                    row.retailAmountCents > 0
                      ? Math.round((margin / row.retailAmountCents) * 100)
                      : 0;
                  return (
                    <tr key={`${row.planId}-${row.currency}`} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2.5 font-medium">
                        {row.planName}
                        <span className="ml-1.5 font-mono text-xs text-[var(--text-muted)]">{row.planKey}</span>
                      </td>
                      <td className="py-2.5">
                        <Badge tone="neutral">{MODULE_LABELS[row.module] ?? row.module}</Badge>
                      </td>
                      <td className="py-2.5">{PERIOD_LABELS[row.billingPeriod] ?? row.billingPeriod}</td>
                      <td className="py-2.5">{row.screensIncluded}</td>
                      <td className="py-2.5 text-right text-[var(--text-muted)]">
                        {formatCents(row.retailAmountCents, currency)}
                      </td>
                      <td className="py-2.5 text-right font-semibold">
                        {formatCents(row.wholesaleAmountCents, currency)}
                      </td>
                      <td className="py-2.5 text-right">
                        {margin > 0 ? (
                          <Badge tone="success">{formatCents(margin, currency)} ({marginPct}%)</Badge>
                        ) : margin < 0 ? (
                          <Badge tone="danger">−{formatCents(Math.abs(margin), currency)}</Badge>
                        ) : (
                          <Badge tone="neutral">0%</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </SectionCardBody>
        </SectionCard>
      ))}
    </div>
  );
}
