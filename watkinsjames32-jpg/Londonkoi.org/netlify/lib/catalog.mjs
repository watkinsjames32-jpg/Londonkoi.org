// Single source of truth for everything that can be bought on londonkoi.org.
// Prices live here rather than in the browser so a visitor cannot change them.

export const CATALOG = [
  {
    id: 'ride_the_wave',
    name: 'Ride The Wave',
    kind: 'music',
    status: 'available',
    unit_amount: 99,
    download_name: 'London Koi - Ride The Wave.mp3'
  },
  {
    id: 'facetime_remix',
    name: 'Facetime Remix',
    kind: 'music',
    status: 'available',
    unit_amount: 99,
    download_name: 'London Koi - Facetime Remix.mp3'
  },
  {
    id: 'be_great',
    name: 'Be Great',
    kind: 'music',
    status: 'available',
    unit_amount: 99,
    download_name: 'London Koi - Be Great.mp3'
  },
  {
    id: 'special',
    name: 'Special',
    kind: 'music',
    status: 'coming-soon',
    unit_amount: 99,
    download_name: 'London Koi - Special.mp3'
  },
  {
    id: 'imma_old_soul',
    name: 'Imma Old Soul',
    kind: 'music',
    status: 'coming-soon',
    unit_amount: 99,
    download_name: 'London Koi - Imma Old Soul.mp3'
  },
  {
    id: 'koi_ware_tee',
    name: 'Koi Ware Tee Shirt',
    kind: 'merch',
    status: 'available',
    unit_amount: 3500
  }
];

export const MUSIC_STORE = 'music-masters';

export function getItem(id) {
  return CATALOG.find((item) => item.id === id) || null;
}

export function isPurchasable(item) {
  return Boolean(item) && item.status === 'available';
}

// Blob key for the purchasable audio file behind a track.
export function masterKey(id) {
  return `tracks/${id}`;
}

// Stripe metadata is a flat string map, so the basket is encoded as
// "ride_the_wave:1,be_great:2" and decoded again when a download is requested.
export function encodeBasket(items) {
  return items.map((item) => `${item.id}:${item.quantity}`).join(',');
}

export function decodeBasket(value) {
  if (typeof value !== 'string' || !value) return [];

  const basket = [];
  for (const entry of value.split(',')) {
    const [id, rawQuantity] = entry.split(':');
    const item = getItem(id);
    if (!item) continue;
    const quantity = Number.parseInt(rawQuantity, 10);
    basket.push({ ...item, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1 });
  }
  return basket;
}
