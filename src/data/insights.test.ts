import { describe, expect, it } from 'vitest'
import { isStaleBundleError } from './insights'

describe('isStaleBundleError', () => {
  it('recognises missing screen files from an older deploy', () => {
    expect(isStaleBundleError('Failed to fetch dynamically imported module: https://saga-web-app.vercel.app/assets/App-old.js')).toBe(true)
    expect(isStaleBundleError('Importing a module script failed.')).toBe(true)
    expect(isStaleBundleError('error loading dynamically imported module')).toBe(true)
    expect(isStaleBundleError('Unable to preload CSS for /assets/App-old.css')).toBe(true)
  })

  it('ignores ordinary errors', () => {
    expect(isStaleBundleError('Uncaught ReferenceError: receivableLabel is not defined')).toBe(false)
    expect(isStaleBundleError('Script error.')).toBe(false)
  })
})
