import { getStore } from '@netlify/blobs';
import { MUSIC_STORE, decodeBasket, getItem, masterKey } from '../lib/catalog.mjs';
import { getSecretKey, isPaid, isValidSessionId, retrieveCheckoutSession } from '../lib/stripe.mjs';

// Streams a purchased track. Every request re-checks the Stripe session, so a
// download link cannot be shared or replayed without a real paid purchase.
export default async (req) => {
  const params = new URL(req.url).searchParams;
  const sessionId = params.get('session_id') || '';
  const trackId = params.get('track') || '';

  if (!isValidSessionId(sessionId) || !getItem(trackId)) {
    return Response.json({ error: 'Missing or malformed download request.' }, { status: 400 });
  }

  if (!getSecretKey()) {
    console.error('STRIPE_SECRET_KEY is not configured');
    return Response.json({ error: 'Downloads are unavailable right now.' }, { status: 500 });
  }

  let session;
  try {
    session = await retrieveCheckoutSession(sessionId);
  } catch (error) {
    console.error('Could not confirm purchase for download', error);
    return Response.json({ error: 'Could not confirm this purchase. Please try again.' }, { status: 502 });
  }

  if (!session || !isPaid(session)) {
    return Response.json({ error: 'This download is not unlocked.' }, { status: 403 });
  }

  const track = decodeBasket(session.metadata?.basket).find(
    (item) => item.id === trackId && item.kind === 'music'
  );

  if (!track) {
    return Response.json({ error: 'That track was not part of this purchase.' }, { status: 403 });
  }

  const store = getStore({ name: MUSIC_STORE, consistency: 'strong' });
  const stored = await store.getWithMetadata(masterKey(track.id), { type: 'stream' }).catch((error) => {
    console.error(`Could not read master for ${track.id}`, error);
    return null;
  });

  if (!stored) {
    return Response.json(
      { error: 'This track is bought and saved to your order, but the audio file has not been added yet. It will be available here shortly.' },
      { status: 409 }
    );
  }

  const filename = String(stored.metadata?.filename || track.download_name || `${track.id}.mp3`);

  return new Response(stored.data, {
    headers: {
      'Content-Type': String(stored.metadata?.contentType || 'audio/mpeg'),
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store'
    }
  });
};

export const config = {
  path: '/api/download',
  method: 'GET'
};
