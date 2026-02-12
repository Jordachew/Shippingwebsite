import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const tracking = String(req.body?.tracking || "").trim();
  if (!tracking) return res.status(400).json({ error: "tracking required" });

  if (!process.env.RESEND_API_KEY) {
    return res.status(400).json({ error: "Missing RESEND_API_KEY in Vercel env vars." });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: pkg, error: pErr } = await supabase
    .from("packages")
    .select("tracking,status,pickup,user_id")
    .eq("tracking", tracking)
    .maybeSingle();

  if (pErr) return res.status(500).json({ error: pErr.message });
  if (!pkg) return res.status(404).json({ error: "not found" });
  if (pkg.status !== "READY_FOR_PICKUP") return res.status(400).json({ error: "Status must be READY_FOR_PICKUP" });

  const { data: prof } = await supabase
    .from("profiles")
    .select("email,full_name")
    .eq("id", pkg.user_id)
    .maybeSingle();

  if (!prof?.email) return res.status(400).json({ error: "Customer email missing." });

  const pickupText = pkg.pickup === "RHODEN_HALL_CLARENDON"
    ? "Rhoden Hall District, Clarendon"
    : "UWI, Kingston";

  const emailResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Sueños Shipping <notifications@suenosshipping.com>",
      to: [prof.email],
      subject: `Ready for Pickup: ${pkg.tracking}`,
      html: `
        <p>Hi ${prof.full_name || "there"},</p>
        <p>Your package <strong>${pkg.tracking}</strong> is <strong>Ready for Pickup</strong>.</p>
        <p><strong>Pickup Location:</strong> ${pickupText}</p>
        <p>If you need to confirm or change your pickup location, reply in your portal chat.</p>
        <p><strong>Business hours:</strong> Mon–Fri 10:00 AM–5:00 PM</p>
        <p><strong>Contact:</strong> 1-876-364-1205 • suenoshipping@gmail.com</p>
      `
    })
  });

  if (!emailResp.ok) {
    const t = await emailResp.text();
    return res.status(500).json({ error: `Email failed: ${t}` });
  }

  res.json({ ok: true });
}

