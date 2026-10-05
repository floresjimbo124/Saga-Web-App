export function hasPendingPasswordRecovery(location: Pick<Location, 'hash' | 'search'> = window.location) {
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''))
  const searchParams = new URLSearchParams(location.search)
  return hashParams.get('type') === 'recovery'
    || searchParams.get('type') === 'recovery'
}

export function hasFailedPasswordRecovery(location: Pick<Location, 'hash' | 'search'> = window.location) {
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''))
  const searchParams = new URLSearchParams(location.search)
  return [hashParams, searchParams].some((params) =>
    params.get('error_code') === 'otp_expired'
    || params.get('error') === 'access_denied',
  )
}

export function clearPasswordRecoveryCallback(location: Pick<Location, 'pathname' | 'search'> = window.location) {
  const searchParams = new URLSearchParams(location.search)
  searchParams.delete('type')
  searchParams.delete('code')
  searchParams.delete('error')
  searchParams.delete('error_code')
  searchParams.delete('error_description')
  const query = searchParams.toString()
  return `${location.pathname}${query ? `?${query}` : ''}`
}
