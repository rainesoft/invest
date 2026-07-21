import { NextResponse } from 'next/dist/server/web/spec-extension/response';
import { supabaseServer } from '@lib/supabase-server';

export async function GET(request: Request) {
  try {
    const supabase = supabaseServer();
    
    // Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: userData } = await supabase.from('users').select('is_admin').eq('id', user.id).single();
    if (!userData?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'auto_trading_enabled')
      .single();

    const isEnabled = data ? (data.value === true || data.value === 'true') : true;

    return NextResponse.json({ auto_trading_enabled: isEnabled });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = supabaseServer();
    
    // Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: userData } = await supabase.from('users').select('is_admin').eq('id', user.id).single();
    if (!userData?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const isEnabled = Boolean(body.auto_trading_enabled);

    const { error } = await supabase
      .from('system_settings')
      .upsert({ key: 'auto_trading_enabled', value: isEnabled }, { onConflict: 'key' });

    if (error) throw error;

    return NextResponse.json({ success: true, auto_trading_enabled: isEnabled });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
