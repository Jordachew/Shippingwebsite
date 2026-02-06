<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Track Package • Sueños Shipping</title>
  <link rel="stylesheet" href="styles.css"/>
</head>
<body>
<header class="header">
  <div class="container header__inner">
    <a class="brand" href="/">
      <div class="brand__mark">S</div>
      <div class="brand__text">
        <div class="brand__name">Sueños Shipping</div>
        <div class="brand__tag">Public Tracking</div>
      </div>
    </a>
  </div>
</header>

<main class="section">
  <div class="container">
    <div class="section__head">
      <h2>Track Your Package</h2>
      <p>Enter your tracking number for the latest status.</p>
    </div>

    <div class="card card--pad">
      <form class="form" id="trackForm">
        <label>Tracking Number
          <input id="tracking" type="text" placeholder="SSX-1234" required/>
        </label>
        <button class="btn btn--primary" type="submit">Track</button>
      </form>

      <div class="divider"></div>
      <div id="out" class="muted"></div>
    </div>

    <div class="card card--pad" style="margin-top:14px;">
      <h3>Business Hours</h3>
      <p class="muted">
        Monday to Friday 10:00 AM – 5:00 PM<br/>
        Email: suenoshipping@gmail.com<br/>
        Phone: 1-876-364-1205<br/>
        Location: Rhoden Hall District, Clarendon
      </p>
    </div>
  </div>
</main>

<script>
  document.getElementById("trackForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tracking = document.getElementById("tracking").value.trim();
    const out = document.getElementById("out");
    out.textContent = "Checking...";

    const r = await fetch(`/api/track?tracking=${encodeURIComponent(tracking)}`);
    const j = await r.json();

    if (!r.ok) {
      out.textContent = j.error || "Not found.";
      return;
    }

    out.innerHTML = `
      <div><strong>Tracking:</strong> ${j.tracking}</div>
      <div><strong>Status:</strong> ${j.status}</div>
      <div><strong>Last Updated:</strong> ${new Date(j.updated_at).toLocaleString()}</div>
    `;
  });
</script>
</body>
</html>

