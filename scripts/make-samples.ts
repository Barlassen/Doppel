/**
 * Generates the five demo images in public/samples (all fictional companies & people).
 *   npx tsx scripts/make-samples.ts
 */
import { writeFileSync } from "node:fs";
import QRCode from "qrcode";

const OUT = "public/samples";

// ---------- 1. Swiss QR-bill (Tier 0) ----------
const payload = [
  "SPC", "0200", "1",
  "CH9300762011623852957",
  "S", "Limmat Krankenkasse AG", "Seestrasse", "41", "8002", "Zürich", "CH",
  "", "", "", "", "", "", "",
  "412.00", "CHF",
  "S", "Barlas Demir", "Badenerstrasse", "512", "8048", "Zürich", "CH",
  "NON", "",
  "Prämie Dezember 2026",
  "EPD",
].join("\n");

async function qrBill() {
  const qr = await QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 0 });
  const inner = qr.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const viewBox = qr.match(/viewBox="([^"]+)"/)![1];
  const size = Number(viewBox.split(" ")[2]);
  const cross = `<g transform="translate(${292 + 92 - 13},${150 + 92 - 13})"><rect width="26" height="26" fill="#fff"/><rect x="2" y="2" width="22" height="22" fill="#000"/><rect x="11" y="6" width="4" height="14" fill="#fff"/><rect x="6" y="11" width="14" height="4" fill="#fff"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="620" viewBox="0 0 1240 620">
  <rect width="1240" height="620" fill="#fff"/>
  <line x1="0" y1="2" x2="1240" y2="2" stroke="#000" stroke-dasharray="6 6"/>
  <line x1="248" y1="0" x2="248" y2="620" stroke="#000" stroke-dasharray="6 6"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#000">
    <text x="20" y="44" font-size="22" font-weight="bold">Empfangsschein</text>
    <text x="20" y="84" font-size="13" font-weight="bold">Konto / Zahlbar an</text>
    <text x="20" y="104" font-size="14">CH93 0076 2011 6238 5295 7</text>
    <text x="20" y="122" font-size="14">Limmat Krankenkasse AG</text>
    <text x="20" y="140" font-size="14">Seestrasse 41, 8002 Zürich</text>
    <text x="20" y="182" font-size="13" font-weight="bold">Zahlbar durch</text>
    <text x="20" y="202" font-size="14">Barlas Demir</text>
    <text x="20" y="220" font-size="14">Badenerstrasse 512, 8048 Zürich</text>
    <text x="20" y="420" font-size="13" font-weight="bold">Währung   Betrag</text>
    <text x="20" y="440" font-size="14">CHF          412.00</text>
    <text x="272" y="44" font-size="22" font-weight="bold">Zahlteil</text>
    <text x="272" y="420" font-size="13" font-weight="bold">Währung   Betrag</text>
    <text x="272" y="440" font-size="14">CHF          412.00</text>
    <text x="520" y="84" font-size="13" font-weight="bold">Konto / Zahlbar an</text>
    <text x="520" y="104" font-size="14">CH93 0076 2011 6238 5295 7</text>
    <text x="520" y="122" font-size="14">Limmat Krankenkasse AG</text>
    <text x="520" y="140" font-size="14">Seestrasse 41, 8002 Zürich</text>
    <text x="520" y="182" font-size="13" font-weight="bold">Zusätzliche Informationen</text>
    <text x="520" y="202" font-size="14">Prämie Dezember 2026</text>
    <text x="520" y="244" font-size="13" font-weight="bold">Zahlbar durch</text>
    <text x="520" y="264" font-size="14">Barlas Demir</text>
    <text x="520" y="282" font-size="14">Badenerstrasse 512, 8048 Zürich</text>
  </g>
  <svg x="292" y="150" width="184" height="184" viewBox="${viewBox}" shape-rendering="crispEdges">${inner}</svg>
  ${cross}
</svg>`;
  void size;
  writeFileSync(`${OUT}/qr-bill.svg`, svg);
}

