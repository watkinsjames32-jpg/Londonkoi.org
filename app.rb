require "sinatra/base"
require "stripe"

class LondonKoiCheckout < Sinatra::Base
  configure do
    Stripe.api_key = ENV.fetch("STRIPE_SECRET_KEY")
  end

  post "/create-checkout-session" do
    content_type :json

    request.body.rewind
    data = JSON.parse(request.body.read)
    items = Array(data["items"])

    halt 400, { error: "No products selected" }.to_json if items.empty?

    line_items = items.map do |item|
      {
        price: item.fetch("price_id"),
        quantity: Integer(item.fetch("quantity", 1))
      }
    end

    session = Stripe::Checkout::Session.create(
      mode: "payment",
      line_items: line_items,
      success_url: "#{ENV.fetch('SITE_URL')}/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "#{ENV.fetch('SITE_URL')}/cancel.html"
    )

    { id: session.id, url: session.url }.to_json
  rescue KeyError, ArgumentError, JSON::ParserError => e
    halt 400, { error: e.message }.to_json
  rescue Stripe::StripeError => e
    halt 502, { error: e.message }.to_json
  end
end

run LondonKoiCheckout
