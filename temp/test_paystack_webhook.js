const crypto = require('crypto');

const secret = process.env.PAYSTACK_SECRET_KEY || "sk_test_dummy_key_12345";
const payload = JSON.stringify({
  event: "charge.success",
  data: {
    customer: { email: "test@example.com", customer_code: "CUS_1234" },
    plan: { subscription_code: "SUB_5678" }
  }
});

const hash = crypto.createHmac('sha512', secret).update(payload).digest('hex');

fetch("http://localhost:54321/functions/v1/paystack-webhook", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-paystack-signature": hash
  },
  body: payload
})
.then(res => res.text())
.then(console.log);