// ---------- 2. Property listing screenshot (Tier 1) ----------
const listing = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <rect width="1080" height="1350" fill="#f6f6f4"/>
  <rect width="1080" height="96" fill="#fff"/>
  <text x="48" y="60" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="bold" fill="#1d4f3b">immolake</text>
  <text x="840" y="60" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#555">Kaufen</text>
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bcd3e6"/><stop offset="1" stop-color="#e9eef2"/></linearGradient></defs>
  <rect x="0" y="96" width="1080" height="560" fill="url(#sky)"/>
  <rect x="180" y="300" width="720" height="356" fill="#d9cbb5"/>
  <rect x="180" y="270" width="720" height="40" fill="#8c6f56"/>
  <g fill="#6f8aa3">${Array.from({ length: 12 }, (_, i) => `<rect x="${220 + (i % 6) * 110}" y="${340 + Math.floor(i / 6) * 150}" width="70" height="90"/>`).join("")}</g>
  <rect x="0" y="600" width="1080" height="56" fill="#7c9a6b"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#111">
    <text x="48" y="740" font-size="44" font-weight="bold">4.5 Zimmer Wohnung</text>
    <text x="48" y="796" font-size="30" fill="#444">Schaffhauserstrasse 220, 8050 Zürich</text>
    <text x="48" y="880" font-size="52" font-weight="bold">CHF 940'000.–</text>
    <text x="48" y="920" font-size="26" fill="#555">Kaufpreis</text>
    <text x="48" y="1010" font-size="30">Wohnfläche 112 m²</text>
    <text x="48" y="1060" font-size="30">Baujahr 2016 · Balkon · Lift</text>
    <text x="48" y="1110" font-size="30">Bezugsbereit ab 01.04.2027</text>
  </g>
  <rect x="48" y="1180" width="984" height="96" rx="12" fill="#1d4f3b"/>
  <text x="540" y="1240" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="32" fill="#fff">Kontakt aufnehmen</text>
</svg>`;

// ---------- 3. Supermarket receipt (Tier 1) ----------
const items: [string, string][] = [
  ["Vollmilch 1L", "1.65"], ["Brot Ruchmehl", "3.20"], ["Gruyère AOP 250g", "6.95"], ["Äpfel Gala 1kg", "4.40"],
  ["Pasta Spaghetti", "2.10"], ["Tomaten Pelati", "1.95"], ["Olivenöl extra", "9.80"], ["Poulet Brust", "14.90"],
  ["Kaffee Bohnen 500g", "11.50"], ["Joghurt Nature x4", "3.60"], ["Wein Pinot Noir", "16.90"], ["Schokolade 100g", "2.30"],
  ["Waschmittel", "8.20"],
];
const total = items.reduce((s, [, p]) => s + Number(p), 0).toFixed(2);
const receipt = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="1240" viewBox="0 0 640 1240">
  <rect width="640" height="1240" fill="#fbfaf6"/>
  <g font-family="'Courier New', Courier, monospace" fill="#111" font-size="26">
    <text x="320" y="80" text-anchor="middle" font-size="40" font-weight="bold">ALPINA MARKT</text>
    <text x="320" y="120" text-anchor="middle">Bahnhofplatz 3, 8001 Zürich</text>
    <text x="320" y="156" text-anchor="middle">MWST-Nr CHE-123.456.789</text>
    <text x="40" y="220">20.11.2026  18:42  Kasse 4</text>
    <line x1="40" y1="240" x2="600" y2="240" stroke="#111" stroke-dasharray="8 6"/>
    ${items.map(([n, p], i) => `<text x="40" y="${290 + i * 46}">${n}</text><text x="600" y="${290 + i * 46}" text-anchor="end">${p}</text>`).join("\n    ")}
    <line x1="40" y1="${290 + items.length * 46 - 16}" x2="600" y2="${290 + items.length * 46 - 16}" stroke="#111" stroke-dasharray="8 6"/>
    <text x="40" y="${290 + items.length * 46 + 34}" font-size="34" font-weight="bold">TOTAL CHF</text>
    <text x="600" y="${290 + items.length * 46 + 34}" font-size="34" font-weight="bold" text-anchor="end">${total}</text>
    <text x="40" y="${290 + items.length * 46 + 90}">Karte Debit       ${total}</text>
    <text x="320" y="${290 + items.length * 46 + 170}" text-anchor="middle">Merci für Ihren Einkauf!</text>
  </g>
</svg>`;

function tillReceipt(merchant: string, header: string[], rows: [string, string?][], footer: [string, string?][]) {
  const width = 640;
  const height = 230 + (rows.length + footer.length) * 43;
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const print = ([label, price]: [string, string?], y: number) =>
    `<text x="38" y="${y}">${escape(label)}</text>${price ? `<text x="602" y="${y}" text-anchor="end">${price}</text>` : ""}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fbfaf6"/>
  <g font-family="'Courier New', Courier, monospace" fill="#111" font-size="26">
    <text x="320" y="57" text-anchor="middle" font-size="38" font-weight="bold">${escape(merchant)}</text>
    ${header.map((line, i) => print([line], 101 + i * 34)).join("\n    ")}
    <path d="M38 187h564 M38 ${195 + rows.length * 43}h564" stroke="#555" stroke-dasharray="8 6"/>
    ${rows.map((row, i) => print(row, 224 + i * 43)).join("\n    ")}
    ${footer.map((row, i) => print(row, 238 + (rows.length + i) * 43)).join("\n    ")}
  </g>
</svg>`;
}

