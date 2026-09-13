import { DOWNLOAD_WINDOW_DAYS } from './catalog.mts'

const STRIPE_API = 'https://api.stripe.com/v1'

export type StripeSession = {
  id: string
  payment_status?: string
  status?: string
  created?: number
  customer_details?: { email?: string | null } | null
  metadata?: Record<string, string> | null
}

export const stripeKey = () => Netlify.env.get('STRIPE_SECRET_KEY')

export const stripeRequest = async (path: string, secretKey: string, body?: URLSearchParams) => {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body?.toString()
  })

  return { ok: response.ok, data: await response.json() }
}

export type PaidSession =
  | { ok: true; session: StripeSession; purchasedIds: string[] }
  | { ok: false; status: number; error: string }

/**
 * Re-checks a Checkout Session with Stripe on every request. Nothing the browser
 * sends is trusted beyond the session id, so a made-up id unlocks nothing.
 */
export const verifyPaidSession = async (sessionId: string | null, secretKey: string): Promise<PaidSession> => {
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return { ok: false, status: 400, error: 'That download link is missing a valid checkout reference.' }
  }

  const { ok, data } = await stripeRequest(`/checkout/sessions/${sessionId}`, secretKey)

  if (!ok) {
    const status = data?.error?.type === 'invalid_request_error' ? 404 : 502
    return { ok: false, status, error: 'We could not find that purchase in Stripe.' }
  }

  const session = data as StripeSession

  if (session.payment_status !== 'paid') {
    return { ok: false, status: 402, error: 'This purchase has not been paid for yet.' }
  }

  const createdMs = (session.created ?? 0) * 1000
  const expiresAt = createdMs + DOWNLOAD_WINDOW_DAYS * 24 * 60 * 60 * 1000

  if (createdMs && Date.now() > expiresAt) {
    return {
      ok: false,
      status: 410,
      error: `Download links expire ${DOWNLOAD_WINDOW_DAYS} days after purchase. Email us and we will re-send your music.`
    }
  }

  const purchasedIds = (session.metadata?.download_ids ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  return { ok: true, session, purchasedIds }
}

export const sessionExpiresAt = (session: StripeSession) =>
  new Date((session.created ?? 0) * 1000 + DOWNLOAD_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

export const jsonError = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
