import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { MASTERS_STORE, getTrack } from '../lib/catalog.mjs'
import {
  consumeDownload,
  findOrderByToken,
  isExpired,
  listItems,
  refundDownloadCount
} from '../lib/orders.mjs'

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export default async (req: Request, context: Context) => {
  const token = String(context.params?.token ?? '')
  const trackId = String(context.params?.trackId ?? '')

  const order = await findOrderByToken(token)
  if (!order) return json({ error: 'This download link is not valid.' }, 404)
  if (isExpired(order)) {
    return json({ error: 'This download link has expired. Contact the booking team for help.' }, 410)
  }

  const items = await listItems(order.id)
  const item = items.find((candidate) => candidate.track_id === trackId)
  const track = getTrack(trackId)
  if (!item || !track) return json({ error: 'That track is not part of this purchase.' }, 404)

  const store = getStore(MASTERS_STORE)

  // Confirm the file is actually there before spending one of the buyer's downloads.
  let exists = false
  try {
    exists = Boolean(await store.getMetadata(track.masterKey))
  } catch (error) {
    console.error(`Could not check master ${track.masterKey}`, error)
  }
  if (!exists) {
    return json(
      {
        error: `"${track.title}" has not been uploaded yet. Your purchase is saved - this link will work once the file is added.`,
        code: 'master_missing'
      },
      503
    )
  }

  const consumed = await consumeDownload(order.id, trackId)
  if (!consumed) {
    return json(
      {
        error: `You have used all ${item.max_downloads} downloads for "${item.title}".`,
        code: 'limit_reached'
      },
      403
    )
  }

  let result: { data: ReadableStream; metadata: Record<string, unknown> } | null = null
  try {
    result = (await store.getWithMetadata(track.masterKey, { type: 'stream' })) as any
  } catch (error) {
    console.error(`Could not read master ${track.masterKey}`, error)
  }

  if (!result?.data) {
    await refundDownloadCount(order.id, trackId)
    return json({ error: 'The file could not be read. Please try again.', code: 'master_missing' }, 503)
  }

  const headers: Record<string, string> = {
    'Content-Type': String(result.metadata?.contentType || 'audio/mpeg'),
    'Content-Disposition': contentDisposition(track.downloadName),
    'Cache-Control': 'no-store',
    'X-Download-Remaining': String(Math.max(0, consumed.max_downloads - consumed.download_count))
  }
  const size = Number(result.metadata?.size)
  if (Number.isFinite(size) && size > 0) headers['Content-Length'] = String(size)

  return new Response(result.data, { status: 200, headers })
}

export const config: Config = {
  path: '/api/download/:token/:trackId',
  method: 'GET'
}
