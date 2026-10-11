import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const organizationId = '10000000-0000-4000-8000-000000000001'
const staffTitles = ['liaison_officer', 'engineer', 'architect']
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

async function findAuthUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const account = data.users.find((candidate) => candidate.email?.toLowerCase() === email)
    if (account || data.users.length < 1000) return account ?? null
  }
}

async function findAuthUserById(admin: ReturnType<typeof createClient>, userId: string) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const account = data.users.find((candidate) => candidate.id === userId)
    if (account || data.users.length < 1000) return account ?? null
  }
}

function redirectTo(request: Request, setupPassword = false) {
  const origin = request.headers.get('origin') ?? Deno.env.get('CLIENT_PORTAL_URL')
  if (!origin || origin === 'null') return undefined
  const redirect = new URL(origin)
  if (setupPassword) redirect.searchParams.set('staffPasswordSetup', '1')
  return redirect.toString()
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405)

  const authorization = request.headers.get('Authorization')
  const [, accessToken] = authorization?.match(/^Bearer\s+(.+)$/i) ?? []
  if (!accessToken) return respond({ error: 'Sign in before managing staff accounts.' }, 401)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('The staff-management service is not configured.')
    }

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await caller.auth.getUser(accessToken)
    if (userError || !user) return respond({ error: 'Your session is invalid. Sign in again.' }, 401)

    const body = await request.json() as {
      action?: unknown
      email?: unknown
      name?: unknown
      title?: unknown
      userId?: unknown
    }
    const action = typeof body.action === 'string' ? body.action : 'invite'
    if (!['invite', 'list', 'resend', 'revoke'].includes(action)) {
      return respond({ error: 'Choose a valid staff-management action.' }, 400)
    }

    const { data: membership, error: membershipError } = await caller.from('organization_memberships')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (membershipError) throw membershipError
    if (membership?.role !== 'owner') {
      return respond({ error: 'Only a workspace owner can manage staff accounts.' }, 403)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    if (action === 'revoke') {
      const userId = typeof body.userId === 'string' ? body.userId : ''
      if (!userId) return respond({ error: 'Choose a staff account.' }, 400)
      const { data: revokedMember, error: revokeError } = await admin.from('organization_memberships')
        .delete()
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .eq('role', 'site_staff')
        .not('staff_title', 'is', null)
        .select('user_id')
        .maybeSingle()
      if (revokeError) throw revokeError
      if (!revokedMember) return respond({ error: 'This account is not an assigned staff member.' }, 404)
      return respond({ revoked: true })
    }

    if (action === 'list') {
      const { data: members, error: listError } = await admin.from('organization_memberships')
        .select('user_id, staff_email, staff_name, staff_title')
        .eq('organization_id', organizationId)
        .eq('role', 'site_staff')
        .not('staff_title', 'is', null)
        .order('staff_name', { ascending: true })
      if (listError) throw listError
      const pendingIds = new Set((members ?? []).map((member) => member.user_id))
      const accounts = new Map<string, { email: string | null; email_confirmed_at: string | null }>()
      for (let page = 1; pendingIds.size; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) throw error
        for (const account of data.users) {
          if (pendingIds.delete(account.id)) {
            accounts.set(account.id, {
              email: account.email ?? null,
              email_confirmed_at: account.email_confirmed_at ?? null,
            })
          }
        }
        if (!pendingIds.size || data.users.length < 1000) break
      }
      return respond({ members: (members ?? []).map((member) => {
        const account = accounts.get(member.user_id)
        return {
          userId: member.user_id,
          email: member.staff_email ?? account?.email ?? '',
          name: member.staff_name ?? 'Staff member',
          title: member.staff_title,
          status: account?.email_confirmed_at ? 'accepted' : 'pending',
        }
      }) })
    }

    if (action === 'resend') {
      const userId = typeof body.userId === 'string' ? body.userId : ''
      if (!userId) return respond({ error: 'Choose a staff account.' }, 400)
      const { data: staffMember, error: staffError } = await admin.from('organization_memberships')
        .select('user_id, staff_email')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .eq('role', 'site_staff')
        .not('staff_title', 'is', null)
        .maybeSingle()
      if (staffError) throw staffError
      if (!staffMember) return respond({ error: 'This account is not an assigned staff member.' }, 404)
      const account = await findAuthUserById(admin, userId)
      if (!account?.email) return respond({ error: 'The staff account email could not be found.' }, 404)
      const redirect = redirectTo(request, !account.email_confirmed_at)

      if (account.email_confirmed_at) {
        const { error: linkError } = await caller.auth.signInWithOtp({
          email: account.email,
          options: { shouldCreateUser: false, ...(redirect ? { emailRedirectTo: redirect } : {}) },
        })
        if (linkError) throw linkError
        return respond({ resent: true, type: 'sign_in' })
      }

      const { error: resendError } = await caller.auth.resend({
        type: 'signup',
        email: account.email,
        ...(redirect ? { options: { emailRedirectTo: redirect } } : {}),
      })
      if (resendError) throw resendError
      return respond({ resent: true, type: 'invitation' })
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const title = typeof body.title === 'string' ? body.title : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond({ error: 'Enter a valid staff email.' }, 400)
    if (name.length < 2 || name.length > 120) return respond({ error: 'Name must contain between 2 and 120 characters.' }, 400)
    if (!staffTitles.includes(title)) return respond({ error: 'Choose a valid staff role.' }, 400)

    let staffUser = await findAuthUserByEmail(admin, email)
    const { data: assignedTitle, error: titleError } = await admin.from('organization_memberships')
      .select('staff_email')
      .eq('organization_id', organizationId)
      .eq('role', 'site_staff')
      .eq('staff_title', title)
      .maybeSingle()
    if (titleError) throw titleError
    if (assignedTitle && assignedTitle.staff_email?.toLowerCase() !== email) {
      return respond({ error: 'That staff role is already assigned. Each role has one team member.' }, 409)
    }

    if (staffUser) {
      const { data: existingMembership, error: existingError } = await admin.from('organization_memberships')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', staffUser.id)
        .maybeSingle()
      if (existingError) throw existingError
      if (existingMembership?.role === 'owner') {
        return respond({ error: 'This email already belongs to the workspace owner.' }, 409)
      }
      if (existingMembership && existingMembership.role !== 'site_staff') {
        return respond({ error: 'This account already has a different workspace role.' }, 409)
      }
      const { data: clientAccess, error: clientAccessError } = await admin.from('client_user_access')
        .select('user_id')
        .eq('organization_id', organizationId)
        .eq('user_id', staffUser.id)
        .limit(1)
      if (clientAccessError) throw clientAccessError
      if (clientAccess?.length) {
        return respond({ error: 'A client account cannot also be invited as workspace staff.' }, 409)
      }
    }

    let emailSent = false
    let emailError: string | undefined
    if (!staffUser) {
      const redirect = redirectTo(request, true)
      const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        ...(redirect ? { redirectTo: redirect } : {}),
        data: { full_name: name, staff_title: title },
      })
      if (inviteError) {
        staffUser = await findAuthUserByEmail(admin, email)
        if (!staffUser) throw inviteError
        emailError = inviteError.message
      } else {
        staffUser = invitation.user
        emailSent = true
      }
    } else if (staffUser.email_confirmed_at) {
      const redirect = redirectTo(request)
      const { error: linkError } = await caller.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, ...(redirect ? { emailRedirectTo: redirect } : {}) },
      })
      if (linkError) emailError = linkError.message
      else emailSent = true
    } else {
      const redirect = redirectTo(request, true)
      const { error: resendError } = await caller.auth.resend({
        type: 'signup',
        email,
        ...(redirect ? { options: { emailRedirectTo: redirect } } : {}),
      })
      if (resendError) emailError = resendError.message
      else emailSent = true
    }

    if (!staffUser) throw new Error('The invited staff account could not be located.')
    const { error: updateUserError } = await admin.auth.admin.updateUserById(staffUser.id, {
      user_metadata: { ...staffUser.user_metadata, full_name: name, staff_title: title },
    })
    if (updateUserError) throw updateUserError

    const { error: upsertError } = await admin.from('organization_memberships').upsert({
      organization_id: organizationId,
      user_id: staffUser.id,
      role: 'site_staff',
      staff_email: email,
      staff_name: name,
      staff_title: title,
      invited_by: user.id,
    }, { onConflict: 'organization_id,user_id' })
    if (upsertError) throw upsertError

    return respond({ invited: true, emailSent, ...(emailError ? { emailError } : {}) })
  } catch (error) {
    console.error('manage-staff failed:', error)
    return respond({ error: error instanceof Error ? error.message : 'Could not manage this staff account.' }, 500)
  }
})
