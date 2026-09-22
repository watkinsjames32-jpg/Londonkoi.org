const PRODUCTS = Object.freeze({
  ride_the_wave: { name: "Ride The Wave", unitAmount: 99, type: "music" },
  facetime_remix: { name: "FaceTime Remix", unitAmount: 99, type: "music" },
  be_great: { name: "Be Great", unitAmount: 99, type: "music" },
  koi_ware_tee: { name: "Koi Ware Tee Shirt", unitAmount: 3500, type: "merch" }
});

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });

export default async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    console.error("Stripe checkout is missing STRIPE_SECRET_KEY.");
    return json({ error: "Checkout is temporarily unavailable." }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid checkout request." }, 400);
  }

  const product = PRODUCTS[payload?.productId];
  if (!product) {
    return json({ error: "This item is not available for purchase." }, 400);
  }

  const siteUrl = "https://londonkoi.org";
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${siteUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}#music`,
    cancel_url: `${siteUrl}/?checkout=cancelled#music`,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(product.unitAmount),
    "line_items[0][price_data][product_data][name]": product.name,
    "line_items[0][quantity]": "1",
    "metadata[product_id]": payload.productId,
    integration_identifier: "londonkoi_web_aquakoi7"
  });

  if (product.type === "merch") {
    params.set("shipping_address_collection[allowed_countries][0]", "US");
  }

  try {
    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2026-07-29.dahlia"
      },
      body: params
    });

    const stripeData = await stripeResponse.json();

    if (!stripeResponse.ok || typeof stripeData.url !== "string") {
      console.error("Stripe Checkout Session creation failed", {
        status: stripeResponse.status,
        type: stripeData?.error?.type,
        code: stripeData?.error?.code,
        requestId: stripeResponse.headers.get("request-id")
      });
      return json({ error: "Stripe could not start checkout. Please try again." }, 502);
    }

    return json({ url: stripeData.url });
  } catch (error) {
    console.error("Stripe Checkout connection failed", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    return json({ error: "Checkout could not connect to Stripe. Please try again." }, 502);
  }
};

export const config = {
  path: "/api/create-checkout",
  method: ["POST"]
};
