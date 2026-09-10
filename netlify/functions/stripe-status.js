exports.handler = async function () {
  const key = process.env.STRIPE_SECRET_KEY || '';
  const connected = /^sk_(test|live)_/.test(key);

  return {
    statusCode: connected ? 200 : 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({
      stripeSecretKeyConfigured: connected,
      mode: key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : 'missing-or-invalid'
    })
  };
};