const receiptMarket = tillReceipt("FALKENRIED MARKT", [
  "Marktgasse 7, 3011 Bern", "Beleg 00538 · Kasse 2", "21.11.2026  10:42",
], [
  ["Vollmilch", "3.90"],
  ["  2 x 1.95"],
  ["Ruchbrot", "3.20"],
  ["Gruyère AOP", "8.50"],
  ["Waschmittel", "22.95"],
  ["Äpfel Gala", "10.75"],
  ["Aktion Waschmittel", "-2.00"],
], [
  ["TOTAL CHF", "47.30"],
  ["Karte Debit", "47.30"],
  ["MWST 2.6% / 8.1%"],
]);

const receiptCafe = tillReceipt("CAFÉ DES LUCIOLES", [
  "Rue du Verger 16, 1003 Lausanne", "Ticket 124 · Table 4", "20.11.2026  14:26",
], [
  ["Café crème", "8,40"],
  ["  2 x 4,20"],
  ["Tarte aux poires", "7,50"],
  ["Croque maison", "12,50"],
  ["Couvert", "2,00"],
  ["Pourboire", "2,00"],
], [
  ["TOTAL TTC CHF", "32,40"],
  ["Espèces", "40,00"],
  ["Rendu", "7,60"],
  ["Dont TVA 8.1%", "2,28"],
]);

// ---------- 4. Handwritten goal note (Tier 2) ----------
const font = "'Segoe Script', 'Bradley Hand', 'Snell Roundhand', 'Brush Script MT', cursive";
const note = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700">
  <rect width="900" height="700" fill="#efe7d2"/>
  <g transform="rotate(-4 450 350)">
    <rect x="90" y="70" width="720" height="560" fill="#fffbe9"/>
    ${Array.from({ length: 11 }, (_, i) => `<line x1="90" y1="${130 + i * 46}" x2="810" y2="${130 + i * 46}" stroke="#a9c4e0" stroke-width="2"/>`).join("")}
    <line x1="160" y1="70" x2="160" y2="630" stroke="#e8a3a3" stroke-width="2"/>
    <g font-family="${font}" fill="#24346b">
      <text x="190" y="166" font-size="46" transform="rotate(-2 190 166)">Sabbatical Japan</text>
      <text x="200" y="262" font-size="40" transform="rotate(1 200 262)">summer 2028 ~ 3 months</text>
      <text x="200" y="354" font-size="44" transform="rotate(-3 200 354)">need ≈ 25k !!</text>
      <text x="230" y="448" font-size="34" transform="rotate(2 230 448)">(flights, rail pass, ryokan)</text>
    </g>
    <circle cx="690" cy="520" r="62" fill="none" stroke="#8b6a3e" stroke-opacity="0.25" stroke-width="14"/>
  </g>
