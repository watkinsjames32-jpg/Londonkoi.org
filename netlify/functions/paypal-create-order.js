// PayPal Create Order Function
// This endpoint creates a PayPal order for checkout

function paypalBaseUrl() {
  const mode = Netlify.env.get("PAYPAL_MODE") || "sandbox";
  if (mode !== "sandbox" && mode !== "live") throw new Error("Invalid PAYPAL_MODE");
  return mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken() {
  const clientId = Netlify.env.get("PAYPAL_CLIENT_ID");
  const clientSecret = Netlify.env.get("PAYPAL_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials not configured");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const url = `${paypalBaseUrl()}/v1/oauth2/token`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!response.ok) {
    throw new Error(`PayPal auth failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.access_token;
}

const PRODUCTS = {
  facetime_remix: {
    name: "FaceTime Remix",
    price: "4.99",
    description: "Digital track"
  },
  ride_the_wave: {
    name: "Ride the Wave",
    price: "9.99",
    description: "Digital track"
  },
  be_great: {
    name: "Be Great",
    price: "7.99",
    description: "Digital track"
  },
  london_koi_tee: {
    name: "Koi Ware T-Shirt",
    price: "24.99",
    description: "Official London Koi merchandise"
  }
};

export default async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const { productId } = await request.json();
    const quantity = 1;

    if (!productId || !PRODUCTS[productId]) {
      return new Response(JSON.stringify({ error: "Invalid product ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const product = PRODUCTS[productId];
    const totalPrice = (parseFloat(product.price) * quantity).toFixed(2);

    const accessToken = await getPayPalAccessToken();
    const createOrderResponse = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: totalPrice,
              breakdown: {
                item_total: {
                  currency_code: "USD",
                  value: totalPrice
                }
              }
            },
            items: [
              {
                name: product.name,
                description: product.description,
                quantity: String(quantity),
                unit_amount: {
                  currency_code: "USD",
                  value: product.price
                }
              }
            ],
            custom_id: JSON.stringify({
              productId,
              downloadUrl: product.downloadUrl || null
            })
          }
        ],
        application_context: {
          return_url: "https://londonkoi.org/payment-success.html",
          cancel_url: "https://londonkoi.org/#music",
          user_action: "PAY"
        }
      })
    });

    if (!createOrderResponse.ok) {
      const error = await createOrderResponse.json();
      console.error("PayPal create order failed:", error);
      return new Response(JSON.stringify({ error: "Failed to create PayPal order" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const orderData = await createOrderResponse.json();
    const approvalLink = orderData.links?.find((link) => link.rel === "approve");

    if (!approvalLink?.href || !orderData.id) throw new Error("PayPal approval link missing");

    return new Response(JSON.stringify({
      success: true,
      orderId: orderData.id,
      approvalUrl: approvalLink?.href
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("PayPal create order error:", error);
    return new Response(JSON.stringify({ error: error.message === "PayPal credentials not configured" ? "PayPal credentials not configured" : "PayPal checkout unavailable" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = { path: "/api/paypal-create-order", method: ["POST"] };
