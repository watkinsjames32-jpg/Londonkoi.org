import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { timingSafeEqual } from 'node:crypto'
import { MASTERS_STORE, TRACKS, getTrack } from '../lib/catalog.mjs'

const CHUNK_PREFIX = 'incoming/'
const MAX_TOTAL_BYTES = 80 * 1024 * 1024
const MAX_CHUNKS = 40

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function authorize(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.MUSIC_ADMIN_TOKEN
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: 'Uploads are switched off until a MUSIC_ADMIN_TOKEN is set on the site.'
    }
  }
  const provided = req.headers.get('x-admin-token') ?? ''
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: 'That admin token is not right.' }
  }
  return { ok: true }
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '')
}

async function listStatus() {
  const store = getStore(MASTERS_STORE)
  return Promise.all(
    Object.values(TRACKS).map(async (track) => {
      let metadata: Record<string, unknown> | undefined
      try {
        metadata = (await store.getMetadata(track.masterKey))?.metadata
      } catch (error) {
        console.error(`Could not read metadata for ${track.masterKey}`, error)
      }
      return {
        trackId: track.id,
        title: track.title,
        ready: Boolean(metadata),
        size: metadata?.size ?? null,
        uploadedAt: metadata?.uploadedAt ?? null
      }
    })
  )
}

export default async (req: Request) => {
  const auth = authorize(req)
  if (!auth.ok) return json({ error: auth.error }, auth.status)

  if (req.method === 'GET') {
    return json({ tracks: await listStatus() })
  }

  const store = getStore(MASTERS_STORE)
  const url = new URL(req.url)

  // Netlify caps a single request body well below the size of a full-length
  // master, so the browser sends the file in chunks and we join them here.
  if (url.searchParams.get('finalize') === '1') {
    let payload: any
    try {
      payload = await req.json()
    } catch {
      return json({ error: 'Invalid request body.' }, 400)
    }

    const track = getTrack(String(payload?.trackId ?? ''))
    const uploadId = safeId(String(payload?.uploadId ?? ''))
    const totalChunks = Number.parseInt(payload?.totalChunks, 10)
    if (!track) return json({ error: 'Unknown track.' }, 400)
    if (!uploadId) return json({ error: 'Missing upload id.' }, 400)
    if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) {
      return json({ error: 'Invalid chunk count.' }, 400)
    }

    const parts: Uint8Array[] = []
    let total = 0
    for (let index = 0; index < totalChunks; index += 1) {
      const chunk = (await store.get(`${CHUNK_PREFIX}${uploadId}/${index}`, {
        type: 'arrayBuffer'
      })) as ArrayBuffer | null
      if (!chunk) return json({ error: `Chunk ${index + 1} of ${totalChunks} is missing.` }, 409)
      total += chunk.byteLength
      if (total > MAX_TOTAL_BYTES) return json({ error: 'That file is too large.' }, 413)
      parts.push(new Uint8Array(chunk))
    }

    const combined = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
      combined.set(part, offset)
      offset += part.byteLength
    }

    const contentType = String(payload?.contentType || 'audio/mpeg')
    await store.set(track.masterKey, combined.buffer as ArrayBuffer, {
      metadata: {
        contentType,
        size: total,
        uploadedAt: new Date().toISOString(),
        trackId: track.id
      }
    })

    await Promise.all(
      Array.from({ length: totalChunks }, (_unused, index) =>
        store.delete(`${CHUNK_PREFIX}${uploadId}/${index}`).catch(() => undefined)
      )
    )

    console.log(`Stored master for ${track.id} (${total} bytes)`)
    return json({ ok: true, trackId: track.id, size: total })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ error: 'Expected a file upload.' }, 400)
  }

  const track = getTrack(String(form.get('trackId') ?? ''))
  const uploadId = safeId(String(form.get('uploadId') ?? ''))
  const chunkIndex = Number.parseInt(String(form.get('chunkIndex') ?? ''), 10)
  const chunk = form.get('chunk')

  if (!track) return json({ error: 'Unknown track.' }, 400)
  if (!uploadId) return json({ error: 'Missing upload id.' }, 400)
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= MAX_CHUNKS) {
    return json({ error: 'Invalid chunk index.' }, 400)
  }
  if (!(chunk instanceof Blob)) return json({ error: 'Missing file chunk.' }, 400)

  await store.set(`${CHUNK_PREFIX}${uploadId}/${chunkIndex}`, await chunk.arrayBuffer())
  return json({ ok: true, chunkIndex })
}

export const config: Config = {
  path: '/api/upload-master',
  method: ['GET', 'POST']
}
