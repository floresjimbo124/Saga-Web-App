import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return respond({ error: 'Sign in before inviting a client.' }, 401)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('The invitation service is not configured.')
    }

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await caller.auth.getUser()
    if (userError || !user) return respond({ error: 'Your session is invalid. Sign in again.' }, 401)

    const body = await request.json() as { projectId?: unknown; email?: unknown }
    const projectId = typeof body.projectId === 'string' ? body.projectId : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!projectId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return respond({ error: 'Enter a valid project and client email.' }, 400)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: project, error: projectError } = await admin.from('projects')
      .select('id, organization_id, client_id')
      .eq('id', projectId)
      .maybeSingle()
    if (projectError) throw projectError
    if (!project?.client_id) return respond({ error: 'Set up a client on this project before inviting them.' }, 400)

    const { data: membership, error: membershipError } = await caller.from('organization_memberships')
      .select('role')
      .eq('organization_id', project.organization_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (membershipError) throw membershipError
    if (membership?.role !== 'owner') return respond({ error: 'Only a workspace owner can invite client users.' }, 403)

    const redirectTo = Deno.env.get('CLIENT_PORTAL_URL')
    const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined)
    let clientUser = invitation.user
    let invited = !inviteError

    if (inviteError) {
      if (!inviteError.message.toLowerCase().includes('already registered')) throw inviteError
      invited = false
      clientUser = null
      for (let page = 1; !clientUser; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) throw error
        clientUser = data.users.find((candidate) => candidate.email?.toLowerCase() === email) ?? null
        if (clientUser || data.users.length < 1000) break
      }
      if (!clientUser) throw new Error('An account already exists for this email, but it could not be located.')
    }

    const { error: accessError } = await admin.from('client_user_access').upsert({
      organization_id: project.organization_id,
      client_id: project.client_id,
      user_id: clientUser.id,
      invited_by: user.id,
    }, { onConflict: 'client_id,user_id' })
    if (accessError) throw accessError

    return respond({ invited })
  } catch (error) {
    console.error('invite-client failed:', error)
    return respond({ error: error instanceof Error ? error.message : 'Could not invite this client.' }, 500)
  }
})