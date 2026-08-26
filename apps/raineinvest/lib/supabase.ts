'use client';
import { createBrowserClient } from '@supabase/ssr';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const g = globalThis as any;
export const supabase =
  g.__supabase ??
  createBrowserClient(url, anon, {
    cookieOptions: {
      name: 'sb-ai-trading-auth'
    }
  });

if (process.env.NODE_ENV !== 'production') g.__supabase = supabase;