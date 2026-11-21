/**
 * Generates the vision evaluation samples in public/samples/vision/
 * (all fictional addresses, buildings, and companies).
 *
 *   npx tsx scripts/make-vision-samples.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const OUT = "public/samples/vision";

// ---------- 1. Clean CAD-style floor plan with room areas printed ----------
// 4.5-room apartment in Winterthur, 112 m² net living area + 14 m² balcony, CHF 940'000
// CHF 940'000 / 112 m² = CHF 8'390/m² (6% above Winterthur illustrative median CHF 7'900/m²)
const PLAN_CAD_AREAS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="900" viewBox="0 0 1100 900">
  <rect width="1100" height="900" fill="#ffffff"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#111111">
    <text x="60" y="56" font-size="28" font-weight="bold">Grundriss · 4.5-Zimmer-Eigentumswohnung</text>
    <text x="60" y="88" font-size="20" fill="#444444">Residenz Eulachpark · 8400 Winterthur · Kaufpreis CHF 940'000</text>
    <text x="1040" y="56" text-anchor="end" font-size="24" font-weight="bold">Nettowohnfläche 112 m²</text>
    <text x="1040" y="88" text-anchor="end" font-size="18" fill="#555555">Massstab 1:100 · Balkon 14.0 m²</text>
  </g>

  <!-- Outer structural walls -->
  <rect x="60" y="130" width="780" height="620" fill="#fcfcfa" stroke="#111111" stroke-width="10"/>

  <!-- Balcony (exterior, right side) -->
  <rect x="840" y="130" width="190" height="360" fill="#f3f6f4" stroke="#111111" stroke-width="5" stroke-dasharray="12 6"/>

  <!-- Interior partition walls -->
  <!-- Horizontal main spine separating North rooms (y:130..390) from Corridor/South rooms -->
  <line x1="60" y1="390" x2="840" y2="390" stroke="#111111" stroke-width="7"/>
  <!-- Corridor bottom wall (y=490 from x=60 to x=540) -->
  <line x1="60" y1="490" x2="540" y2="490" stroke="#111111" stroke-width="7"/>

  <!-- North rooms vertical partitions: Eltern | Zimmer 2 | Zimmer 3 / Büro | Küche -->
  <line x1="280" y1="130" x2="280" y2="390" stroke="#111111" stroke-width="6"/>
  <line x1="480" y1="130" x2="480" y2="390" stroke="#111111" stroke-width="6"/>
  <line x1="660" y1="130" x2="660" y2="390" stroke="#111111" stroke-width="6"/>

  <!-- South/middle vertical partitions: Bad/WC | DU/WC | Entrée/Korridor | Essbereich | Wohnen -->
  <line x1="210" y1="490" x2="210" y2="750" stroke="#111111" stroke-width="6"/>
  <line x1="340" y1="490" x2="340" y2="750" stroke="#111111" stroke-width="6"/>
  <line x1="540" y1="390" x2="540" y2="750" stroke="#111111" stroke-width="6"/>
  <!-- Dashed open separator between Essbereich (open dining half-room) and Wohnen -->
  <line x1="540" y1="530" x2="840" y2="530" stroke="#444444" stroke-width="3" stroke-dasharray="8 8"/>

  <!-- Room labels, printed areas, and dimensions -->
  <g font-family="Arial, Helvetica, sans-serif" fill="#111111" text-anchor="middle">
    <!-- 1. Eltern (17.6 m²) -->
    <text x="170" y="235" font-size="22" font-weight="bold">Eltern</text>
    <text x="170" y="268" font-size="22">17.6 m²</text>
    <text x="170" y="298" font-size="16" fill="#555555">4.40 × 4.00 m</text>

    <!-- 2. Zimmer 2 (14.4 m²) -->
    <text x="380" y="235" font-size="22" font-weight="bold">Zimmer 2</text>
    <text x="380" y="268" font-size="22">14.4 m²</text>
    <text x="380" y="298" font-size="16" fill="#555555">4.00 × 3.60 m</text>

    <!-- 3. Zimmer 3 / Büro (12.6 m²) -->
    <text x="570" y="235" font-size="21" font-weight="bold">Zimmer 3 / Büro</text>
    <text x="570" y="268" font-size="22">12.6 m²</text>
    <text x="570" y="298" font-size="16" fill="#555555">3.60 × 3.50 m</text>

    <!-- 4. Küche (10.8 m²) -->
    <text x="750" y="235" font-size="22" font-weight="bold">Küche</text>
    <text x="750" y="268" font-size="22">10.8 m²</text>
    <text x="750" y="298" font-size="16" fill="#555555">3.60 × 3.00 m</text>

    <!-- 5. Entrée / Korridor (8.8 m²) -->
    <text x="300" y="435" font-size="20" font-weight="bold">Entrée / Korridor</text>
    <text x="300" y="465" font-size="20">8.8 m² · 4.40 × 2.00 m</text>

    <!-- 6. Bad / WC (7.2 m²) -->
    <text x="135" y="600" font-size="21" font-weight="bold">Bad / WC</text>
    <text x="135" y="632" font-size="21">7.2 m²</text>
    <text x="135" y="660" font-size="16" fill="#555555">3.00 × 2.40 m</text>

    <!-- 7. DU / WC (4.2 m²) -->
    <text x="275" y="600" font-size="21" font-weight="bold">DU / WC</text>
    <text x="275" y="632" font-size="21">4.2 m²</text>
    <text x="275" y="660" font-size="16" fill="#555555">2.10 × 2.00 m</text>

    <!-- 8. Essbereich offen (10.4 m²) -->
    <text x="690" y="445" font-size="21" font-weight="bold">Essbereich (offen)</text>
    <text x="690" y="476" font-size="21">10.4 m²</text>
    <text x="690" y="504" font-size="16" fill="#555555">3.25 × 3.20 m</text>

    <!-- 9. Wohnen (26.0 m²) -->
    <text x="690" y="620" font-size="24" font-weight="bold">Wohnen</text>
    <text x="690" y="655" font-size="24">26.0 m²</text>
    <text x="690" y="685" font-size="17" fill="#555555">5.20 × 5.00 m</text>

    <!-- 10. Balkon (14.0 m²) -->
    <text x="935" y="290" font-size="22" font-weight="bold">Balkon</text>
    <text x="935" y="322" font-size="22">14.0 m²</text>
    <text x="935" y="352" font-size="16" fill="#555555">5.00 × 2.80 m</text>
  </g>

  <!-- Scale bar at bottom -->
  <g transform="translate(60, 810)" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#222222">
    <line x1="0" y1="0" x2="250" y2="0" stroke="#111111" stroke-width="4"/>
    <line x1="0" y1="-8" x2="0" y2="8" stroke="#111111" stroke-width="3"/>
    <line x1="50" y1="-6" x2="50" y2="6" stroke="#111111" stroke-width="2"/>
    <line x1="100" y1="-6" x2="100" y2="6" stroke="#111111" stroke-width="2"/>
    <line x1="250" y1="-8" x2="250" y2="8" stroke="#111111" stroke-width="3"/>
    <text x="0" y="26">0 m</text>
    <text x="45" y="26">1 m</text>
    <text x="95" y="26">2 m</text>
    <text x="235" y="26">5 m</text>
  </g>
</svg>`;

// ---------- 2. Floor plan with ONLY dimensions and a scale bar, NO printed m² areas ----------
// 4.5-room apartment in Bern (CHF 845'000). Interior computed from dimensions = 96.4 m².
const PLAN_DIMENSIONS_ONLY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="900" viewBox="0 0 1100 900">
  <rect width="1100" height="900" fill="#ffffff"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#111111">
    <text x="60" y="56" font-size="28" font-weight="bold">Grundriss · 4.5 Zimmer</text>
    <text x="60" y="88" font-size="20" fill="#444444">Aareblick Wohnungen · 3013 Bern · Verkaufspreis CHF 845'000</text>
    <text x="1040" y="56" text-anchor="end" font-size="20" font-weight="bold">Massstab 1:100</text>
    <text x="1040" y="86" text-anchor="end" font-size="16" fill="#555555">Alle Masse in Metern</text>
  </g>

  <!-- Outer structural walls -->
  <rect x="60" y="130" width="760" height="610" fill="#fcfcfa" stroke="#111111" stroke-width="10"/>
  <!-- Terrace -->
  <rect x="820" y="130" width="210" height="340" fill="#f5f7f5" stroke="#111111" stroke-width="5" stroke-dasharray="10 6"/>

  <!-- Interior walls -->
  <line x1="60" y1="385" x2="820" y2="385" stroke="#111111" stroke-width="7"/>
  <line x1="60" y1="485" x2="520" y2="485" stroke="#111111" stroke-width="7"/>
  <line x1="270" y1="130" x2="270" y2="385" stroke="#111111" stroke-width="6"/>
  <line x1="470" y1="130" x2="470" y2="385" stroke="#111111" stroke-width="6"/>
  <line x1="650" y1="130" x2="650" y2="385" stroke="#111111" stroke-width="6"/>
  <line x1="260" y1="485" x2="260" y2="740" stroke="#111111" stroke-width="6"/>
  <line x1="520" y1="385" x2="520" y2="740" stroke="#111111" stroke-width="6"/>
  <line x1="520" y1="520" x2="820" y2="520" stroke="#444444" stroke-width="3" stroke-dasharray="8 8"/>

  <!-- Room names and dimensions ONLY (no m² anywhere) -->
  <g font-family="Arial, Helvetica, sans-serif" fill="#111111" text-anchor="middle">
    <text x="165" y="245" font-size="22" font-weight="bold">Schlafen 1</text>
    <text x="165" y="280" font-size="20">4.20 × 3.80</text>

    <text x="370" y="245" font-size="22" font-weight="bold">Schlafen 2</text>
    <text x="370" y="280" font-size="20">3.80 × 3.20</text>

    <text x="560" y="245" font-size="21" font-weight="bold">Arbeitszimmer</text>
    <text x="560" y="280" font-size="20">3.50 × 3.00</text>

    <text x="735" y="245" font-size="22" font-weight="bold">Küche</text>
    <text x="735" y="280" font-size="20">3.20 × 2.80</text>

    <text x="290" y="440" font-size="20" font-weight="bold">Korridor · 4.50 × 1.80</text>

    <text x="160" y="605" font-size="22" font-weight="bold">Bad / WC</text>
    <text x="160" y="640" font-size="20">2.80 × 2.20</text>

    <text x="670" y="445" font-size="21" font-weight="bold">Essbereich (offen)</text>
    <text x="670" y="480" font-size="20">3.20 × 2.50</text>

    <text x="670" y="620" font-size="24" font-weight="bold">Wohnen</text>
    <text x="670" y="658" font-size="22">5.50 × 4.80</text>

    <text x="925" y="295" font-size="22" font-weight="bold">Terrasse</text>
    <text x="925" y="330" font-size="20">4.80 × 2.50</text>
  </g>

  <!-- Scale bar -->
  <g transform="translate(60, 810)" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#222222">
    <line x1="0" y1="0" x2="250" y2="0" stroke="#111111" stroke-width="4"/>
    <line x1="0" y1="-8" x2="0" y2="8" stroke="#111111" stroke-width="3"/>
    <line x1="50" y1="-6" x2="50" y2="6" stroke="#111111" stroke-width="2"/>
    <line x1="100" y1="-6" x2="100" y2="6" stroke="#111111" stroke-width="2"/>
    <line x1="250" y1="-8" x2="250" y2="8" stroke="#111111" stroke-width="3"/>
    <text x="0" y="26">0 m</text>
    <text x="45" y="26">1 m</text>
    <text x="95" y="26">2 m</text>
    <text x="235" y="26">5 m</text>
  </g>
</svg>`;

// ---------- 3. 3.5-room French Swiss plan with open kitchen/dining half-room ----------
// Lausanne 1004, stated 3.5 pièces, 88 m² surface habitable, CHF 890'000
const PLAN_35_HALFROOM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="860" viewBox="0 0 1100 860">
  <rect width="1100" height="860" fill="#ffffff"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#111111">
    <text x="60" y="56" font-size="28" font-weight="bold">Plan d’étage · Appartement 3.5 pièces</text>
    <text x="60" y="88" font-size="20" fill="#444444">Résidence Beaulieu · 1004 Lausanne · Prix de vente CHF 890'000</text>
    <text x="1040" y="56" text-anchor="end" font-size="24" font-weight="bold">Surface habitable 88 m²</text>
    <text x="1040" y="88" text-anchor="end" font-size="18" fill="#555555">Échelle 1:100 · Loggia 11.0 m²</text>
  </g>

  <rect x="60" y="130" width="760" height="580" fill="#fcfcfa" stroke="#111111" stroke-width="10"/>
  <rect x="820" y="130" width="210" height="320" fill="#f3f6f4" stroke="#111111" stroke-width="5" stroke-dasharray="10 6"/>

  <line x1="60" y1="380" x2="820" y2="380" stroke="#111111" stroke-width="7"/>
  <line x1="330" y1="130" x2="330" y2="380" stroke="#111111" stroke-width="6"/>
  <line x1="590" y1="130" x2="590" y2="380" stroke="#111111" stroke-width="6"/>
  <line x1="360" y1="380" x2="360" y2="710" stroke="#111111" stroke-width="6"/>
  <line x1="60" y1="490" x2="360" y2="490" stroke="#111111" stroke-width="6"/>
  <line x1="360" y1="530" x2="820" y2="530" stroke="#444444" stroke-width="3" stroke-dasharray="8 8"/>

  <g font-family="Arial, Helvetica, sans-serif" fill="#111111" text-anchor="middle">
    <text x="195" y="235" font-size="22" font-weight="bold">Chambre 1</text>
    <text x="195" y="268" font-size="22">15.6 m²</text>
    <text x="195" y="298" font-size="16" fill="#555555">4.10 × 3.80 m</text>

    <text x="460" y="235" font-size="22" font-weight="bold">Chambre 2</text>
    <text x="460" y="268" font-size="22">12.4 m²</text>
    <text x="460" y="298" font-size="16" fill="#555555">3.65 × 3.40 m</text>

    <text x="705" y="235" font-size="21" font-weight="bold">Salle de bain</text>
    <text x="705" y="268" font-size="22">6.2 m²</text>
    <text x="705" y="298" font-size="16" fill="#555555">2.60 × 2.38 m</text>

    <text x="210" y="442" font-size="20" font-weight="bold">Hall / Entrée · 7.5 m²</text>

    <text x="590" y="438" font-size="21" font-weight="bold">Cuisine ouverte / Coin à manger</text>
    <text x="590" y="470" font-size="21">16.5 m² (0.5 pièce)</text>
    <text x="590" y="498" font-size="16" fill="#555555">4.40 × 3.75 m</text>

    <text x="590" y="610" font-size="24" font-weight="bold">Séjour</text>
    <text x="590" y="644" font-size="24">24.8 m²</text>
    <text x="590" y="674" font-size="16" fill="#555555">5.15 × 4.82 m</text>

    <text x="925" y="275" font-size="22" font-weight="bold">Loggia / Balcon</text>
    <text x="925" y="308" font-size="22">11.0 m²</text>
    <text x="925" y="338" font-size="16" fill="#555555">4.40 × 2.50 m</text>
  </g>
</svg>`;

// ---------- 4. Skewed/photographed print variant where stated area erroneously includes the balcony ----------
const PLAN_SKEWED_SOURCE_SVG = PLAN_CAD_AREAS_SVG.replace(
  "Nettowohnfläche 112 m²",
  "Wohnfläche 126 m² (inkl. Balkon)",
);

// ---------- 5. Control sample: Text-only property listing where OCR alone suffices (0 vision tokens) ----------
const LISTING_TEXT_ONLY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="820" viewBox="0 0 1000 820">
  <rect width="1000" height="820" fill="#ffffff"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#111111">
    <text x="64" y="88" font-size="36" font-weight="bold" fill="#1d4f3b">immolake · Objektdatenblatt</text>
    <text x="64" y="170" font-size="42" font-weight="bold">4.5 Zimmer Eigentumswohnung</text>
    <text x="64" y="224" font-size="28" fill="#444444">Römerstrasse 88, 8400 Winterthur</text>
    <text x="64" y="320" font-size="48" font-weight="bold">Kaufpreis CHF 860'000.–</text>
    <text x="64" y="410" font-size="30">Wohnfläche: 108 m²</text>
    <text x="64" y="464" font-size="30">Zimmer: 4.5 Zimmer</text>
    <text x="64" y="518" font-size="30">Etage: 2. Obergeschoss mit Lift</text>
    <text x="64" y="572" font-size="30">Baujahr: 2019 · Minergie-Standard</text>
    <text x="64" y="626" font-size="30">Verfügbar ab: 01.07.2027</text>
  </g>
</svg>`;

/** Helper to draw an SVG donut arc segment from startPct to endPct (0..100). */
function donutSlicePath(cx: number, cy: number, rOuter: number, rInner: number, startPct: number, endPct: number): string {
  const startAngle = (startPct / 100) * Math.PI * 2 - Math.PI / 2;
  const endAngle = (endPct / 100) * Math.PI * 2 - Math.PI / 2;
  const largeArc = endPct - startPct > 50 ? 1 : 0;
  const x1 = cx + rOuter * Math.cos(startAngle);
  const y1 = cy + rOuter * Math.sin(startAngle);
  const x2 = cx + rOuter * Math.cos(endAngle);
  const y2 = cy + rOuter * Math.sin(endAngle);
  const x3 = cx + rInner * Math.cos(endAngle);
  const y3 = cy + rInner * Math.sin(endAngle);
  const x4 = cx + rInner * Math.cos(startAngle);
  const y4 = cy + rInner * Math.sin(startAngle);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}

