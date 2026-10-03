export function hasPendingInvitePasswordSetup(location: Pick<Location, 'hash' | 'search'> = window.location) {
  const hashType = new URLSearchParams(location.hash.replace(/^#/, '')).get('type')
  const searchParams = new URLSearchParams(location.search)
  const queryType = searchParams.get('type')
  return searchParams.get('clientPasswordSetup') === '1'
    || hashType === 'invite'
    || hashType === 'signup'
    || queryType === 'invite'
    || queryType === 'signup'
}

export function clearPasswordSetupCallback(location: Pick<Location, 'pathname' | 'search'> = window.location) {
  const searchParams = new URLSearchParams(location.search)
  searchParams.delete('clientPasswordSetup')
  if (searchParams.get('type') === 'invite' || searchParams.get('type') === 'signup') searchParams.delete('type')
  const query = searchParams.toString()
  return `${location.pathname}${query ? `?${query}` : ''}`
}
