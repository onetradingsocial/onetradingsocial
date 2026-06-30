import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Signup-funnel steps — gated to logged-in, not-yet-onboarded users.
const FUNNEL_PATHS = ['/onboarding', '/select-plan']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname

  // Signup-funnel steps: only for a logged-in user who hasn't finished
  // onboarding. Logged-out -> /login; already-onboarded -> / (home).
  const isFunnel = FUNNEL_PATHS.some((p) => path.startsWith(p))
  // Protected app routes that require a finished account. The single-segment
  // catch-all (e.g. /alex) is a PUBLIC profile page, so it is NOT protected here.
  const isProtected = path === '/' || path.startsWith('/settings')

  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    return NextResponse.redirect(url)
  }

  // Unauthed on any gated page -> login. Public profiles + auth pages stay open.
  if (!user && (isProtected || isFunnel)) return redirectTo('/login')

  // Authed: a single onboarding-status read drives both gates.
  if (user && (isProtected || isFunnel)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('onboarding_completed')
      .eq('id', user.id)
      .single()
    const completed = !!profile?.onboarding_completed

    // Done with onboarding? The funnel is off-limits — send them home.
    if (isFunnel && completed) return redirectTo('/')
    // Still onboarding but on a protected app route? Resume the funnel.
    if (isProtected && !completed) return redirectTo('/onboarding')
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
