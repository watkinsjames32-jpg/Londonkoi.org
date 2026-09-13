/**
 * Server-side source of truth for everything that can be bought on londonkoi.org.
 * Prices live here (never in the browser) so a visitor cannot change what they pay.
 */

export type CatalogItem = {
  name: string
  /** Price in cents, USD. */
  unitAmount: number
  /** Present only for items that unlock a file download after payment. */
  download?: {
    /** Key of the audio file inside the Netlify Blobs store. */
    key: string
    /** Filename the buyer receives. */
    filename: string
    contentType: string
  }
}

/**
 * Netlify Blobs store holding the full-length, paid-only audio files. The files
 * are never committed to this repo and are never served as static assets, so
 * upload each one once with the Netlify CLI (keys must match `download.key`):
 *
 *   netlify blobs:set music-downloads tracks/ride-the-wave.mp3 --input ./ride-the-wave.mp3
 *
 * A track with no uploaded file still sells: the buyer sees "being uploaded"
 * on the download page instead of a broken link.
 */
export const DOWNLOAD_STORE = 'music-downloads'

/** How long after payment a buyer can keep re-downloading their purchase. */
export const DOWNLOAD_WINDOW_DAYS = 30

export const CATALOG: Record<string, CatalogItem> = {
  ride_the_wave: {
    name: 'Ride The Wave',
    unitAmount: 99,
    download: {
      key: 'tracks/ride-the-wave.mp3',
      filename: 'London Koi - Ride The Wave.mp3',
      contentType: 'audio/mpeg'
    }
  },
  facetime_remix: {
    name: 'Facetime Remix',
    unitAmount: 99,
    download: {
      key: 'tracks/facetime-remix.mp3',
      filename: 'London Koi - Facetime Remix.mp3',
      contentType: 'audio/mpeg'
    }
  },
  be_great: {
    name: 'Be Great',
    unitAmount: 99,
    download: {
      key: 'tracks/be-great.mp3',
      filename: 'London Koi - Be Great.mp3',
      contentType: 'audio/mpeg'
    }
  }
}

export const isDownloadable = (id: string) => Boolean(CATALOG[id]?.download)
