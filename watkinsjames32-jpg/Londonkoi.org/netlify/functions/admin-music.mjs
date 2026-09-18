import { getStore } from '@netlify/blobs';
import { CATALOG, MUSIC_STORE, masterKey } from '../lib/catalog.mjs';

// Lets the London Koi team put the purchasable audio files in place (and see
// which are still missing) without a code change or a redeploy. Guarded by the
// SITE_ADMIN_KEY environment variable.
const MAX_BYTES = 6 * 1024 * 1024;

function keyMatches(provided) {
  const expected = Netlify.env.get('SITE_ADMIN_KEY') || '';
  if (!expected || typeof provided !== 'string' || provided.length !== expected.length) {
    return false;
  }
  // Compare every character so the result does not depend on where it differs.
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return mismatch === 0;
}

export default async (req) => {
  if (!Netlify.env.get('SITE_ADMIN_KEY')) {
    console.error('SITE_ADMIN_KEY is not configured');
    return Response.json({ error: 'Uploads are not configured yet.' }, { status: 500 });
  }

  if (!keyMatches(req.headers.get('x-admin-key'))) {
    return Response.json({ error: 'Incorrect admin key.' }, { status: 401 });
  }

  const store = getStore({ name: MUSIC_STORE, consistency: 'strong' });
  const tracks = CATALOG.filter((item) => item.kind === 'music');

  if (req.method === 'GET') {
    const listed = await Promise.all(
      tracks.map(async (track) => {
        const stored = await store.getMetadata(masterKey(track.id)).catch(() => null);
        return {
          id: track.id,
          name: track.name,
          status: track.status,
          filename: stored?.metadata?.filename || null,
          uploadedAt: stored?.metadata?.uploadedAt || null
        };
      })
    );
    return Response.json({ tracks: listed });
  }

  const params = new URL(req.url).searchParams;
  const trackId = params.get('track') || '';
  const track = tracks.find((item) => item.id === trackId);

  if (!track) {
    return Response.json({ error: 'Unknown track.' }, { status: 400 });
  }

  if (req.method === 'DELETE') {
    await store.delete(masterKey(track.id));
    return Response.json({ removed: track.id });
  }

  const audio = await req.arrayBuffer();
  if (!audio.byteLength) {
    return Response.json({ error: 'No audio file was received.' }, { status: 400 });
  }
  if (audio.byteLength > MAX_BYTES) {
    return Response.json({ error: 'That file is larger than the 6 MB upload limit.' }, { status: 413 });
  }

  const filename = (params.get('filename') || track.download_name || `${track.id}.mp3`)
    .replace(/[^\w .()-]/g, '')
    .slice(0, 120);

  await store.set(masterKey(track.id), audio, {
    metadata: {
      filename,
      contentType: req.headers.get('content-type') || 'audio/mpeg',
      uploadedAt: new Date().toISOString()
    }
  });

  return Response.json({ stored: track.id, filename, bytes: audio.byteLength });
};

export const config = {
  path: '/api/admin/music',
  method: ['GET', 'POST', 'PUT', 'DELETE']
};
