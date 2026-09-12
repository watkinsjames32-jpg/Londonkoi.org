import type { Config } from '@netlify/functions'
import { getPurchasable, getTrack } from '../lib/catalog.mjs'

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

export default async (req: Request) => {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not configured')
    return json({ error: 'Checkout is not configured yet.' }, 500)
  }

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }

  const requested = Array.isArray(payload?.items) ? payload.items : []
  const lineItems: Array<{ id: string; title: string; priceCents: number; quantity: number }> = []
  for (const item of requested) {
    const product = getPurchasable(String(item?.id ?? ''))
    if (!product) continue
    const quantity = Math.max(1, Math.min(20, Number.parseInt(item?.quantity, 10) || 1))
    lineItems.push({ id: product.id, title: product.title, priceCents: product.priceCents, quantity })
  }

  if (lineItems.length === 0) {
    return json({ error: 'Nothing to check out.' }, 400)
  }

  const origin = new URL(req.url).origin
  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('success_url', `${origin}/download.html?session_id={CHECKOUT_SESSION_ID}`)
  params.set('cancel_url', `${origin}/?checkout=cancelled#music`)
  params.set('billing_address_collection', 'auto')

  lineItems.forEach((item, index) => {
    params.set(`line_items[${index}][price_data][currency]`, 'usd')
    params.set(`line_items[${index}][price_data][unit_amount]`, String(item.priceCents))
    params.set(`line_items[${index}][price_data][product_data][name]`, item.title)
    params.set(`line_items[${index}][quantity]`, String(item.quantity))
  })

  // The webhook reads this back to decide which files the buyer may download.
  const trackIds = lineItems.filter((item) => getTrack(item.id)).map((item) => item.id)
  if (trackIds.length > 0) {
    params.set('metadata[track_ids]', trackIds.join(','))
  }

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    })
    const session = await response.json()

    if (!response.ok || !session?.url) {
      console.error('Stripe checkout error', session)
      return json({ error: session?.error?.message || 'Unable to start checkout.' }, 502)
    }

    return json({ url: session.url })
  } catch (error) {
    console.error('Checkout function failed', error)
    return json({ error: 'Unable to connect to Stripe.' }, 500)
  }
}

export const config: Config = {
  path: '/api/create-checkout',
  method: 'POST'
}
