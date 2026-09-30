import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SAGACT_ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

type SupabaseGlobal = typeof globalThis & { __sagactSupabaseClient?: SupabaseClient }
const sharedScope = globalThis as SupabaseGlobal

export const supabase = isSupabaseConfigured
  ? (sharedScope.__sagactSupabaseClient ??= createClient(supabaseUrl, supabaseAnonKey))
  : null