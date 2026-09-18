// Small Stripe REST helpers. The site only needs two calls, so it talks to the
// API directly instead of pulling in the Stripe SDK.

const STRIPE_API = 'https://api.stripe.com/v1';
const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_-]{8,255}$/;

export function getSecretKey() {
  return Netlify.env.get('STRIPE_SECRET_KEY') || '';
}

export function isValidSessionId(sessionId) {
  return typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId);
}

export async function createCheckoutSession(params) {
  const response = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Stripe rejected the checkout request.');
  }
  return data;
}

// Returns the Stripe session, or null when Stripe does not recognise the id.
export async function retrieveCheckoutSession(sessionId) {
  const response = await fetch(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${getSecretKey()}` }
  });

  const data = await response.json();

  // Stripe answers with resource_missing for an id it has never issued, which
  // is how a stale or invented reference gets reported as "not found".
  if (response.status === 404 || data?.error?.code === 'resource_missing') {
    return null;
  }

  if (!response.ok) {
    throw new Error(data?.error?.message || 'Stripe could not confirm this purchase.');
  }
  return data;
}

export function isPaid(session) {
  return Boolean(session) && session.payment_status === 'paid';
}
