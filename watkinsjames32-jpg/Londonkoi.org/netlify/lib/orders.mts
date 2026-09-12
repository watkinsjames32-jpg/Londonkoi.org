import { getDatabase } from '@netlify/database'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  DOWNLOAD_WINDOW_DAYS,
  MAX_DOWNLOADS_PER_TRACK,
  getTrack,
  matchTrackByName
} from './catalog.mjs'

export type OrderRow = {
  id: number
  stripe_session_id: string
  email: string | null
  download_token: string
  amount_total: number | null
  currency: string
  source: string
  created_at: string
  expires_at: string
}

export type OrderItemRow = {
  id: number
  order_id: number
  track_id: string
  title: string
  download_count: number
  max_downloads: number
}

function database() {
  return getDatabase()
}

export function newDownloadToken(): string {
  return randomBytes(24).toString('base64url')
}

// Stripe signs the raw request body, so this must run before any JSON parsing.
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300
): boolean {
  if (!header) return false

  let timestamp = ''
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key === 't') timestamp = value
    else if (key === 'v1') signatures.push(value)
  }
  if (!timestamp || signatures.length === 0) return false

  const signedAt = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(signedAt)) return false
  if (Math.abs(Date.now() / 1000 - signedAt) > toleranceSeconds) return false

  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex'),
    'hex'
  )
  return signatures.some((signature) => {
    let candidate: Buffer
    try {
      candidate = Buffer.from(signature, 'hex')
    } catch {
      return false
    }
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  })
}

export async function stripeFetch(path: string, init: RequestInit = {}): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(init.headers ?? {})
    }
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.error?.message || `Stripe request failed (${response.status})`)
  }
  return data
}

export function retrieveSession(sessionId: string): Promise<any> {
  return stripeFetch(
    `checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`
  )
}

// A session started on this site carries its track ids in metadata. Payment Link
// purchases do not, so fall back to matching line item names to the catalog.
export function resolveTrackIds(session: any): string[] {
  const ids = new Set<string>()

  const metadata = typeof session?.metadata?.track_ids === 'string' ? session.metadata.track_ids : ''
  for (const candidate of metadata.split(',')) {
    const id = candidate.trim()
    if (id && getTrack(id)) ids.add(id)
  }
  if (ids.size > 0) return [...ids]

  for (const lineItem of session?.line_items?.data ?? []) {
    const name = lineItem?.description || lineItem?.price?.product?.name || ''
    const track = matchTrackByName(String(name))
    if (track) ids.add(track.id)
  }
  return [...ids]
}

export function isExpired(order: Pick<OrderRow, 'expires_at'>): boolean {
  return new Date(order.expires_at).getTime() < Date.now()
}

export async function findOrderByToken(token: string): Promise<OrderRow | undefined> {
  const rows = await database().sql`
    SELECT * FROM music_orders WHERE download_token = ${token}
  `
  return rows[0] as OrderRow | undefined
}

export async function findOrderBySession(sessionId: string): Promise<OrderRow | undefined> {
  const rows = await database().sql`
    SELECT * FROM music_orders WHERE stripe_session_id = ${sessionId}
  `
  return rows[0] as OrderRow | undefined
}

export async function listItems(orderId: number): Promise<OrderItemRow[]> {
  const rows = await database().sql`
    SELECT * FROM music_order_items WHERE order_id = ${orderId} ORDER BY id
  `
  return rows as OrderItemRow[]
}

// Safe to call more than once for the same session: the webhook and the download
// page both reach for it, and whichever arrives first wins.
export async function grantOrder(
  session: any,
  source: string
): Promise<{ order: OrderRow; items: OrderItemRow[] }> {
  const db = database()
  const email = session?.customer_details?.email ?? session?.customer_email ?? null
  const paymentIntent =
    typeof session?.payment_intent === 'string'
      ? session.payment_intent
      : session?.payment_intent?.id ?? null
  const expiresAt = new Date(Date.now() + DOWNLOAD_WINDOW_DAYS * 86_400_000).toISOString()

  const inserted = await db.sql`
    INSERT INTO music_orders
      (stripe_session_id, stripe_payment_intent, email, download_token,
       amount_total, currency, source, expires_at)
    VALUES
      (${session.id}, ${paymentIntent}, ${email}, ${newDownloadToken()},
       ${session.amount_total ?? null}, ${session.currency ?? 'usd'}, ${source}, ${expiresAt})
    ON CONFLICT (stripe_session_id) DO NOTHING
    RETURNING *
  `

  const order = (inserted[0] as OrderRow | undefined) ?? (await findOrderBySession(session.id))
  if (!order) throw new Error(`Could not record order for session ${session.id}`)

  for (const trackId of resolveTrackIds(session)) {
    const track = getTrack(trackId)
    if (!track) continue
    await db.sql`
      INSERT INTO music_order_items (order_id, track_id, title, max_downloads)
      VALUES (${order.id}, ${track.id}, ${track.title}, ${MAX_DOWNLOADS_PER_TRACK})
      ON CONFLICT (order_id, track_id) DO NOTHING
    `
  }

  return { order, items: await listItems(order.id) }
}

// Counts the download and enforces the per-track limit in one statement, so two
// parallel clicks cannot both slip past the last remaining download.
export async function consumeDownload(
  orderId: number,
  trackId: string
): Promise<{ download_count: number; max_downloads: number } | undefined> {
  const rows = await database().sql`
    UPDATE music_order_items
    SET download_count = download_count + 1, last_downloaded_at = NOW()
    WHERE order_id = ${orderId}
      AND track_id = ${trackId}
      AND download_count < max_downloads
    RETURNING download_count, max_downloads
  `
  return rows[0] as { download_count: number; max_downloads: number } | undefined
}

export async function refundDownloadCount(orderId: number, trackId: string): Promise<void> {
  await database().sql`
    UPDATE music_order_items
    SET download_count = GREATEST(download_count - 1, 0)
    WHERE order_id = ${orderId} AND track_id = ${trackId}
  `
}
