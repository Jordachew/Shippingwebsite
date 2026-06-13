import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// This endpoint processes notification_queue rows created by DB triggers.
// It requires a valid Supabase access token for a user with role staff/admin.

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const resend = new Resend(process.env.RESEND_API_KEY);

function getBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h) return null;
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function firstName(profile) {
  const fn = (profile?.full_name || "").trim();
  if (fn) return fn.split(/\s+/)[0];
  const em = (profile?.email || "").trim();
  return em ? em.split("@")[0] : "there";
}

function formatJMD(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "JMD 0";
  return "JMD " + x.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function statusNote(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "received at warehouse") return "We’ve received your package at our warehouse.";
  if (s === "processing") return "Your package is being processed.";
  if (s === "in transit") return "Your package is on the way through shipping stages.";
  if (s === "read for pickup" || s === "ready for pickup") return "Your package is ready for pickup. Please confirm your pickup location in the portal.";
  if (s === "pickup/delivered") return "Your package has been picked up/delivered. Thank you!";
  if (s === "hold") return "Your package is on hold. Please check portal messages for next steps.";
  return "There is an update to your package.";
}

function buildEmail({ template, profile, payload, tracking }) {
  const name = firstName(profile);
  const customerNo = profile?.customer_no ? ` (${profile.customer_no})` : "";
  const subjectPrefix = "Sueños Shipping";

  if (template === "package_status") {
    const oldS = payload?.old_status || "";
    const newS = payload?.new_status || "";
    const note = statusNote(newS);
    return {
      subject: `${subjectPrefix}: ${tracking} — Status update`,
      text:
`Hi ${name}${customerNo},

${note}

Tracking: ${tracking}
From: ${oldS}
To:   ${newS}

Log in to view details, confirm pickup location, and message support if needed.

— Sueños Shipping`
    };
  }

  if (template === "invoice_approved") {
    return {
      subject: `${subjectPrefix}: ${tracking} — Supplier invoice approved`,
      text:
`Hi ${name}${customerNo},

Your supplier invoice for package ${tracking} has been approved.

If anything else is needed, we will message you in the portal.

— Sueños Shipping`
    };
  }

  if (template === "bill_created") {
    return {
      subject: `${subjectPrefix}: ${tracking} — Shipping bill ready`,
      text:
`Hi ${name}${customerNo},

Your Sueños Shipping bill for package ${tracking} is ready.

Please log in to download your bill and view the amount due.

— Sueños Shipping`
    };
  }

  if (template === "receipt_created") {
    return {
      subject: `${subjectPrefix}: ${tracking} — Payment receipt`,
      text:
`Hi ${name}${customerNo},

We’ve received your payment for package ${tracking}. Your receipt is ready.

Please log in to download your receipt.

— Sueños Shipping`
    };
  }

  // Fallback
  return {
    subject: `${subjectPrefix}: Update`,
    text:
`Hi ${name}${customerNo},

There is an update on your account for package (${tracking}).

— Sueños Shipping`
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const token = getBearer(req);
    if (!token) {
      res.status(401).json({ error: "Missing Authorization Bearer token" });
      return;
    }

    // Verify caller is staff/admin
    const auth = await supabase.auth.getUser(token);
    if (auth.error || !auth.data?.user) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const callerId = auth.data.user.id;
    const roleRes = await supabase
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();

    const role = roleRes.data?.role;
    if (!role || (role !== "staff" && role !== "admin")) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const limit = Math.min(Number(req.body?.limit || 20) || 20, 50);

    // Pull pending notifications
    const q = await supabase
      .from("notification_queue")
      .select("id,user_id,tracking,template,payload,attempts")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (q.error) throw q.error;

    const items = q.data || [];
    if (!items.length) {
      res.json({ ok: true, processed: 0, sent: 0, failed: 0 });
      return;
    }

    let sent = 0;
    let failed = 0;

    for (const item of items) {
      // Mark processing
      await supabase
        .from("notification_queue")
        .update({ status: "processing" })
        .eq("id", item.id);

      try {
        const prof = await supabase
          .from("profiles")
          .select("email,full_name,customer_no")
          .eq("id", item.user_id)
          .single();

        if (prof.error) throw prof.error;
        if (!prof.data?.email) throw new Error("No customer email found");

        const email = buildEmail({
          template: item.template,
          profile: prof.data,
          payload: item.payload || {},
          tracking: item.tracking,
        });

        await resend.emails.send({
          from: "Sueños Shipping <no-reply@suenosshipping.com>",
          to: prof.data.email,
          subject: email.subject,
          text: email.text,
        });

        await supabase
          .from("notification_queue")
          .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
          .eq("id", item.id);

        sent += 1;
      } catch (e) {
        const attempts = (item.attempts || 0) + 1;
        const terminal = attempts >= 3;
        await supabase
          .from("notification_queue")
          .update({
            status: terminal ? "failed" : "pending",
            attempts,
            last_error: String(e?.message || e),
          })
          .eq("id", item.id);
        failed += 1;
      }
    }

    res.json({ ok: true, processed: items.length, sent, failed });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
