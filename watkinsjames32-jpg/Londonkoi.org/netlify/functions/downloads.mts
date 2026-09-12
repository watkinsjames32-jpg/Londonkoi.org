import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { MASTERS_STORE, getTrack } from '../lib/catalog.mjs'
import {
  findOrderBySession,
  findOrderByToken,
  grantOrder,
  isExpired,
  listItems,
  retrieveSession,
  type OrderRow
} from '../lib/orders.mjs'

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function masterIsReady(key: string): Promise<boolean> {
  try {
    return Boolean(await getStore(MASTERS_STORE).getMetadata(key))
  } catch (error) {
    console.error(`Could not check master ${key}`, error)
    return false
  }
}

export default async (req: Request) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')?.trim()
  const sessionId = url.searchParams.get('session_id')?.trim()

  let order: OrderRow | undefined
  if (token) {
    order = await findOrderByToken(token)
  } else if (sessionId) {
    order = await findOrderBySession(sessionId)
    if (!order) {
      // The buyer can land here before Stripe's webhook arrives, so confirm the
      // payment directly and record the order ourselves if it has gone through.
      let session: any
      try {
        session = await retrieveSession(sessionId)
      } catch (error) {
        console.error('Could not retrieve checkout session', error)
        return json({ status: 'not_found' }, 404)
      }
      if (session?.payment_status !== 'paid') {
        return json({ status: 'pending' })
      }
      const source = session?.metadata?.track_ids ? 'checkout' : 'payment_link'
      order = (await grantOrder(session, source)).order
    }
  } else {
    return json({ error: 'Provide a download token or a checkout session id.' }, 400)
  }

  if (!order) return json({ status: 'not_found' }, 404)
  if (isExpired(order)) return json({ status: 'expired', expiresAt: order.expires_at }, 410)

  const items = await listItems(order.id)
  const tracks = await Promise.all(
    items.map(async (item) => {
      const track = getTrack(item.track_id)
      return {
        id: item.track_id,
        title: item.title,
        remaining: Math.max(0, item.max_downloads - item.download_count),
        maxDownloads: item.max_downloads,
        ready: track ? await masterIsReady(track.masterKey) : false,
        url: `/api/download/${encodeURIComponent(order!.download_token)}/${encodeURIComponent(item.track_id)}`
      }
    })
  )

  return json({
    status: 'ready',
    token: order.download_token,
    expiresAt: order.expires_at,
    tracks
  })
}

export const config: Config = {
  path: '/api/downloads',
  method: 'GET'
}
