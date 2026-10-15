-- Defence in depth for the public API.
-- RLS already blocks anonymous access row by row, but the default Supabase grants
-- still give the anon role table privileges (including TRUNCATE, which RLS does not
-- cover) and EXECUTE on every function. Every app call requires a signed-in user,
-- so anonymous visitors get no direct access at all.

-- Tables and sequences: nothing for anonymous visitors.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Signed-in users keep normal data access (still filtered by RLS),
-- but cannot truncate tables or create triggers/foreign keys against them.
revoke truncate, trigger, references on all tables in schema public from authenticated;

-- Functions: only signed-in users may call them; each function still checks the
-- caller's organization role internally.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- Apply the same rules to tables, sequences and functions created later.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;
