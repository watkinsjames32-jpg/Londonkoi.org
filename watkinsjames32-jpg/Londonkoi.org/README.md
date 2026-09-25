# Londonkoi.org

The deployable site is this folder: `watkinsjames32-jpg/Londonkoi.org`.

Netlify is configured with this folder as its base directory, so **only files in
this folder reach londonkoi.org**. Anything added at the repository root is
ignored by the deploy. The site is configured by `netlify.toml` in the repository
root, where every path is written relative to this folder.

```
index.html          the whole site (one page)
music-admin.html    upload page for purchasable audio files
assets/             images, video and audio used by the page
netlify/functions/  checkout, purchase verification, downloads, uploads
netlify/lib/        shared catalog and Stripe helpers
```

## Adding content

- **Images, video, song previews** — add the file to `assets/` and reference it
  from `index.html` as `assets/your-file.jpg`.
- **Page copy** — edit `index.html`.

Both are published by the next deploy of the `main` branch.

## Music that can be bought

`netlify/lib/catalog.mjs` is the list of everything for sale, including prices.
Prices are only read on the server so they cannot be changed from the browser.

The audio file a buyer downloads is **not** kept in this repository — that would
make it free to anyone. It is stored in Netlify Blobs and uploaded from
`/music-admin.html` using the `SITE_ADMIN_KEY` environment variable. A song can
be on sale before its file is uploaded; buyers then see the track marked
"Preparing" and the download button appears as soon as the file is in place.

## How a purchase becomes a download

1. A Buy button posts to `/api/checkout`, which creates a Stripe Checkout
   session and records the basket in the session metadata.
2. Stripe returns the buyer to `/?checkout=success&session_id=...`.
3. The page calls `/api/purchase`, which asks Stripe whether that session was
   actually paid and replies with the songs it covers.
4. Each paid song gets a Download button pointing at `/api/download`, which
   re-checks the Stripe session on every request before streaming the audio.

Purchase references are remembered in the browser, so the download buttons are
still there on a later visit.

## Environment variables

| Variable | Used for |
| --- | --- |
| `STRIPE_SECRET_KEY` | Creating and verifying Stripe Checkout sessions |
| `SITE_ADMIN_KEY` | Authorising uploads on `/music-admin.html` |
