import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: CookieOptions) {
            cookieStore.set({ name, value: '', ...options });
          },
        },
      }
    );

    // 1. Authenticate user
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse request body
    const body = await req.json();
    const { couponCode } = body;

    // 3. Validate coupon code
    if (!couponCode || typeof couponCode !== 'string' || couponCode.toUpperCase().trim() !== 'MYTRADEBUDDY') {
      return NextResponse.json({ error: 'Invalid coupon code' }, { status: 400 });
    }

    // 4. Admin Client to bypass RLS for subscription UPSERT
    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 5. Calculate +90 days
    const nextBillingDate = new Date();
    nextBillingDate.setDate(nextBillingDate.getDate() + 90);

    const { error: upsertError } = await supabaseAdmin
      .from('user_subscriptions')
      .upsert({
        user_id: user.id,
        status: 'active',
        plan_tier: 'pro',
        billing_amount_usd: 100, // Standard fee, billed AFTER the 90 days
        next_billing_date: nextBillingDate.toISOString(),
        cancel_at_period_end: false,
      });

    if (upsertError) {
      console.error("Coupon upsert error:", upsertError);
      return NextResponse.json({ error: 'Failed to activate subscription' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: '3 months free applied!' }, { status: 200 });

  } catch (error: any) {
    console.error("Coupon route exception:", error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
