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

From a project detail page, choose **Invite client** and enter the client's email. New addresses receive a Supabase Auth invitation; when they follow it, they create a password and are given access only to the project that sent the invitation. Existing accounts receive a sign-in link and are granted access to that project only. The same email can be granted access to multiple projects independently: revoking access removes it only from the selected project, and the existing account can still be invited to another project. Pending accounts have a **Resend** action; active accounts can receive a **Send sign-in link** email. Links carry the designated project, which opens first in the client portal after sign-in. Clients can sign in with their password from the client sign-in screen and see project status, billing, payment receipts, and shared documents. Documents uploaded by workspace staff are shared with the client automatically; the client portal is read-only and provides view and download actions. Project-level row-level security enforces the same restriction for direct data requests. Existing client accounts retain access to every project that was linked to them before the project-level migration; new invitations grant access only to their selected project.

Retention becomes receivable one calendar month after a project is marked **Completed**. The completion date is stored by the `update_project_state` RPC; apply the matching Supabase migration before using this behavior.

The client portal includes the contractual down payment in the remaining balance before progress billings are issued. Its amount is provided through the client-authorized `get_client_project_down_payment` RPC.
The client project summary shows the contract price including approved change orders and excluding the special discount.

Deploy the owner-verified invitation function to the linked project:

```powershell
npx supabase functions deploy invite-client --project-ref your-project-ref
npx supabase config push --project-ref your-project-ref
```

The function requires Supabase's `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` runtime secrets. Supabase supplies these project secrets to Edge Functions; never expose the service-role key to the browser. Email links use the origin that sent the request, falling back to `CLIENT_PORTAL_URL` if there is no origin. Configure the app's deployed URL under **Authentication → URL Configuration → Redirect URLs** before inviting clients. The localhost entries in `config.toml` are only for local development; clients cannot use a localhost link from their own devices.