// ---------- 6. Donut allocation chart with a legend ONLY (no numbers/percentages printed) ----------
// Shares: Equities 65%, Bonds 20%, Real estate 10%, Cash 5% (Sum = 100%, Growth profile)
const CHART_DONUT_LEGEND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
  <rect width="960" height="640" fill="#ffffff"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#111111">
    <text x="60" y="64" font-size="30" font-weight="bold">Helvetia Vorsorge 3a · Anlageaufteilung</text>
    <text x="60" y="100" font-size="20" fill="#555555">Strategie Wachstum · Allokation nach Anlageklassen (ohne Wertbeschriftung)</text>
  </g>

  <!-- Donut slices: Equities 0..65, Bonds 65..85, Real Estate 85..95, Cash 95..100 -->
  <g stroke="#ffffff" stroke-width="4">
    <path d="${donutSlicePath(280, 355, 175, 92, 0, 65)}" fill="#2563eb"/>
    <path d="${donutSlicePath(280, 355, 175, 92, 65, 85)}" fill="#10b981"/>
    <path d="${donutSlicePath(280, 355, 175, 92, 85, 95)}" fill="#f59e0b"/>
    <path d="${donutSlicePath(280, 355, 175, 92, 95, 100)}" fill="#8b5cf6"/>
  </g>

  <!-- Legend with colour swatches ONLY (no printed percentages) -->
  <g font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#111111">
    <rect x="540" y="235" width="28" height="28" rx="6" fill="#2563eb"/>
    <text x="586" y="258" font-weight="bold">Aktien Schweiz &amp; Welt</text>

    <rect x="540" y="305" width="28" height="28" rx="6" fill="#10b981"/>
    <text x="586" y="328" font-weight="bold">Obligationen CHF</text>

    <rect x="540" y="375" width="28" height="28" rx="6" fill="#f59e0b"/>
    <text x="586" y="398" font-weight="bold">Immobilien Schweiz</text>

    <rect x="540" y="445" width="28" height="28" rx="6" fill="#8b5cf6"/>
    <text x="586" y="468" font-weight="bold">Liquidität / Cash</text>
  </g>
