# Sueños Shipping & Variety Store

Live site: https://suenosshipping.com

## Features
- Customer self-registration & login (Supabase Auth)
- Customer dashboard: package statuses
- Invoice uploads (Supabase Storage + RLS)
- Realtime chat (customer/support)
- Staff/admin page: search customers, create/update packages, reply to chat
- Role-based access using profiles.role = 'staff'

## Pages
- `/` = Marketing + Customer portal
- `/admin.html` = Staff/admin dashboard (staff only)

## Notes
- Frontend uses Supabase JS CDN (no build tools required).
- Do NOT expose any `sb_secret_...` key in frontend code.
