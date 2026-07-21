const crypto = require('crypto');

const secret = 'sk_live_fa89d8a37f691d733edb3b4f0a0f6e2edcf3526d';
const payload = JSON.stringify({
  event: 'charge.success',
  data: {
    customer: {
      email: 'kobequagraine@yahoo.com',
      customer_code: 'CUS_mock'
    },
    plan: {
      subscription_code: 'SUB_mock'
    }
  }
});

const signature = crypto.createHmac('sha512', secret).update(payload).digest('hex');

fetch('https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/paystack-webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-paystack-signature': signature
  },
  body: payload
})
.then(res => res.text().then(text => console.log('Status:', res.status, 'Response:', text)))
.catch(err => console.error(err));
