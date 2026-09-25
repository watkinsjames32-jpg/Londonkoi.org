import { encodeBasket, getItem, isPurchasable } from '../lib/catalog.mjs';
import { createCheckoutSession, getSecretKey } from '../lib/stripe.mjs';

const MAX_QUANTITY = 20;

export default async (req) => {
  if (!getSecretKey()) {
    console.error('STRIPE_SECRET_KEY is not configured');
    return Response.json({ error: 'Checkout is not configured yet.' }, { status: 500 });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const requested = Array.isArray(payload?.items) ? payload.items : [];
  const basket = [];

  for (const entry of requested) {
    const item = getItem(entry?.id);
    if (!isPurchasable(item)) continue;

    const parsed = Number.parseInt(entry?.quantity, 10);
    const quantity = Math.max(1, Math.min(MAX_QUANTITY, Number.isFinite(parsed) ? parsed : 1));
    basket.push({ ...item, quantity });
  }

  if (!basket.length) {
    return Response.json({ error: 'Nothing in this order is available to buy yet.' }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  // {CHECKOUT_SESSION_ID} is substituted by Stripe on redirect, which is what
  // lets the site confirm the payment and release the download.
  params.set('success_url', `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}#music`);
  params.set('cancel_url', `${origin}/?checkout=cancelled#music`);
  params.set('billing_address_collection', 'auto');
  params.set('metadata[basket]', encodeBasket(basket));

  basket.forEach((item, index) => {
    params.set(`line_items[${index}][price_data][currency]`, 'usd');
    params.set(`line_items[${index}][price_data][unit_amount]`, String(item.unit_amount));
    params.set(`line_items[${index}][price_data][product_data][name]`, item.name);
    params.set(`line_items[${index}][quantity]`, String(item.quantity));
  });

  // Music is delivered as a download from this site, so Stripe collects an
  // email address to reach the buyer if a download ever needs re-sending.
  if (basket.some((item) => item.kind === 'music')) {
    params.set('customer_creation', 'always');
  }

  try {
    const session = await createCheckoutSession(params);
    if (!session.url) {
      console.error('Stripe returned a session without a checkout URL', session.id);
      return Response.json({ error: 'Unable to start checkout.' }, { status: 502 });
    }
    return Response.json({ url: session.url });
  } catch (error) {
    console.error('Checkout failed', error);
    return Response.json({ error: 'Unable to start checkout. Please try again.' }, { status: 502 });
  }
};

export const config = {
  path: '/api/checkout',
  method: 'POST'
};

