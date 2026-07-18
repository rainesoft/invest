import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// We use the anon key so that RLS and the RPC's internal auth.uid() checks work properly
const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY);

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Set the session for the supabase client to act as the requesting user
    const { error: authError } = await supabase.auth.getUser(token);
    
    if (authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // We must pass the token to the RPC call
    const authClient = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const { requestId } = await req.json();
    
    if (!requestId) {
      return NextResponse.json({ error: 'Missing request ID' }, { status: 400 });
    }

    const { error: rpcError } = await authClient.rpc('admin_approve_deposit', {
      p_request_id: requestId
    });

    if (rpcError) {
      console.error('Failed to approve deposit:', rpcError);
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
    
  } catch (error: any) {
    console.error('Admin Deposit Approve Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
