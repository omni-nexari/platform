/**
 * Stripe SDK singleton + helpers.
 *
 * Pattern mirrors redis.ts: lazy-init, returns null when the key is absent,
 * all features degrade gracefully so the API boots in dev without Stripe creds.
 *
 * Required env vars (production):
 *   STRIPE_SECRET_KEY        — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET    — whsec_...
 */

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

/** Returns a shared Stripe instance, or null if STRIPE_SECRET_KEY is not set. */
export function getStripe(): Stripe | null {
  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key) return null;
  if (!_stripe) {
    _stripe = new Stripe(key, {
      apiVersion: '2026-05-27.dahlia',
      typescript: true,
    });
  }
  return _stripe;
}

/** Throws with a descriptive message if Stripe is not configured. */
export function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
  return stripe;
}

// ── Webhook verification ──────────────────────────────────────────────────────

/**
 * Verify and parse a Stripe webhook event from the raw request body.
 * Returns null (and logs a warning) if verification fails — never throws
 * so the HTTP handler can return 400 without an unhandled rejection.
 */
export function constructWebhookEvent(
  rawBody: Buffer | string,
  signature: string,
): Stripe.Event | null {
  const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!webhookSecret) {
    console.warn('[stripe] STRIPE_WEBHOOK_SECRET not set — skipping webhook signature check');
    // In dev only: attempt to parse without verification
    try {
      return JSON.parse(rawBody.toString()) as Stripe.Event;
    } catch {
      return null;
    }
  }

  const stripe = getStripe();
  if (!stripe) return null;

  try {
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.warn('[stripe] Webhook signature verification failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Checkout / Portal sessions ────────────────────────────────────────────────

export interface CheckoutParams {
  /** Stripe Price ID for the selected plan (from pricing_plan_prices.stripe_price_id) */
  stripePriceId: string;
  /** Stripe Price ID for extra-screen metered add-on (from pricing_plan_prices.stripe_extra_screen_price_id) */
  stripeExtraScreenPriceId?: string | null;
  /** Pre-existing Stripe customer ID (if org already has one) */
  stripeCustomerId?: string | null;
  /** Trial end timestamp in seconds (Unix). Null for no trial on Stripe side. */
  trialEnd?: number | null;
  /** URL Stripe redirects to on success — must include {CHECKOUT_SESSION_ID} placeholder */
  successUrl: string;
  /** URL Stripe redirects to on cancel */
  cancelUrl: string;
  /** Metadata passed through to the webhook event */
  metadata?: Record<string, string>;
}

export async function createCheckoutSession(params: CheckoutParams): Promise<Stripe.Checkout.Session> {
  const stripe = requireStripe();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: params.stripePriceId },
  ];

  // Add extra-screen metered price as a second line item if provided
  if (params.stripeExtraScreenPriceId) {
    lineItems.push({ price: params.stripeExtraScreenPriceId });
  }

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: lineItems,
    ...(params.stripeCustomerId ? { customer: params.stripeCustomerId } : {}),
    subscription_data: {
      ...(params.trialEnd ? { trial_end: params.trialEnd } : {}),
      metadata: params.metadata ?? {},
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: params.metadata ?? {},
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
  });
}

export async function createCustomerPortalSession(
  stripeCustomerId: string,
  returnUrl: string,
): Promise<Stripe.BillingPortal.Session> {
  const stripe = requireStripe();
  return stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
}

// ── Metered screen usage reporting ───────────────────────────────────────────

/**
 * Update the quantity on a licensed per-unit subscription item to reflect
 * the current screen count. Stripe will prorate the invoice automatically.
 * Returns null if Stripe is not configured or the call fails.
 */
export async function reportScreenUsage(
  subscriptionItemId: string,
  screenCount: number,
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  try {
    const item = await stripe.subscriptionItems.update(subscriptionItemId, {
      quantity: Math.max(1, screenCount), // Stripe requires quantity >= 1
      proration_behavior: 'create_prorations',
    });
    return item.id;
  } catch (err) {
    console.error('[stripe] Failed to update subscription item quantity:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Customer helpers ──────────────────────────────────────────────────────────

export async function createStripeCustomer(params: {
  email: string;
  name: string;
  orgId: string;
  currency: string;
}): Promise<Stripe.Customer> {
  const stripe = requireStripe();
  return stripe.customers.create({
    email: params.email,
    name: params.name,
    metadata: { orgId: params.orgId, currency: params.currency },
  });
}
