import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        name: 'sb-ai-trading-auth'
      },
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          });
          supabaseResponse = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          supabaseResponse.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          });
          supabaseResponse = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          supabaseResponse.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    }
  );

  const { data, error } = await supabase.auth.getUser();
  console.log('[Middleware] Auth Check:', { user: data?.user?.id, error: error?.message });

  // If there's an invalid JWT (like a deleted user), forcefully clear the cookie
  if (error && error.message.includes('User from sub claim in JWT does not exist')) {
    console.log('[Middleware] Found invalid JWT, clearing these cookies:', request.cookies.getAll().map(c => c.name));
    request.cookies.getAll().forEach(cookie => {
      if (cookie.name.startsWith('sb-')) {
        // Nuke all supabase cookies
        request.cookies.delete(cookie.name);
        supabaseResponse.cookies.set(cookie.name, '', { maxAge: 0, path: '/' });
      }
    });
    // Also try signing out to clear any client state
    await supabase.auth.signOut();
  }

  const isProtectedRoute = request.nextUrl.pathname.startsWith('/dashboard');
  console.log('[Middleware] Path:', request.nextUrl.pathname, 'Protected:', isProtectedRoute);

  if (isProtectedRoute && !data.user) {
    console.log('[Middleware] Redirecting to /login because no user was found.');
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
