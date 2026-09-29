// PayPal Capture Order Function
// This endpoint captures (completes) a PayPal order after user approval

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
      "Authorization": `Basic ${auth}`,
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

export default async (request) => {
  // Only allow POST requests
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const { orderId } = await request.json();

    if (typeof orderId !== "string" || !/^[A-Z0-9-]{10,40}$/i.test(orderId)) {
      return new Response(JSON.stringify({ error: "Order ID required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Get PayPal access token
    const accessToken = await getPayPalAccessToken();
    // Capture the order
    const captureResponse = await fetch(
      `${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (!captureResponse.ok) {
      const error = await captureResponse.json();
      console.error("PayPal capture failed:", error);
      return new Response(JSON.stringify({ error: "Payment capture failed" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const captureData = await captureResponse.json();

    // Verify payment was successful
    if (captureData.status !== "COMPLETED" || captureData.purchase_units?.[0]?.payments?.captures?.[0]?.status !== "COMPLETED") {
      return new Response(JSON.stringify({ error: "Payment not completed" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Extract download info from custom_id
    let downloadUrl = null;
    if (captureData.purchase_units?.[0]?.custom_id) {
      try {
        const customData = JSON.parse(captureData.purchase_units[0].custom_id);
        downloadUrl = customData.downloadUrl;
      } catch (e) {
        console.error("Failed to parse custom_id:", e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        orderId,
        status: captureData.status,
        amount: captureData.purchase_units?.[0]?.amount?.value,
        payer: captureData.payer?.email_address,
        downloadUrl
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (error) {
    console.error("PayPal capture order error:", error);
    return new Response(JSON.stringify({ error: error.message === "PayPal credentials not configured" ? "PayPal credentials not configured" : "Payment verification unavailable" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = { path: "/api/paypal-capture-order", method: ["POST"] };
