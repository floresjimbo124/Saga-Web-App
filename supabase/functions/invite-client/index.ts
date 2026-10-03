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

async function findAuthUsers(admin: ReturnType<typeof createClient>, userIds: string[]) {
  const remaining = new Set(userIds)
  const users = new Map<string, Awaited<ReturnType<typeof admin.auth.admin.getUserById>>['data']['user']>()
  if (!remaining.size) return users
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    for (const user of data.users) {
      if (remaining.delete(user.id)) users.set(user.id, user)
    }
    if (!remaining.size || data.users.length < 1000) return users
  }
}

async function findAuthUser(admin: ReturnType<typeof createClient>, userId: string) {
  return (await findAuthUsers(admin, [userId])).get(userId) ?? null
}

async function findAuthUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const account = data.users.find((candidate) => candidate.email?.toLowerCase() === email)
    if (account || data.users.length < 1000) return account ?? null
  }
}

function clientPortalRedirect(request: Request, projectId: string, setupPassword = false) {
  const baseUrl = request.headers.get('origin') ?? Deno.env.get('CLIENT_PORTAL_URL')
  if (!baseUrl) return undefined
  const redirect = new URL(baseUrl)
  redirect.searchParams.set('projectId', projectId)
  if (setupPassword) redirect.searchParams.set('clientPasswordSetup', '1')
  return redirect.toString()
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

    const body = await request.json() as { action?: unknown; projectId?: unknown; email?: unknown; userId?: unknown }
    const action = typeof body.action === 'string' ? body.action : 'invite'
    const projectId = typeof body.projectId === 'string' ? body.projectId : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const userId = typeof body.userId === 'string' ? body.userId : ''
    if (!projectId || !['invite', 'list', 'revoke', 'resend'].includes(action)) {
      return respond({ error: 'Choose a valid client-access action and project.' }, 400)
    }
    if (action === 'invite' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return respond({ error: 'Enter a valid client email.' }, 400)
    }
    if ((action === 'revoke' || action === 'resend') && !userId) {
      return respond({ error: 'Choose a client account.' }, 400)
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

    const redirectTo = clientPortalRedirect(request, projectId, action === 'invite')

    if (action === 'list') {
      const { data: accessRows, error: accessError } = await admin.from('client_user_access')
        .select('user_id, created_at')
        .eq('organization_id', project.organization_id)
        .eq('project_id', project.id)
        .order('created_at', { ascending: true })
      if (accessError) throw accessError

      const users = await findAuthUsers(admin, (accessRows ?? []).map((row) => row.user_id))
      return respond({ accounts: (accessRows ?? []).map((row) => {
        const account = users.get(row.user_id)
        return {
          userId: row.user_id,
          email: account?.email ?? 'Email unavailable',
          status: account?.email_confirmed_at ? 'accepted' : 'pending',
          invitedAt: account?.invited_at ?? row.created_at,
        }
      }) })
    }

    if (action === 'revoke') {
      const { error: revokeError } = await admin.from('client_user_access')
        .delete()
        .eq('organization_id', project.organization_id)
        .eq('project_id', project.id)
        .eq('user_id', userId)
      if (revokeError) throw revokeError
      return respond({ revoked: true })
    }

    if (action === 'resend') {
      const { data: accessRow, error: accessError } = await admin.from('client_user_access')
        .select('user_id')
        .eq('organization_id', project.organization_id)
        .eq('project_id', project.id)
        .eq('user_id', userId)
        .maybeSingle()
      if (accessError) throw accessError
      if (!accessRow) return respond({ error: 'This account no longer has access to this project.' }, 404)

      const account = await findAuthUser(admin, userId)
      if (!account?.email) return respond({ error: 'The client account email could not be found.' }, 404)

      if (account.email_confirmed_at) {
        const { error: linkError } = await caller.auth.signInWithOtp({
          email: account.email,
          options: {
            shouldCreateUser: false,
            ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
          },
        })
        if (linkError) throw linkError
        return respond({ resent: true, type: 'sign_in' })
      }

      const { error: resendError } = await caller.auth.resend({
        type: 'signup',
        email: account.email,
        ...(redirectTo ? { options: { emailRedirectTo: redirectTo } } : {}),
      })
      if (resendError) throw resendError
      return respond({ resent: true, type: 'invitation' })
    }

    let clientUser = await findAuthUserByEmail(admin, email)
    let invited = false
    let emailSent = false
    let emailError: string | undefined

    if (!clientUser) {
      const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined)
      if (inviteError) {
        clientUser = await findAuthUserByEmail(admin, email)
        if (!clientUser) throw inviteError
      } else {
        clientUser = invitation.user
        invited = true
        emailSent = true
      }
    } else if (clientUser.email) {
      if (clientUser.email_confirmed_at) {
        const { error: linkError } = await caller.auth.signInWithOtp({
          email: clientUser.email,
          options: {
            shouldCreateUser: false,
            ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
          },
        })
        if (linkError) emailError = linkError.message
        else emailSent = true
      } else {
        const { error: resendError } = await caller.auth.resend({
          type: 'signup',
          email: clientUser.email,
          ...(redirectTo ? { options: { emailRedirectTo: redirectTo } } : {}),
        })
        if (resendError) emailError = resendError.message
        else emailSent = true
      }
    }

    if (!clientUser) throw new Error('The invited account could not be located.')

    const { error: accessError } = await admin.from('client_user_access').upsert({
      organization_id: project.organization_id,
      project_id: project.id,
      user_id: clientUser.id,
      invited_by: user.id,
    }, { onConflict: 'project_id,user_id' })
    if (accessError) throw accessError

    return respond({ invited, emailSent, ...(emailError ? { emailError } : {}) })
  } catch (error) {
    console.error('invite-client failed:', error)
    return respond({ error: error instanceof Error ? error.message : 'Could not invite this client.' }, 500)
  }
})