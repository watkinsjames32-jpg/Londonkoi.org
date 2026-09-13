import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import { CATALOG, DOWNLOAD_STORE } from '../lib/catalog.mts'
import { jsonError, sessionExpiresAt, stripeKey, verifyPaidSession } from '../lib/stripe.mts'

/**
 * Backs the /download page: confirms a Checkout Session was paid and lists the
 * tracks it unlocked, without exposing the audio itself.
 */
export default async (req: Request) => {
  const secretKey = stripeKey()

  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not configured')
    return jsonError(500, 'Downloads are not configured yet.')
  }

  const sessionId = new URL(req.url).searchParams.get('session_id')
  const result = await verifyPaidSession(sessionId, secretKey)

  if (!result.ok) {
    return jsonError(result.status, result.error)
  }

  const store = getStore(DOWNLOAD_STORE)

  const downloads = await Promise.all(
    result.purchasedIds
      .filter((id) => CATALOG[id]?.download)
      .map(async (id) => {
        const item = CATALOG[id]
        let ready = false

        try {
          ready = (await store.getMetadata(item.download!.key)) !== null
        } catch (error) {
          console.error(`Could not check availability of ${item.download!.key}`, error)
        }

        return {
          id,
          name: item.name,
          filename: item.download!.filename,
          url: `/api/download/${id}?session_id=${encodeURIComponent(result.session.id)}`,
          ready
        }
      })
  )

  return Response.json(
    {
      paid: true,
      email: result.session.customer_details?.email ?? null,
      expiresAt: sessionExpiresAt(result.session),
      downloads
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

export const config: Config = {
  path: '/api/purchase',
  method: 'GET'
}
