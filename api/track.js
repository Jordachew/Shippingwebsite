import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const tracking = String(req.query.tracking || "").trim();
  if (!tracking) return res.status(400).json({ error: "tracking required" });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase
    .from("packages")
    .select("tracking,status,updated_at")
    .eq("tracking", tracking)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "not found" });

  res.json(data);
}
