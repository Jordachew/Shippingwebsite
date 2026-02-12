const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  try {
    const tracking = String(req.query.tracking || "").trim();
    if (!tracking) return res.status(400).json({ error: "tracking required" });

    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return res.status(500).json({
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Vercel env vars."
      });
    }

    const supabase = createClient(url, serviceKey);

    const { data, error } = await supabase
      .from("packages")
      .select("tracking,status,updated_at")
      .eq("tracking", tracking)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "not found" });

    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
};
