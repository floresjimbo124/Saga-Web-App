# SAGACT database

This directory contains the Supabase PostgreSQL schema, row-level security policies, and local development seed data.

The seed creates the SAGACT organization and Salo Spot / Dapitan Cafe project shells. Contract values and client details are intentionally blank; the Excel workbook is guidance, not an import source.

## Local database

Install Docker Desktop and the Supabase CLI, then run:

```powershell
npx supabase start
npx supabase db reset
```

The local dashboard is available at `http://127.0.0.1:54323`. The database uses port `54322` and the local API uses port `54321`.

Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the local CLI output or your hosted project's API settings. The app's Supabase client stays disabled until both values are present.

## First owner

The seed intentionally does not create a login or assign a real person as owner. After creating the first auth user in Supabase Studio, copy that user's UUID and run this once in the SQL editor:

```sql
insert into public.organization_memberships (organization_id, user_id, role)
values (
  '10000000-0000-4000-8000-000000000001',
  '233ec172-239d-407d-8b27-a487754b8b91'::uuid,
  'owner'
)
on conflict (organization_id, user_id) do nothing;
```

For a hosted project, apply the migration with `npx supabase db push`. The local seed is not automatically applied to hosted databases; seed or create production records deliberately after reviewing them.

## Testing

Run the app's unit tests, type/build check, and lint with:

```powershell
npm test
npm run build
npm run lint
```

`npm test` covers finance calculations and the portfolio data mapping/RPC calls. With this project linked and the Supabase CLI signed in, run the owner-only project setup smoke test with:

```powershell
npx supabase db query --linked --file supabase/tests/project_setup_smoke.sql
```

The SQL test simulates the existing owner claim, exercises the setup RPC, verifies the saved client and terms, then rolls back the transaction so no test data remains. Browser smoke test: sign in, open Salo Spot, choose **Set up contract**, check its seeded defaults, then close without saving. To test a real save, use confirmed client/contract values; the database records those values and the audit trail.

## Security notes

- Financial terms, expenses, and audit logs are owner-only under RLS.
- Client access is linked to a client record; project visibility follows that client link.
- Issued payment details are immutable. Voids remain as records and are audited.
- Receipt numbers are assigned under a transaction lock and the project prefix locks after the first receipt.
- Store private files in `project-documents` using `<organization-uuid>/<project-uuid>/<filename>` paths. Client downloads additionally require a matching `project_documents` row with `client_visible = true`.
- Never put a Supabase service-role key in the browser or commit it to this repository.

## Client portal access

From a project detail page, choose **Invite client** and enter the client's email. New addresses receive a Supabase Auth invitation; existing accounts are linked to the project's client record. Since access is client-scoped, that account can view every project associated with the same client record, subject to the existing row-level security policies.

Deploy the owner-verified invitation function to the linked project:

```powershell
npx supabase functions deploy invite-client --project-ref your-project-ref
npx supabase secrets set CLIENT_PORTAL_URL=https://your-client-portal-url --project-ref your-project-ref
```

The function requires Supabase's `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` runtime secrets. Supabase supplies these project secrets to Edge Functions; never expose the service-role key to the browser. Add the configured `CLIENT_PORTAL_URL` to the Auth redirect URL allowlist in the Supabase dashboard so invite links return to the app.