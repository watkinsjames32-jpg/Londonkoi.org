import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'
import { CATALOG, DOWNLOAD_STORE } from '../lib/catalog.mts'
import { jsonError, stripeKey, verifyPaidSession } from '../lib/stripe.mts'

/**
 * Streams a purchased track. Payment is re-verified with Stripe on every hit, so
 * the audio stays private even though the URL is just a link in the browser.
 */
export default async (req: Request, context: Context) => {
  const secretKey = stripeKey()

  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not configured')
    return jsonError(500, 'Downloads are not configured yet.')
  }

  const trackId = context.params.trackId ?? ''
  const item = CATALOG[trackId]

  if (!item?.download) {
    return jsonError(404, 'That track is not available for download.')
  }

  const sessionId = new URL(req.url).searchParams.get('session_id')
  const result = await verifyPaidSession(sessionId, secretKey)

  if (!result.ok) {
    return jsonError(result.status, result.error)
  }

  if (!result.purchasedIds.includes(trackId)) {
    return jsonError(403, 'That track was not part of this purchase.')
  }

  let audio: ReadableStream | null = null

  try {
    audio = (await getStore(DOWNLOAD_STORE).get(item.download.key, { type: 'stream' })) as ReadableStream | null
  } catch (error) {
    console.error(`Could not read ${item.download.key} from blobs`, error)
    return jsonError(502, 'The download could not be read. Please try again.')
  }

  if (!audio) {
    console.error(`Missing audio file for "${trackId}" at key "${item.download.key}"`)
    return jsonError(503, 'Your payment went through, but this file is not uploaded yet. Email us and we will send it.')
  }

  return new Response(audio, {
    headers: {
      'Content-Type': item.download.contentType,
      'Content-Disposition': `attachment; filename="${item.download.filename}"`,
      'Cache-Control': 'private, no-store'
    }
  })
}

export const config: Config = {
  path: '/api/download/:trackId',
  method: 'GET'
}
