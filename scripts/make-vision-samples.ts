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

async function main() {
  mkdirSync(OUT, { recursive: true });

  writeFileSync(`${OUT}/plan-cad-areas.svg`, PLAN_CAD_AREAS_SVG);
  writeFileSync(`${OUT}/plan-dimensions-only.svg`, PLAN_DIMENSIONS_ONLY_SVG);
  writeFileSync(`${OUT}/plan-35-halfroom.svg`, PLAN_35_HALFROOM_SVG);
  writeFileSync(`${OUT}/listing-text-only.svg`, LISTING_TEXT_ONLY_SVG);

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

  console.log("Generated floor-plan vision samples in public/samples/vision/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
