import type { Config } from '@netlify/functions'
import { grantOrder, retrieveSession, verifyStripeSignature } from '../lib/orders.mjs'

const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded'
])

export default async (req: Request) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured')
    return new Response('Webhook is not configured', { status: 500 })
  }

  // Must read the unparsed body: the signature covers the exact bytes Stripe sent.
  const rawBody = await req.text()
  if (!verifyStripeSignature(rawBody, req.headers.get('stripe-signature'), secret)) {
    return new Response('Invalid signature', { status: 400 })
  }

  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid payload', { status: 400 })
  }

  if (!HANDLED.has(event?.type)) {
    return new Response('Ignored', { status: 200 })
  }

  try {
    const session = event.data?.object
    if (!session?.id) return new Response('Ignored', { status: 200 })
    if (session.payment_status !== 'paid') {
      return new Response('Awaiting payment', { status: 200 })
    }

    // Line items are not included in the event payload, and Payment Link
    // purchases need them to work out which track was bought.
    const detailed = session.line_items?.data?.length ? session : await retrieveSession(session.id)
    const source = detailed?.metadata?.track_ids ? 'checkout' : 'payment_link'
    const { order, items } = await grantOrder(detailed, source)

    console.log(
      `Recorded order ${order.id} for session ${session.id} with ${items.length} downloadable item(s)`
    )
    return new Response('OK', { status: 200 })
  } catch (error) {
    // A non-2xx tells Stripe to retry, which is what we want on a transient failure.
    console.error('Failed to record purchase', error)
    return new Response('Failed to record purchase', { status: 500 })
  }
}

export const config: Config = {
  path: '/api/stripe-webhook',
  method: 'POST'
}
