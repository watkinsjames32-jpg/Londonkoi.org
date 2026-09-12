// Single source of truth for what can be bought and what can be downloaded.
// Prices here are what Stripe charges, so they must match the prices on the page.

export type DownloadableTrack = {
  id: string
  title: string
  priceCents: number
  masterKey: string
  downloadName: string
  aliases: string[]
}

export type MerchItem = {
  id: string
  title: string
  priceCents: number
  aliases: string[]
}

export const MASTERS_STORE = 'music-masters'
export const DOWNLOAD_WINDOW_DAYS = 30
export const MAX_DOWNLOADS_PER_TRACK = 10

export const TRACKS: Record<string, DownloadableTrack> = {
  ride_the_wave: {
    id: 'ride_the_wave',
    title: 'Ride The Wave',
    priceCents: 99,
    masterKey: 'ride_the_wave.mp3',
    downloadName: 'London Koi - Ride The Wave.mp3',
    aliases: ['ride the wave']
  },
  facetime_remix: {
    id: 'facetime_remix',
    title: 'Facetime Remix',
    priceCents: 99,
    masterKey: 'facetime_remix.mp3',
    downloadName: 'London Koi - Facetime Remix.mp3',
    aliases: ['facetime remix', 'facetime', 'face time', 'face time remix']
  },
  be_great: {
    id: 'be_great',
    title: 'Be Great',
    priceCents: 99,
    masterKey: 'be_great.mp3',
    downloadName: 'London Koi - Be Great.mp3',
    aliases: ['be great']
  }
}

export const MERCH: Record<string, MerchItem> = {
  koi_ware_tee: {
    id: 'koi_ware_tee',
    title: 'Koi Ware Tee Shirt',
    priceCents: 3500,
    aliases: ['koi ware tee shirt', 'koi ware tee', 'official tee shirt', 'tee shirt']
  }
}

export function getTrack(id: string): DownloadableTrack | undefined {
  return Object.prototype.hasOwnProperty.call(TRACKS, id) ? TRACKS[id] : undefined
}

export function getPurchasable(id: string): DownloadableTrack | MerchItem | undefined {
  return getTrack(id) ?? (Object.prototype.hasOwnProperty.call(MERCH, id) ? MERCH[id] : undefined)
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Purchases made through a standalone Stripe Payment Link arrive with no track
// id attached, so fall back to matching the line item description by name.
export function matchTrackByName(name: string): DownloadableTrack | undefined {
  const needle = normalize(name)
  if (!needle) return undefined
  for (const track of Object.values(TRACKS)) {
    if (normalize(track.title) === needle) return track
    if (track.aliases.some((alias) => normalize(alias) === needle)) return track
  }
  return undefined
}
