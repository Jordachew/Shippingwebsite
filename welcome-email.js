import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  try {
    const { user_id } = req.body;

    const { data: profile } = await supabase
      .from("profiles")
      .select("email, full_name, customer_no")
      .eq("id", user_id)
      .single();

    const first =
      profile.full_name?.split(" ")[0] ||
      profile.email.split("@")[0];

    const address = `
${first} — ${profile.customer_no}
3706 NW 16th Street
Lauderhill, Florida 33311
`;

    await resend.emails.send({
      from: "Suenos Shipping <no-reply@suenosshipping.com>",
      to: profile.email,
      subject: "Your Suenos Shipping Account Details",
      text: `
Welcome to Suenos Shipping, ${first}!

Your account number:
${profile.customer_no}

Use this shipping address for all packages:

${address}

If you have questions, log in and message us anytime.
`,
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
