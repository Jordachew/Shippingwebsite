/* ======================================================
   Sueños Shipping – Clean White Theme (Customer + Admin)
====================================================== */

:root {
  --bg: #ffffff;
  --bg-soft: #f6f7f9;
  --card: #ffffff;
  --border: #e5e7eb;
  --text: #111827;
  --muted: #6b7280;
  --brand: #2563eb;
  --brand-soft: #e0e7ff;
  --danger: #dc2626;
  --success: #16a34a;
}

/* ---------- Base ---------- */
* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
}

.hidden {
  display: none !important;
}

.muted {
  color: var(--muted);
}

.small {
  font-size: 0.85rem;
}

/* ---------- Layout ---------- */
.container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.25rem;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.25rem;
  margin-bottom: 1rem;
}

.card__head {
  margin-bottom: 0.75rem;
}

/* ---------- Headings ---------- */
h1, h2, h3 {
  margin: 0 0 0.75rem 0;
  font-weight: 600;
}

.h2 {
  font-size: 1.25rem;
}

.h3 {
  font-size: 1.05rem;
}

/* ---------- Buttons ---------- */
.btn {
  background: var(--brand);
  color: #ffffff;
  border: none;
  border-radius: 8px;
  padding: 0.5rem 0.9rem;
  font-size: 0.9rem;
  cursor: pointer;
}

.btn:hover {
  opacity: 0.9;
}

.btn--ghost {
  background: transparent;
  color: var(--brand);
  border: 1px solid var(--border);
}

.btn--danger {
  background: var(--danger);
}

.btn-sm {
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
}

/* ---------- Inputs ---------- */
.input,
select,
textarea {
  width: 100%;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #ffffff;
  color: var(--text);
  font-size: 0.9rem;
}

.input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: var(--brand);
}

/* ---------- Tables ---------- */
.table {
  width: 100%;
  border-collapse: collapse;
}

.table th,
.table td {
  border-bottom: 1px solid var(--border);
  padding: 0.6rem;
  text-align: left;
  font-size: 0.9rem;
}

.table th {
  background: var(--bg-soft);
  font-weight: 600;
}

/* ---------- Tags ---------- */
.tag {
  display: inline-block;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 0.75rem;
}

/* ---------- Chat (CUSTOMER + ADMIN FIX) ---------- */
.chatBody,
#chatBody,
#adminChatBody {
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.75rem;
  max-height: 320px;
  overflow-y: auto;
}

/* Chat bubbles */
.bubble {
  background: #ffffff;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.5rem 0.7rem;
  margin-bottom: 0.5rem;
  max-width: 85%;
}

.bubble.me {
  background: var(--brand-soft);
  border-color: var(--brand);
  margin-left: auto;
}

/* Bubble meta */
.bubble .meta {
  margin-top: 0.25rem;
  font-size: 0.7rem;
  color: var(--muted);
  display: flex;
  justify-content: space-between;
}

/* Chat input area */
.chatInput,
#chatInput,
#adminChatInput,
textarea {
  background: #ffffff !important;
  color: var(--text) !important;
  border: 1px solid var(--border);
}

/* ---------- Stats ---------- */
.statsRow {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
}

.stat {
  background: var(--bg-soft);
  border-radius: 10px;
  padding: 0.75rem;
  text-align: center;
}

.stat__value {
  font-size: 1.4rem;
  font-weight: 600;
}

.stat__label {
  font-size: 0.8rem;
  color: var(--muted);
}

/* ---------- Utility ---------- */
.row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.between {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stack > * + * {
  margin-top: 0.5rem;
}