</svg>`;

// ---------- 5. Swiss Payslip / Lohnabrechnung (Tier 1) ----------
// Exact math: Brutto 10'050.00 - AHV/IV/EO 5.30% (532.65) - ALV 1.10% (110.55)
//             - NBU 0.80% (80.40) - BVG 8.00% on 8'455.00 (676.40) = Nettolohn 8'650.00
const payslip = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1280" viewBox="0 0 960 1280">
  <rect width="960" height="1280" fill="#ffffff"/>
  <rect x="0" y="0" width="960" height="12" fill="#1d3557"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#111111">
    <text x="64" y="84" font-size="34" font-weight="bold" fill="#1d3557">Sihlberg Informatik AG</text>
    <text x="64" y="118" font-size="20" fill="#555555">Hardturmstrasse 161, 8005 Zürich</text>
    <text x="896" y="84" text-anchor="end" font-size="32" font-weight="bold">Lohnabrechnung</text>
    <text x="896" y="118" text-anchor="end" font-size="22" fill="#444444">November 2026</text>

    <line x1="64" y1="150" x2="896" y2="150" stroke="#d0d4dc" stroke-width="2"/>

    <text x="64" y="198" font-size="18" font-weight="bold" fill="#555555">Mitarbeiter</text>
    <text x="64" y="230" font-size="24" font-weight="bold">Barlas Demir</text>
    <text x="64" y="260" font-size="20" fill="#333333">Badenerstrasse 512, 8048 Zürich</text>

    <text x="540" y="198" font-size="18" font-weight="bold" fill="#555555">Abrechnungsdaten</text>
    <text x="540" y="230" font-size="20">Periode: 01.11.2026 – 30.11.2026</text>
    <text x="540" y="260" font-size="20">Personal-Nr.: 1042 · Pensum: 100%</text>
    <text x="540" y="290" font-size="20">AHV-Nr.: 756.1234.5678.90</text>

    <rect x="64" y="340" width="832" height="48" fill="#f1f3f6"/>
    <text x="80" y="372" font-size="20" font-weight="bold">Lohnart</text>
    <text x="540" y="372" text-anchor="end" font-size="20" font-weight="bold">Basis CHF</text>
    <text x="680" y="372" text-anchor="end" font-size="20" font-weight="bold">Ansatz</text>
    <text x="880" y="372" text-anchor="end" font-size="20" font-weight="bold">Betrag CHF</text>

    <text x="80" y="438" font-size="24">Monatslohn</text>
    <text x="540" y="438" text-anchor="end" font-size="24">10'050.00</text>
    <text x="680" y="438" text-anchor="end" font-size="24">100.0 %</text>
    <text x="880" y="438" text-anchor="end" font-size="24">10'050.00</text>

    <line x1="64" y1="470" x2="896" y2="470" stroke="#c8ccd4" stroke-width="2"/>
    <text x="80" y="516" font-size="26" font-weight="bold">Bruttolohn</text>
    <text x="880" y="516" text-anchor="end" font-size="26" font-weight="bold">10'050.00</text>

    <text x="80" y="592" font-size="20" font-weight="bold" fill="#555555">Sozialabzüge</text>

    <text x="80" y="644" font-size="24">AHV / IV / EO</text>
    <text x="540" y="644" text-anchor="end" font-size="24">10'050.00</text>
    <text x="680" y="644" text-anchor="end" font-size="24">5.30 %</text>
    <text x="880" y="644" text-anchor="end" font-size="24">-532.65</text>

    <text x="80" y="698" font-size="24">ALV Arbeitslosenversicherung</text>
    <text x="540" y="698" text-anchor="end" font-size="24">10'050.00</text>
    <text x="680" y="698" text-anchor="end" font-size="24">1.10 %</text>
    <text x="880" y="698" text-anchor="end" font-size="24">-110.55</text>

    <text x="80" y="752" font-size="24">NBU Nichtberufsunfall</text>
    <text x="540" y="752" text-anchor="end" font-size="24">10'050.00</text>
    <text x="680" y="752" text-anchor="end" font-size="24">0.80 %</text>
    <text x="880" y="752" text-anchor="end" font-size="24">-80.40</text>

    <text x="80" y="806" font-size="24">BVG Pensionskasse</text>
    <text x="540" y="806" text-anchor="end" font-size="24">8'455.00</text>
    <text x="680" y="806" text-anchor="end" font-size="24">8.00 %</text>
    <text x="880" y="806" text-anchor="end" font-size="24">-676.40</text>

    <line x1="64" y1="842" x2="896" y2="842" stroke="#c8ccd4" stroke-width="2"/>
    <text x="80" y="886" font-size="24" font-weight="bold">Total Abzüge</text>
    <text x="880" y="886" text-anchor="end" font-size="24" font-weight="bold">-1'400.00</text>

    <rect x="64" y="936" width="832" height="84" rx="8" fill="#edf4f0" stroke="#1d4f3b" stroke-width="2"/>
    <text x="88" y="990" font-size="32" font-weight="bold" fill="#1d4f3b">Nettolohn / Auszahlung</text>
    <text x="872" y="990" text-anchor="end" font-size="34" font-weight="bold" fill="#1d4f3b">CHF 8'650.00</text>

    <text x="64" y="1090" font-size="20" fill="#444444">Auszahlung am 25.11.2026 auf Konto CH56 0483 5012 3456 7800 9</text>
    <text x="64" y="1126" font-size="18" fill="#777777">Dieses Dokument wurde maschinell erstellt und ist ohne Unterschrift gültig.</text>
  </g>
</svg>`;

qrBill().then(() => {
  writeFileSync(`${OUT}/listing.svg`, listing);
  writeFileSync(`${OUT}/receipt.svg`, receipt);
  writeFileSync(`${OUT}/receipt-market.svg`, receiptMarket);
  writeFileSync(`${OUT}/receipt-cafe.svg`, receiptCafe);
  writeFileSync(`${OUT}/note.svg`, note);
  writeFileSync(`${OUT}/payslip.svg`, payslip);
  console.log("Samples written, including the long receipt (CHF " + total + "), supermarket, and café.");
});
