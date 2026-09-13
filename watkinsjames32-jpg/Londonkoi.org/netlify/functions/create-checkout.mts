import type { Config, Context } from '@netlify/functions'
import { CATALOG } from '../lib/catalog.mts'
import { jsonError, stripeKey, stripeRequest } from '../lib/stripe.mts'

type RequestedItem = { id?: string; quantity?: number | string }

/**
 * Only ever redirect buyers back to this site. `req.url` is normally enough, but
 * the allow-list stops a forged Host header from turning success_url into an
 * open redirect.
 */
const resolveOrigin = (req: Request, context: Context) => {
  const siteUrl = context.site?.url ?? 'https://londonkoi.org'
  const requested = new URL(req.url).origin
  const { hostname } = new URL(requested)

  const allowed =
    hostname === 'londonkoi.org' ||
    hostname === 'www.londonkoi.org' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.netlify.app') ||
    requested === new URL(siteUrl).origin

  return allowed ? requested : new URL(siteUrl).origin
}

const normalizeItems = (payload: unknown) => {
  const raw = Array.isArray((payload as { items?: RequestedItem[] })?.items)
    ? (payload as { items: RequestedItem[] }).items
    : []
  const items: { id: string; quantity: number }[] = []

  for (const item of raw) {
    const id = typeof item?.id === 'string' ? item.id : ''
    if (!CATALOG[id] || items.some((existing) => existing.id === id)) continue
    const quantity = Math.max(1, Math.min(20, Number.parseInt(String(item?.quantity ?? 1), 10) || 1))
    items.push({ id, quantity })
  }

  return items
}

export default async (req: Request, context: Context) => {
  const secretKey = stripeKey()

  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not configured')
    return jsonError(500, 'Checkout is not configured yet.')
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return jsonError(400, 'Invalid request body.')
  }

  const items = normalizeItems(payload)

  if (!items.length) {
    return jsonError(400, 'Nothing available to buy was selected.')
  }

  const origin = resolveOrigin(req, context)
  const downloadIds = items.filter(({ id }) => CATALOG[id].download).map(({ id }) => id)

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  // Stripe swaps {CHECKOUT_SESSION_ID} for the real id, which the download page
  // hands back to us so we can confirm payment before releasing any audio.
  params.set('success_url', `${origin}/download?session_id={CHECKOUT_SESSION_ID}`)
  params.set('cancel_url', `${origin}/?checkout=cancelled#music`)
  params.set('billing_address_collection', 'auto')

  if (downloadIds.length) {
    params.set('metadata[download_ids]', downloadIds.join(','))
  }

  items.forEach(({ id, quantity }, index) => {
    const item = CATALOG[id]
    params.set(`line_items[${index}][price_data][currency]`, 'usd')
    params.set(`line_items[${index}][price_data][unit_amount]`, String(item.unitAmount))
    params.set(`line_items[${index}][price_data][product_data][name]`, item.name)
    params.set(`line_items[${index}][quantity]`, String(quantity))
  })

  try {
    const { ok, data } = await stripeRequest('/checkout/sessions', secretKey, params)

    if (!ok || !data?.url) {
      console.error('Stripe rejected the checkout session', data?.error?.message ?? data)
      return jsonError(502, data?.error?.message ?? 'Unable to start checkout.')
    }

    return Response.json({ url: data.url }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Checkout function failed', error)
    return jsonError(502, 'Unable to reach Stripe. Please try again.')
  }
}

export const config: Config = {
  path: '/api/checkout',
  method: 'POST'
}