</svg>`;

// ---------- 7. Unlabeled portfolio line chart with a >= 10% peak-to-trough drawdown ----------
// Peak CHF 108'000 (2026-03) -> Trough CHF 88'500 (2026-06) = 18.1% drawdown; Endpoint CHF 96'500 (2026-11)
// Y-axis: 80'000 at y=490, 110'000 at y=190 (10px per CHF 1'000)
const CHART_LINE_DRAWDOWN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
  <rect width="960" height="640" fill="#ffffff"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#111111">
    <text x="60" y="62" font-size="30" font-weight="bold">AlpenBank · Depotentwicklung 2026</text>
    <text x="60" y="98" font-size="20" fill="#555555">Wertentwicklung Portfolio · Jan – Nov 2026</text>
    <text x="900" y="62" text-anchor="end" font-size="28" font-weight="bold">Depotwert CHF 96'500</text>
    <text x="900" y="96" text-anchor="end" font-size="18" fill="#555555">Stand 30.11.2026</text>
  </g>

  <!-- Y-axis gridlines and ticks (80k..110k) -->
  <g stroke="#e5e7eb" stroke-width="2">
    <line x1="150" y1="190" x2="890" y2="190"/>
    <line x1="150" y1="290" x2="890" y2="290"/>
    <line x1="150" y1="390" x2="890" y2="390"/>
    <line x1="150" y1="490" x2="890" y2="490"/>
  </g>
  <g font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#4b5563" text-anchor="end">
    <text x="135" y="196">110'000</text>
    <text x="135" y="296">100'000</text>
    <text x="135" y="396">90'000</text>
    <text x="135" y="496">80'000</text>
  </g>

  <!-- X-axis month labels -->
  <g font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#4b5563" text-anchor="middle">
    <text x="160" y="535">Jan</text>
    <text x="304" y="535">Mrz</text>
    <text x="448" y="535">Mai</text>
    <text x="592" y="535">Jul</text>
    <text x="736" y="535">Sep</text>
    <text x="880" y="535">Nov</text>
  </g>

  <!-- Unlabeled portfolio curve:
       Jan 98k (y=310), Feb 102k (y=270), Mar 108k (y=210), Apr 99.5k (y=295),
       May 91k (y=380), Jun 88.5k (y=405), Jul 90.5k (y=385), Aug 92k (y=370),
       Sep 93.5k (y=355), Oct 95k (y=340), Nov 96.5k (y=325) -->
  <polyline
    fill="none"
    stroke="#2563eb"
    stroke-width="6"
    stroke-linecap="round"
    stroke-linejoin="round"
    points="160,310 232,270 304,210 376,295 448,380 520,405 592,385 664,370 736,355 808,340 880,325"
  />
</svg>`;

