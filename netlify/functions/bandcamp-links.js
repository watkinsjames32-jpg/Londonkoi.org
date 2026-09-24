const TRACKS = Object.freeze({
  ride_the_wave: "BANDCAMP_RIDE_THE_WAVE_URL",
  facetime_remix: "BANDCAMP_FACETIME_URL",
  be_great: "BANDCAMP_BE_GREAT_URL"
});

// Return only artist release links. Never redirect customers to an unverified account.
const validLink = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".bandcamp.com") ||
        url.hostname === ".bandcamp.com" || !/^\/(track|album)\/[^/]+\/?$/.test(url.pathname) ||
        url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
};

export default async (request) => {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const links = {};
  for (const [product, key] of Object.entries(TRACKS)) {
    const url = validLink(Netlify.env.get(key));
    if (url) links[product] = url;
  }
  return new Response(JSON.stringify({ links }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
};

export const config = { path: "/api/bandcamp-links", method: ["GET"] };
