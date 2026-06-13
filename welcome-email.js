import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const resend = new Resend(process.env.RESEND_API_KEY);

function safeName(profile) {
  const fn = (profile?.full_name || "").trim();
  if (fn) return fn;
  const em = (profile?.email || "").trim();
  return em ? em.split("@")[0] : "there";
}

function buildAddress(profile) {
  const name = safeName(profile);
  const cust = profile?.customer_no ? ` (${profile.customer_no})` : "";
  return `${name}${cust}
3706 NW 16th Street
Lauderhill, Florida 33311`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: "user_id required" });

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("email, full_name, customer_no, phone")
      .eq("id", user_id)
      .single();

    if (error) throw error;
    if (!profile?.email) return res.status(400).json({ error: "Customer email missing." });

    const full = safeName(profile);
    const addr = buildAddress(profile);

    const portalUrl = process.env.PORTAL_URL || "https://suenosshipping.com";
    const subject = "Welcome to Sueños Shipping — Your Account & Shipping Address";

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
        <div style="padding:16px 0;">
          <div style="font-size:20px;font-weight:700;">Sueños Shipping and Variety Store</div>
          <div style="color:#444">Your account details</div>
        </div>

        <p>Hi <strong>${full}</strong>,</p>
        <p>Welcome! Your customer number is:</p>
        <p style="font-size:18px;font-weight:700;">${profile.customer_no || ""}</p>

        <p><strong>Use this shipping address for all packages:</strong></p>
        <pre style="background:#f6f6f6;padding:12px;border-radius:8px;white-space:pre-wrap;">${addr}</pre>

        <p>Once your supplier invoice is available (Amazon/Shein/eBay, etc.), upload it in your portal under <strong>Supplier Invoice</strong> for customs processing.</p>

        <p><a href="${portalUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 14px;border-radius:10px;text-decoration:none;">Open Customer Portal</a></p>

        <p style="color:#444;font-size:12px;margin-top:18px;">
          If you have questions, reply in portal chat and our team will help.
        </p>
      </div>
    `;

    await resend.emails.send({
      from: "Sueños Shipping <no-reply@suenosshipping.com>",
      to: profile.email,
      subject,
      html
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}
