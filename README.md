# Sueños Shipping & Variety Store

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

## Staff access
After you register, set profiles.role = 'staff' for your account in Supabase table editor.
