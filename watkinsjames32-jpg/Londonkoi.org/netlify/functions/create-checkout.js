const PRODUCTS = {
  ride_the_wave: { name: 'Ride The Wave', unit_amount: 99 },
  facetime_remix: { name: 'Facetime Remix', unit_amount: 99 },
  be_great: { name: 'Be Great', unit_amount: 99 },
  koi_ware_tee: { name: 'Koi Ware Tee Shirt', unit_amount: 3500 }
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not configured');
    return { statusCode: 500, body: JSON.stringify({ error: 'Checkout is not configured yet.' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const requestedItems = Array.isArray(payload.items) ? payload.items : [];
  const normalized = [];

  for (const item of requestedItems) {
    const product = PRODUCTS[item.id];
    const quantity = Math.max(1, Math.min(20, Number.parseInt(item.quantity, 10) || 1));
    if (!product) continue;
    normalized.push({ id: item.id, quantity, ...product });
  }

  if (!normalized.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Your cart is empty.' }) };
  }

  const origin = (event.headers.origin || 'https://londonkoi.org').replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${origin}/?checkout=success#music`);
  params.set('cancel_url', `${origin}/?checkout=cancelled#music`);
  params.set('billing_address_collection', 'auto');

  normalized.forEach((item, index) => {
    params.set(`line_items[${index}][price_data][currency]`, 'usd');
    params.set(`line_items[${index}][price_data][unit_amount]`, String(item.unit_amount));
    params.set(`line_items[${index}][price_data][product_data][name]`, item.name);
    params.set(`line_items[${index}][quantity]`, String(item.quantity));
  });

  try {
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const stripeData = await stripeResponse.json();

    if (!stripeResponse.ok || !stripeData.url) {
      console.error('Stripe checkout error', stripeData);
      return { statusCode: 502, body: JSON.stringify({ error: stripeData.error?.message || 'Unable to start checkout.' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: stripeData.url })
    };
  } catch (error) {
    console.error('Checkout function failed', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unable to connect to Stripe.' }) };
  }
};
