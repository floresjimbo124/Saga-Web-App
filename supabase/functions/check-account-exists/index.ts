import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const allowedOrigins = new Set([
  'https://saga-web-app.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function respond(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  })
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin')
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) })
  }
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405, origin)
  if (origin && !allowedOrigins.has(origin)) return respond({ error: 'Origin is not allowed.' }, 403, origin)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Account lookup is not configured.')

    const contentLength = Number(request.headers.get('Content-Length') ?? 0)
    if (contentLength > 4096) return respond({ error: 'Request is too large.' }, 413, origin)

    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || !('email' in body) || typeof body.email !== 'string') {
      return respond({ error: 'A valid email address is required.' }, 400, origin)
    }

    const email = body.email.trim().toLowerCase()
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return respond({ error: 'A valid email address is required.' }, 400, origin)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    for (let page = 1; ; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw error

      if (data.users.some((user) => user.email?.toLowerCase() === email)) {
        return respond({ exists: true }, 200, origin)
      }
      if (data.users.length < 1000) return respond({ exists: false }, 200, origin)
    }
  } catch (error) {
    console.error('check-account-exists failed:', error)
    return respond({ error: 'Could not verify account status.' }, 500, origin)
  }
})
