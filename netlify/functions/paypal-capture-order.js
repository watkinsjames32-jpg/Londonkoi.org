// PayPal Capture Order Function
// This endpoint captures (completes) a PayPal order after user approval

async function getPayPalAccessToken() {
  const clientId = Netlify.env.get("PAYPAL_CLIENT_ID");
  const clientSecret = Netlify.env.get("PAYPAL_CLIENT_SECRET");
  const mode = Netlify.env.get("PAYPAL_MODE") || "sandbox";
  
  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials not configured");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const url = `https://api-${mode}.sandbox.paypal.com/v1/oauth2/token`;

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

    if (!orderId) {
      return new Response(JSON.stringify({ error: "Order ID required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Get PayPal access token
    const accessToken = await getPayPalAccessToken();
    const mode = Netlify.env.get("PAYPAL_MODE") || "sandbox";

    // Capture the order
    const captureResponse = await fetch(
      `https://api-${mode}.sandbox.paypal.com/v1/checkout/orders/${orderId}/capture`,
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
    if (captureData.status !== "COMPLETED") {
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = { path: "/api/paypal-capture-order", method: ["POST"] };
