-- Paid music downloads: one row per completed Stripe purchase, one row per
-- purchased track. Download tokens are the buyer's key to their files.
CREATE TABLE IF NOT EXISTS music_orders (
  id SERIAL PRIMARY KEY,
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent TEXT,
  email TEXT,
  download_token TEXT NOT NULL UNIQUE,
  amount_total INTEGER,
  currency TEXT NOT NULL DEFAULT 'usd',
  source TEXT NOT NULL DEFAULT 'checkout',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS music_order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES music_orders (id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  title TEXT NOT NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  max_downloads INTEGER NOT NULL DEFAULT 10,
  last_downloaded_at TIMESTAMPTZ,
  UNIQUE (order_id, track_id)
);

CREATE INDEX IF NOT EXISTS music_orders_download_token_idx ON music_orders (download_token);
CREATE INDEX IF NOT EXISTS music_order_items_order_id_idx ON music_order_items (order_id);