// ---------- 8. Banking-app-style screenshot with BOTH donut (legend only) & unlabeled line chart ----------
// Total CHF 114'000; Allocation: Equities 70%, Bonds 18%, Real estate 7%, Cash 5%;
// Line series: Jan 116k -> Mar 125k (peak) -> Jun 106k (trough, -15.2% drawdown) -> Nov 114k (endpoint = printed total)
const CHART_APP_BOTH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="880" viewBox="0 0 960 880">
  <rect width="960" height="880" fill="#ffffff"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#111111">
    <text x="60" y="58" font-size="30" font-weight="bold">LemanInvest · Vermögensübersicht &amp; Performance</text>
    <text x="60" y="92" font-size="20" fill="#555555">Portfolio &amp; Allocation · Stand November 2026</text>
    <text x="900" y="58" text-anchor="end" font-size="30" font-weight="bold">Portfolio CHF 114'000</text>
    <text x="900" y="92" text-anchor="end" font-size="18" fill="#555555">Rendite YTD</text>
  </g>

  <!-- Top panel: Donut allocation with legend only (70% Equities, 18% Bonds, 7% Real estate, 5% Cash) -->
  <rect x="60" y="120" width="840" height="280" rx="16" fill="#fcfcfa" stroke="#e5e7eb" stroke-width="2"/>
  <g stroke="#ffffff" stroke-width="3">
    <path d="${donutSlicePath(240, 260, 108, 56, 0, 70)}" fill="#2563eb"/>
    <path d="${donutSlicePath(240, 260, 108, 56, 70, 88)}" fill="#10b981"/>
    <path d="${donutSlicePath(240, 260, 108, 56, 88, 95)}" fill="#f59e0b"/>
    <path d="${donutSlicePath(240, 260, 108, 56, 95, 100)}" fill="#8b5cf6"/>
  </g>
  <g font-family="Arial, Helvetica, sans-serif" font-size="21" fill="#111111">
    <text x="440" y="168" font-size="19" font-weight="bold" fill="#555555">Allokation (Legende)</text>
    <rect x="440" y="190" width="22" height="22" rx="5" fill="#2563eb"/>
    <text x="476" y="209" font-weight="bold">Aktien / Actions</text>

    <rect x="440" y="236" width="22" height="22" rx="5" fill="#10b981"/>
    <text x="476" y="255" font-weight="bold">Obligationen / Bonds</text>

    <rect x="440" y="282" width="22" height="22" rx="5" fill="#f59e0b"/>
    <text x="476" y="301" font-weight="bold">Immobilien</text>

    <rect x="440" y="328" width="22" height="22" rx="5" fill="#8b5cf6"/>
    <text x="476" y="347" font-weight="bold">Liquidität / Cash</text>
  </g>

  <!-- Bottom panel: Unlabeled portfolio line chart (95k..130k)
       y = 770 - (val - 95000) * 0.008  (so 95k -> 770, 110k -> 650, 125k -> 530) -->
  <rect x="60" y="430" width="840" height="395" rx="16" fill="#fcfcfa" stroke="#e5e7eb" stroke-width="2"/>
  <g stroke="#e5e7eb" stroke-width="2">
    <line x1="150" y1="530" x2="870" y2="530"/>
    <line x1="150" y1="650" x2="870" y2="650"/>
    <line x1="150" y1="770" x2="870" y2="770"/>
  </g>
  <g font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#4b5563" text-anchor="end">
    <text x="138" y="536">125'000</text>
    <text x="138" y="656">110'000</text>
    <text x="138" y="776">95'000</text>
  </g>
  <g font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#4b5563" text-anchor="middle">
    <text x="160" y="804">Jan</text>
    <text x="300" y="804">Mrz</text>
    <text x="440" y="804">Mai</text>
    <text x="580" y="804">Jun</text>
    <text x="720" y="804">Sep</text>
    <text x="860" y="804">Nov</text>
  </g>
  <polyline
    fill="none"
    stroke="#2563eb"
    stroke-width="6"
    stroke-linecap="round"
    stroke-linejoin="round"
    points="160,602 300,530 440,634 580,682 650,658 720,646 860,618"
  />
