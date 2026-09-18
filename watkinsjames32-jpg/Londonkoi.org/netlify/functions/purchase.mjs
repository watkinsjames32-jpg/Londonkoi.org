import { getStore } from '@netlify/blobs';
import { MUSIC_STORE, decodeBasket, masterKey } from '../lib/catalog.mjs';
import { getSecretKey, isPaid, isValidSessionId, retrieveCheckoutSession } from '../lib/stripe.mjs';

// Confirms a completed Stripe Checkout session and reports which tracks the
// buyer may now download. The browser calls this after Stripe redirects back,
// and again on later visits so downloads survive a page reload.
export default async (req) => {
  const sessionId = new URL(req.url).searchParams.get('session_id') || '';

  if (!isValidSessionId(sessionId)) {
    return Response.json({ error: 'Missing or malformed purchase reference.' }, { status: 400 });
  }

  if (!getSecretKey()) {
    console.error('STRIPE_SECRET_KEY is not configured');
    return Response.json({ error: 'Purchases cannot be confirmed right now.' }, { status: 500 });
  }

  let session;
  try {
    session = await retrieveCheckoutSession(sessionId);
  } catch (error) {
    console.error('Could not confirm purchase', error);
    return Response.json({ error: 'Could not confirm this purchase. Please try again.' }, { status: 502 });
  }

  if (!session) {
    return Response.json({ error: 'That purchase reference was not recognised.' }, { status: 404 });
  }

  if (!isPaid(session)) {
    return Response.json({ paid: false, downloads: [] });
  }

  const tracks = decodeBasket(session.metadata?.basket).filter((item) => item.kind === 'music');
  const store = getStore({ name: MUSIC_STORE, consistency: 'strong' });

  const downloads = await Promise.all(
    tracks.map(async (track) => {
      // A track is only offered as a download once its audio file is in place.
      const stored = await store.getMetadata(masterKey(track.id)).catch(() => null);
      return { id: track.id, name: track.name, ready: Boolean(stored) };
    })
  );

  return Response.json({
    paid: true,
    purchasedAt: session.created ? session.created * 1000 : null,
    downloads
  });
};

export const config = {
  path: '/api/purchase',
  method: 'GET'
};
