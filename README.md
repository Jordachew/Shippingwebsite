# Sueños Shipping & Variety Store

This version uses the original dark theme UI and includes:
- Public marketing site + customer portal
- Public tracking page
- Staff/admin dashboard with quick stats + package/customer tools

## Pages
- / (index.html): marketing + customer portal
- /admin.html: staff dashboard (staff only)
- /track.html: public tracking page

## Setup
1) Create Supabase project
2) Run SQL in Supabase SQL editor
3) Create Storage buckets: invoices, chat_files
4) Add env vars in Vercel:
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY
   - (optional) RESEND_API_KEY
5) Paste SUPABASE_URL + anon key into script.js and admin.js
6) Deploy to Vercel

## Required DB fields (quick fix)
If profile rows aren't inserting, make sure the profiles table has these columns:

```sql
alter table public.profiles
  add column if not exists full_name text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists is_active boolean default true,
  add column if not exists role text default 'customer';
```

## Optional enhancements for your requested features
### Messages (support)
To support "resolved" messages in the staff dashboard:
```sql
alter table public.messages
  add column if not exists resolved boolean default false;
```

### Packages
For store analytics and attachments:
```sql
alter table public.packages
  add column if not exists store text,
  add column if not exists photo_paths jsonb;
```

### Reports export
Exports are done client-side as CSV from the admin dashboard.

## Staff access
After you register, set profiles.role = 'staff' for your account in Supabase table editor.


## Welcome email (Resend)

This project can send a welcome email (account number + shipping address) after a customer signs up.

### 1) Create a Resend account + verify sender
- Create an API key in Resend.
- Verify a domain or sender address in Resend so you can send from your chosen "from" address.

### 2) Add Vercel environment variables
In Vercel → Project → Settings → Environment Variables, add:

- `SUPABASE_URL` = your Supabase project URL  
- `SUPABASE_SERVICE_ROLE_KEY` = Supabase *Service Role* key (server-only)
- `RESEND_API_KEY` = your Resend API key

### 3) Deploy
The endpoint lives at:
- `/api/welcome-email` (POST)

The customer portal calls this endpoint automatically after a successful signup *when a session exists* (email confirmation OFF).  
If email confirmation is ON, the welcome email is sent after the first successful login.

## Account number generator (SNS-JM + 4 chars)

If you are using a Postgres function that calls `gen_random_bytes(...)`, enable pgcrypto:

```sql
create extension if not exists pgcrypto;
```

Then your generator function can use `gen_random_bytes(...)`.

## Invoices approval (Admin)

The Admin dashboard supports approving invoices if your `invoices` table has an `approved boolean` column.

Add it in Supabase SQL Editor if needed:

```sql
alter table public.invoices add column if not exists approved boolean not null default false;
```