</svg>`;

async function main() {
  mkdirSync(OUT, { recursive: true });

  writeFileSync(`${OUT}/plan-cad-areas.svg`, PLAN_CAD_AREAS_SVG);
  writeFileSync(`${OUT}/plan-dimensions-only.svg`, PLAN_DIMENSIONS_ONLY_SVG);
  writeFileSync(`${OUT}/plan-35-halfroom.svg`, PLAN_35_HALFROOM_SVG);
  writeFileSync(`${OUT}/listing-text-only.svg`, LISTING_TEXT_ONLY_SVG);
  writeFileSync(`${OUT}/chart-donut-legend.svg`, CHART_DONUT_LEGEND_SVG);
  writeFileSync(`${OUT}/chart-line-drawdown.svg`, CHART_LINE_DRAWDOWN_SVG);
  writeFileSync(`${OUT}/chart-app-both.svg`, CHART_APP_BOTH_SVG);

  // Photographed / skewed print of the floor plan (with warm indoor lighting & rotation/skew)
  const warmBg = { r: 228, g: 221, b: 208, alpha: 1 };
  await sharp(Buffer.from(PLAN_SKEWED_SOURCE_SVG))
    .flatten({ background: "#ffffff" })
    .rotate(-3.4, { background: warmBg })
    .affine(
      [
        [1, 0.025],
        [-0.015, 1],
      ],
      { background: warmBg },
    )
    .resize({ width: 980 })
    .blur(0.35)
    .modulate({ brightness: 0.96 })
    .jpeg({ quality: 58, mozjpeg: true })
    .toFile(`${OUT}/plan-photo-skewed.jpg`);

  console.log("Generated floor-plan and chart vision samples in public/samples/vision/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
