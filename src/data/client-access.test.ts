import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}))

import { inviteClientToProject } from './client-access'

beforeEach(() => vi.clearAllMocks())

describe('client invitations', () => {
  it('invokes the protected function with a normalized email and project', async () => {
    mocks.invoke.mockResolvedValue({ data: { invited: true }, error: null })

    await expect(inviteClientToProject('project-1', ' Client@Example.com ')).resolves.toEqual({ invited: true })
    expect(mocks.invoke).toHaveBeenCalledWith('invite-client', {
      body: { projectId: 'project-1', email: 'client@example.com' },
    })
  })

  it('surfaces invitation failures', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'Function unavailable' } })

    await expect(inviteClientToProject('project-1', 'client@example.com')).rejects.toThrow('Function unavailable')
  })

  it('shows the detailed server error returned by the invitation function', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        context: new Response(JSON.stringify({ error: 'Email provider is not configured.' }), { status: 500 }),
      }),
    })

    await expect(inviteClientToProject('project-1', 'client@example.com')).rejects.toThrow('Email provider is not configured.')
  })
})