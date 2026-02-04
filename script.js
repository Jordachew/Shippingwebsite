// === EDIT YOUR RATES HERE (JMD) ===
// This sample mimics the style of the reference site, but you should replace with YOUR real rates.
const rates = [
  { lbs: 1,  jmd: 400 },
  { lbs: 2,  jmd: 750 },
  { lbs: 3,  jmd: 1050 },
  { lbs: 4,  jmd: 1350 },
  { lbs: 5,  jmd: 1600 },
  { lbs: 6,  jmd: 1950 },
  { lbs: 7,  jmd: 2150 },
  { lbs: 8,  jmd: 2350 },
  { lbs: 9,  jmd: 2600 },
  { lbs: 10, jmd: 2950 },
];

// Optional fixed processing fee (JMD) — set to 0 if you don’t want it
const fixedFeeJMD = 500;

function formatJMD(n){
  return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD", maximumFractionDigits: 0 }).format(n);
}

function buildRatesTable(){
  const body = document.getElementById("ratesTableBody");
  if(!body) return;
  body.innerHTML = rates.map(r => `<tr><td>${r.lbs}</td><td>${formatJMD(r.jmd)}</td></tr>`).join("");
}

function findRateForWeight(weightLbs){
  // Simple rule: round up to next whole lb, then match rate.
  const rounded = Math.ceil(weightLbs);
  const match = rates.find(r => r.lbs === rounded);
  if(match) return { rounded, rate: match.jmd };

  // If above max table, extend linearly using last step difference (simple fallback)
  const last = rates[rates.length - 1];
  const prev = rates[rates.length - 2] || last;
  const step = Math.max(0, last.jmd - prev.jmd);

  const extraLbs = Math.max(0, rounded - last.lbs);
  return { rounded, rate: last.jmd + (extraLbs * step) };
}

function setupCalculator(){
  const form = document.getElementById("calcForm");
  const result = document.getElementById("result");
  const year = document.getElementById("year");

  if(year) year.textContent = new Date().getFullYear();

  if(!form || !result) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const type = document.getElementById("calculatorType")?.value || "air";

    if(type === "variety"){
      result.innerHTML = `
        <div class="result__big">In-store</div>
        <div class="result__sub">Variety Store purchases are paid in-store. Ask staff for current specials.</div>
      `;
      return;
    }

    const weight = parseFloat(document.getElementById("weight").value);
    const valueUSD = parseFloat(document.getElementById("value").value);
    const tariff = (document.getElementById("tariff").value || "").trim();

    if(!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(valueUSD) || valueUSD < 0){
      result.innerHTML = `<div class="result__big">—</div><div class="result__sub">Please enter valid numbers.</div>`;
      return;
    }

    const { rounded, rate } = findRateForWeight(weight);
    const total = rate + fixedFeeJMD;

    const tariffNote = tariff ? `Tariff code noted: <strong>${tariff}</strong>.` : `No tariff code provided.`;

    result.innerHTML = `
      <div class="result__big">${formatJMD(total)}</div>
      <div class="result__sub">
        Weight used: <strong>${rounded} lb</strong> (rounded up). Base: <strong>${formatJMD(rate)}</strong> + Fee: <strong>${formatJMD(fixedFeeJMD)}</strong>.
        <br/>Declared value: <strong>$${valueUSD.toFixed(2)} USD</strong>. ${tariffNote}
      </div>
    `;
  });
}

function setupMobileNav(){
  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("nav");
  if(!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    const isOpen = nav.style.display === "flex";
    nav.style.display = isOpen ? "none" : "flex";
    toggle.setAttribute("aria-expanded", String(!isOpen));
  });

  // Close after clicking a link (mobile)
  nav.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
    if(window.matchMedia("(max-width: 720px)").matches){
      nav.style.display = "none";
      toggle.setAttribute("aria-expanded", "false");
    }
  }));
}

buildRatesTable();
setupCalculator();
setupMobileNav();
