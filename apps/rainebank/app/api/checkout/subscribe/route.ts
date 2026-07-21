import { NextResponse } from 'next/server';
import { supabaseServer } from '@lib/supabase-server';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const ALPHA_PLAN_CODE = process.env.NEXT_PUBLIC_PAYSTACK_ALPHA_PLAN_CODE!;

export async function POST(req: Request) {
  if (!PAYSTACK_SECRET_KEY || !ALPHA_PLAN_CODE) {
    return NextResponse.json({ error: 'Server misconfiguration: missing Paystack keys' }, { status: 500 });
  }

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Check if user is already on Pro
    const { data: subscription } = await supabase
      .from('user_subscriptions')
      .select('plan_tier')
      .eq('user_id', user.id)
      .single();

    if (subscription && subscription.plan_tier === 'pro') {
      return NextResponse.json({ error: 'You are already on the Pro plan' }, { status: 400 });
    }

    // Initialize Paystack checkout session for the plan
    const callbackUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/dashboard?subscribed=true`;

    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email,
        amount: 19900, // $199.00 in cents
        plan: ALPHA_PLAN_CODE,
        callback_url: callbackUrl,
        metadata: {
          user_id: user.id,
          custom_fields: [
            {
              display_name: "Billing Amount USD",
              variable_name: "billing_amount_usd",
              value: "199"
            }
          ]
        }
      }),
    });

    const data = await paystackRes.json();

    if (!data.status) {
      console.error('Paystack Error:', data);
      return NextResponse.json({ error: data.message || 'Payment initialization failed' }, { status: 500 });
    }

    // Return the checkout URL
    return NextResponse.json({ authorization_url: data.data.authorization_url });

  } catch (error: any) {
    console.error('Checkout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
