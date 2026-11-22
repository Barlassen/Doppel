import { msg, type Msg } from "@/lib/i18n/types";

/**
 * Swiss floor-plan (Grundriss / plan d'étage) schema validation & deterministic TypeScript verification.
 *
 * The vision model ONLY reads room labels, printed areas (m²) or dimensions (width × length in m),
 * stated total living area, balcony/terrace area, stated room count, and optional listing price/location.
 *
 * All arithmetic runs deterministically in TypeScript:
 *   1. Room area from dimensions: widthM × lengthM (rounded to 0.1 m²).
 *   2. Interior living area sum vs stated living area (±10% tolerance, plus explicit check if stated area
 *      erroneously includes the balcony/terrace).
 *   3. Swiss room-count convention plausibility check:
 *      - living room, bedroom, office/study (≥ 6 m²) = 1.0 room
 *      - open dining area / half-room = 0.5 room
 *      - kitchen, bathroom/WC, hall/corridor/entrance, storage/reduit, balcony/terrace = 0 rooms
 *   4. Price per m² vs an embedded table of illustrative approximate regional median condo prices
 *      (Zürich, Geneva, Lausanne, Basel, Bern, Winterthur, St. Gallen, Lugano).
 */

export type RoomType =
  | "living"
  | "dining"
  | "bedroom"
  | "office"
  | "kitchen"
  | "bath"
  | "hall"
  | "storage"
  | "balcony";

export const ROOM_TYPES: readonly RoomType[] = [
  "living",
  "dining",
  "bedroom",
  "office",
  "kitchen",
  "bath",
  "hall",
  "storage",
  "balcony",
];

/** Tolerance for sum of interior rooms vs stated living area (±10%). */
export const LIVING_AREA_TOLERANCE = 0.1;

/**
 * Illustrative approximate regional median condo price levels (CHF / m²).
 * Explicitly marked in the UI and docs as illustrative approximate levels, with no invented precise sources.
 */
export interface RegionalPriceLevel {
  id: string;
  name: string;
  medianChfPerM2: number;
  aliases: RegExp;
}

export const ILLUSTRATIVE_REGIONAL_MEDIANS: readonly RegionalPriceLevel[] = [
  { id: "zurich", name: "Zürich", medianChfPerM2: 13_500, aliases: /\b(?:z[üu]rich|zh|80\d\d)\b/i },
  { id: "geneva", name: "Genève", medianChfPerM2: 12_800, aliases: /\b(?:gen[èe]ve|geneva|genf|ge|12\d\d)\b/i },
  { id: "lausanne", name: "Lausanne", medianChfPerM2: 10_200, aliases: /\b(?:lausanne|vd|100\d)\b/i },
  { id: "basel", name: "Basel", medianChfPerM2: 9_400, aliases: /\b(?:basel|b[âa]le|bs|40\d\d)\b/i },
  { id: "bern", name: "Bern", medianChfPerM2: 8_600, aliases: /\b(?:bern|berne|be|30\d\d)\b/i },
  { id: "winterthur", name: "Winterthur", medianChfPerM2: 7_900, aliases: /\b(?:winterthur|840\d)\b/i },
  { id: "lugano", name: "Lugano", medianChfPerM2: 7_600, aliases: /\b(?:lugano|ti|690\d)\b/i },
  { id: "stgallen", name: "St. Gallen", medianChfPerM2: 6_800, aliases: /\b(?:st\.?\s*gallen|sg|900\d)\b/i },
];

export interface FloorPlanRoomInput {
  name: string;
  type: RoomType;
  /** Printed room area in m², if shown on the plan. */
  areaM2?: number;
  /** Room width in metres, if dimensions like "4.20 × 5.10" are printed. */
  widthM?: number;
  /** Room length in metres, if dimensions like "4.20 × 5.10" are printed. */
  lengthM?: number;
}

export interface FloorPlanExtraction {
  rooms: FloorPlanRoomInput[];
  /** Total living area (Nettowohnfläche / surface habitable) printed on the plan/listing, if any. */
  statedLivingAreaM2?: number;
  /** Balcony / terrace area printed on the plan, if not already included as a "balcony" room entry. */
  balconyAreaM2?: number;
  /** Swiss room count printed on the plan/listing (e.g. 4.5, 3.5). */
  statedRooms?: number;
  /** Optional asking price (CHF) if printed on the same plan sheet. */
  priceChf?: number;
  /** Optional city/canton if printed on the same plan sheet. */
  location?: string;
  label?: string;
}

export interface VerifiedRoom {
  name: string;
  type: RoomType;
  printedAreaM2?: number;
  widthM?: number;
  lengthM?: number;
  /** Final area used in deterministic sums (computed from dimensions when present, else printed). */
  areaM2: number;
  fromDimensions: boolean;
  /** Contribution to the Swiss room count (1, 0.5, or 0). */
  roomUnits: number;
}

export interface RegionalComparison {
  region: string;
  medianChfPerM2: number;
  pricePerM2: number;
  /** Relative difference: (pricePerM2 - median) / median. Positive = above median. */
  deltaPct: number;
  deltaMsg: Msg;
}

export interface FloorPlanVerification {
  roomList: VerifiedRoom[];
  /** Sum of interior rooms (excludes balcony/terrace). */
  computedLivingAreaM2: number;
  statedLivingAreaM2?: number;
  /** Final living area fed into the twin and price/m² calculation. */
  livingAreaM2: number;
  balconyAreaM2: number;
  computedRooms: number;
  statedRooms?: number;
  /** Final room count fed into the twin. */
  rooms: number;
  priceChf?: number;
  location?: string;
  /** Rounded to nearest CHF 10/m² when priceChf and livingAreaM2 > 0 are available. */
  pricePerM2?: number;
  regional?: RegionalComparison;
  /** Main formatted headline, e.g. "4.5 rooms · 112 m² · CHF 8’390/m² · 6% above the Winterthur median". */
  headline: Msg;
  checks: Msg[];
  warnings: Msg[];
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function matchRegion(location?: string): RegionalPriceLevel | undefined {
  if (!location) return undefined;
  return ILLUSTRATIVE_REGIONAL_MEDIANS.find((r) => r.aliases.test(location));
}

/**
 * Swiss room-count convention for a single space:
 * - living, bedroom, office (if ≥ 6 m²) → 1.0
 * - dining (open dining area / half-room) → 0.5
 * - kitchen, bath, hall, storage, balcony → 0
 */
export function swissRoomUnits(type: RoomType, areaM2: number): number {
  if (type === "living" || type === "bedroom" || type === "office") {
    return areaM2 >= 6 ? 1 : areaM2 >= 3.5 ? 0.5 : 0;
  }
  if (type === "dining") return 0.5;
  return 0;
}

/**
 * Deterministic verification of a floor-plan extraction in TypeScript (0 tokens, no LLM math).
 */
export function verifyFloorPlan(ext: FloorPlanExtraction): FloorPlanVerification {
  const checks: Msg[] = [];
  const warnings: Msg[] = [];

  const roomList: VerifiedRoom[] = [];
  for (const r of ext.rooms) {
    const hasDims =
      typeof r.widthM === "number" &&
      typeof r.lengthM === "number" &&
      r.widthM > 0.4 &&
      r.lengthM > 0.4;
    const dimArea = hasDims ? round1(r.widthM! * r.lengthM!) : undefined;
    const printed = typeof r.areaM2 === "number" && r.areaM2 > 0 ? round1(r.areaM2) : undefined;

    if (dimArea !== undefined && printed !== undefined) {
      const diff = Math.abs(dimArea - printed) / Math.max(1, printed);
      if (diff > 0.06) {
        warnings.push(
          msg("vision.warnRoomDimArea", {
            room: r.name,
            computed: dimArea,
            printed,
          }),
        );
      }
    }

    const areaM2 = dimArea ?? printed ?? 0;
    const roomUnits = swissRoomUnits(r.type, areaM2);
    roomList.push({
      name: r.name,
      type: r.type,
      printedAreaM2: printed,
      widthM: r.widthM,
      lengthM: r.lengthM,
      areaM2,
      fromDimensions: dimArea !== undefined && printed === undefined,
      roomUnits,
    });
  }

  const interiorRooms = roomList.filter((r) => r.type !== "balcony");
  const balconyRooms = roomList.filter((r) => r.type === "balcony");

  const computedLivingAreaM2 = round1(interiorRooms.reduce((s, r) => s + r.areaM2, 0));
  const balconyFromRooms = round1(balconyRooms.reduce((s, r) => s + r.areaM2, 0));
  const balconyAreaM2 = balconyFromRooms > 0 ? balconyFromRooms : round1(ext.balconyAreaM2 ?? 0);

  const statedLivingAreaM2 =
    typeof ext.statedLivingAreaM2 === "number" && ext.statedLivingAreaM2 > 0
      ? round1(ext.statedLivingAreaM2)
      : undefined;

  // Verify interior room sum vs stated living area
  let livingAreaM2 = computedLivingAreaM2 > 0 ? computedLivingAreaM2 : (statedLivingAreaM2 ?? 0);
  if (statedLivingAreaM2 !== undefined && computedLivingAreaM2 > 0) {
    const diffRatio = Math.abs(computedLivingAreaM2 - statedLivingAreaM2) / statedLivingAreaM2;
    const withBalconyDiff =
      balconyAreaM2 > 0
        ? Math.abs(computedLivingAreaM2 + balconyAreaM2 - statedLivingAreaM2) / statedLivingAreaM2
        : 1;

    if (diffRatio <= LIVING_AREA_TOLERANCE) {
      checks.push(
        msg("vision.verifyAreaOk", {
          computed: computedLivingAreaM2,
          stated: statedLivingAreaM2,
          tol: LIVING_AREA_TOLERANCE,
        }),
      );
      livingAreaM2 = statedLivingAreaM2;
    } else if (balconyAreaM2 > 0 && withBalconyDiff <= 0.04) {
      warnings.push(
        msg("vision.warnAreaIncludesBalcony", {
          stated: statedLivingAreaM2,
          balcony: balconyAreaM2,
          computed: computedLivingAreaM2,
        }),
      );
      // Use true net interior living area when the stated number erroneously included the balcony
      livingAreaM2 = computedLivingAreaM2;
    } else {
      warnings.push(
        msg("vision.warnAreaMismatch", {
          computed: computedLivingAreaM2,
          stated: statedLivingAreaM2,
          diff: diffRatio,
          tol: LIVING_AREA_TOLERANCE,
        }),
      );
      livingAreaM2 = computedLivingAreaM2;
    }
  } else if (computedLivingAreaM2 > 0) {
    checks.push(msg("vision.verifyAreaFromDims", { computed: computedLivingAreaM2 }));
  }

  // Swiss room count convention plausibility check
  const computedRooms = round1(roomList.reduce((s, r) => s + r.roomUnits, 0));
  const statedRooms =
    typeof ext.statedRooms === "number" && ext.statedRooms >= 0.5 ? ext.statedRooms : undefined;
  const rooms = statedRooms ?? (computedRooms > 0 ? computedRooms : 3.5);

  if (computedRooms > 0) {
    if (statedRooms !== undefined && Math.abs(computedRooms - statedRooms) >= 0.5) {
      warnings.push(
        msg("vision.warnRoomCount", {
          computed: computedRooms,
          stated: statedRooms,
        }),
      );
    } else {
      checks.push(msg("vision.verifyRoomsOk", { computed: computedRooms }));
    }
  }

  // Price per m² & regional median comparison
  const priceChf = typeof ext.priceChf === "number" && ext.priceChf >= 50_000 ? ext.priceChf : undefined;
  const pricePerM2 =
    priceChf !== undefined && livingAreaM2 > 0
      ? Math.round(priceChf / livingAreaM2 / 10) * 10
      : undefined;

  let regional: RegionalComparison | undefined;
  const matchedRegion = matchRegion(ext.location);
  if (pricePerM2 !== undefined && matchedRegion) {
    const rawDelta = (pricePerM2 - matchedRegion.medianChfPerM2) / matchedRegion.medianChfPerM2;
    const roundedPct = Math.round(Math.abs(rawDelta) * 100) / 100;
    const deltaMsg =
      roundedPct < 0.005
        ? msg("vision.atMedian", { region: matchedRegion.name })
        : rawDelta > 0
          ? msg("vision.aboveMedian", { pct: roundedPct, region: matchedRegion.name })
          : msg("vision.belowMedian", { pct: roundedPct, region: matchedRegion.name });

    regional = {
      region: matchedRegion.name,
      medianChfPerM2: matchedRegion.medianChfPerM2,
      pricePerM2,
      deltaPct: rawDelta,
      deltaMsg,
    };
  }

  const headline: Msg =
    pricePerM2 !== undefined && regional
      ? msg("vision.planHeadline", {
          rooms,
          area: Math.round(livingAreaM2),
          pricePerM2,
          delta: regional.deltaMsg,
        })
      : pricePerM2 !== undefined
        ? msg("vision.planHeadlineNoBench", {
            rooms,
            area: Math.round(livingAreaM2),
            pricePerM2,
          })
        : msg("vision.planHeadlineAreaOnly", {
            rooms,
            area: Math.round(livingAreaM2),
          });

  return {
    roomList,
    computedLivingAreaM2,
    statedLivingAreaM2,
    livingAreaM2: Math.round(livingAreaM2 * 10) / 10,
    balconyAreaM2,
    computedRooms,
    statedRooms,
    rooms,
    priceChf,
    location: ext.location,
    pricePerM2,
    regional,
    headline,
    checks,
    warnings,
  };
}

/**
 * Re-run deterministic price/m² and room/area summary when the user edits fields in the review card
 * or when rendering inside AffordabilityCard with the current home price.
 */
export function reverifyFloorPlan(
  prev: FloorPlanVerification,
  overrides: { priceChf?: number; location?: string; rooms?: number; livingAreaM2?: number },
): FloorPlanVerification {
  const priceChf = overrides.priceChf ?? prev.priceChf;
  const location = overrides.location ?? prev.location;
  const rooms = overrides.rooms ?? prev.rooms;
  const livingAreaM2 = overrides.livingAreaM2 ?? prev.livingAreaM2;

  const pricePerM2 =
    priceChf !== undefined && priceChf > 0 && livingAreaM2 > 0
      ? Math.round(priceChf / livingAreaM2 / 10) * 10
      : undefined;

  let regional: RegionalComparison | undefined;
  const matchedRegion = matchRegion(location);
  if (pricePerM2 !== undefined && matchedRegion) {
    const rawDelta = (pricePerM2 - matchedRegion.medianChfPerM2) / matchedRegion.medianChfPerM2;
    const roundedPct = Math.round(Math.abs(rawDelta) * 100) / 100;
    const deltaMsg =
      roundedPct < 0.005
        ? msg("vision.atMedian", { region: matchedRegion.name })
        : rawDelta > 0
          ? msg("vision.aboveMedian", { pct: roundedPct, region: matchedRegion.name })
          : msg("vision.belowMedian", { pct: roundedPct, region: matchedRegion.name });

    regional = {
      region: matchedRegion.name,
      medianChfPerM2: matchedRegion.medianChfPerM2,
      pricePerM2,
      deltaPct: rawDelta,
      deltaMsg,
    };
  }

  const headline: Msg =
    pricePerM2 !== undefined && regional
      ? msg("vision.planHeadline", {
          rooms,
          area: Math.round(livingAreaM2),
          pricePerM2,
          delta: regional.deltaMsg,
        })
      : pricePerM2 !== undefined
        ? msg("vision.planHeadlineNoBench", {
            rooms,
            area: Math.round(livingAreaM2),
            pricePerM2,
          })
        : msg("vision.planHeadlineAreaOnly", {
            rooms,
            area: Math.round(livingAreaM2),
          });

  return {
    ...prev,
    priceChf,
    location,
    rooms,
    livingAreaM2,
    pricePerM2,
    regional,
    headline,
  };
}

// ---------------------------------------------------------------------------
// Strict JSON schema validation for vision model floor-plan output
// ---------------------------------------------------------------------------

const toNum = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/['’\s]/g, "").replace(/^(?:CHF|Fr\.?)/i, "").replace(/m[²2]$/i, "").replace(",", ".");
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

function normalizeRoomType(raw: unknown, name: string): RoomType {
  const s = `${typeof raw === "string" ? raw : ""} ${name}`.toLowerCase();
  if (/balkon|terrasse|loggia|balcon|patio/.test(s)) return "balcony";
  if (/k[üu]che|cuisine|kitchen/.test(s) && !/essen|coin\s+[àa]\s+manger|dining/.test(s)) return "kitchen";
  if (/essen|essbereich|coin\s+[àa]\s+manger|salle\s+[àa]\s+manger|dining|half/.test(s)) return "dining";
  if (/bad|dusche|du\/wc|wc|bain|bath/.test(s)) return "bath";
  if (/korridor|entr[ée]e|hall|flur|gang|d[ée]gagement/.test(s)) return "hall";
  if (/reduit|abstell|keller|storage|cellier/.test(s)) return "storage";
  if (/b[üu]ro|arbeitszimmer|office|studio/.test(s)) return "office";
  if (/wohnen|wohnzimmer|s[ée]jour|living|salon/.test(s)) return "living";
  if (/schlafen|eltern|chambre|zimmer|bedroom/.test(s)) return "bedroom";
  if (typeof raw === "string" && ROOM_TYPES.includes(raw as RoomType)) return raw as RoomType;
  return "bedroom";
}

export function validateFloorPlanExtraction(raw: unknown): FloorPlanExtraction | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.rooms)) return undefined;

  const rooms: FloorPlanRoomInput[] = [];
  for (const item of obj.rooms.slice(0, 20)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 48) : "Room";
    const type = normalizeRoomType(r.type, name);
    const areaM2 = toNum(r.areaM2 ?? r.area);
    let widthM = toNum(r.widthM ?? r.width);
    let lengthM = toNum(r.lengthM ?? r.length);

    if ((widthM === undefined || lengthM === undefined) && typeof r.dimensions === "string") {
      const m = r.dimensions.match(/(\d+(?:[.,]\d+)?)\s*[×x✕*]\s*(\d+(?:[.,]\d+)?)/);
      if (m) {
        widthM = Number(m[1].replace(",", "."));
        lengthM = Number(m[2].replace(",", "."));
      }
    }

    const validArea = areaM2 !== undefined && areaM2 >= 0.5 && areaM2 <= 500 ? areaM2 : undefined;
    const validW = widthM !== undefined && widthM >= 0.5 && widthM <= 50 ? widthM : undefined;
    const validL = lengthM !== undefined && lengthM >= 0.5 && lengthM <= 50 ? lengthM : undefined;
    if (validArea === undefined && (validW === undefined || validL === undefined)) continue;

    rooms.push({
      name,
      type,
      ...(validArea !== undefined ? { areaM2: validArea } : {}),
      ...(validW !== undefined && validL !== undefined ? { widthM: validW, lengthM: validL } : {}),
    });
  }

  if (rooms.length === 0) return undefined;

  const statedLivingAreaM2 = toNum(obj.statedLivingAreaM2 ?? obj.livingAreaM2 ?? obj.totalLivingArea);
  const balconyAreaM2 = toNum(obj.balconyAreaM2 ?? obj.balconyM2);
  const statedRooms = toNum(obj.statedRooms ?? obj.roomCount);
  const priceChf = toNum(obj.priceChf ?? obj.price ?? obj.amount);
  const location = typeof obj.location === "string" && obj.location.trim() ? obj.location.trim().slice(0, 60) : undefined;
  const label = typeof obj.label === "string" && obj.label.trim() ? obj.label.trim().slice(0, 60) : undefined;

  return {
    rooms,
    ...(statedLivingAreaM2 !== undefined && statedLivingAreaM2 >= 10 && statedLivingAreaM2 <= 2000
      ? { statedLivingAreaM2 }
      : {}),
    ...(balconyAreaM2 !== undefined && balconyAreaM2 >= 0 && balconyAreaM2 <= 500 ? { balconyAreaM2 } : {}),
    ...(statedRooms !== undefined && statedRooms >= 0.5 && statedRooms <= 30 ? { statedRooms } : {}),
    ...(priceChf !== undefined && priceChf >= 50_000 && priceChf <= 50_000_000 ? { priceChf } : {}),
    ...(location ? { location } : {}),
    ...(label ? { label } : {}),
  };
}

/**
 * Recorded offline fixture parser for demo floor-plan samples when no API key is set.
 * In the ledger, offline runs have `usage.mode = "offline"` and are excluded from savings.
 */
export function offlineFloorPlanFromOcr(ocrText: string): FloorPlanExtraction {
  const lower = ocrText.toLowerCase();
  if (/aareblick|3013\s+bern|5[.,]50\s*[×x]\s*4[.,]80/.test(lower)) {
    return {
      statedRooms: 4.5,
      priceChf: 845_000,
      location: "Bern",
      rooms: [
        { name: "Wohnen", type: "living", widthM: 5.5, lengthM: 4.8 },
        { name: "Essbereich (offen)", type: "dining", widthM: 3.2, lengthM: 2.5 },
        { name: "Schlafen 1", type: "bedroom", widthM: 4.2, lengthM: 3.8 },
        { name: "Schlafen 2", type: "bedroom", widthM: 3.8, lengthM: 3.2 },
        { name: "Arbeitszimmer", type: "office", widthM: 3.5, lengthM: 3.0 },
        { name: "Küche", type: "kitchen", widthM: 3.2, lengthM: 2.8 },
        { name: "Bad / WC", type: "bath", widthM: 2.8, lengthM: 2.2 },
        { name: "Korridor", type: "hall", widthM: 4.5, lengthM: 1.8 },
        { name: "Terrasse", type: "balcony", widthM: 4.8, lengthM: 2.5 },
      ],
    };
  }
  if (/beaulieu|1004\s+lausanne|cuisine\s+ouverte|s[ée]jour/.test(lower)) {
    return {
      statedRooms: 3.5,
      statedLivingAreaM2: 88,
      balconyAreaM2: 11,
      priceChf: 890_000,
      location: "Lausanne",
      rooms: [
        { name: "Séjour", type: "living", areaM2: 24.8, widthM: 5.15, lengthM: 4.82 },
        { name: "Cuisine ouverte / Coin à manger", type: "dining", areaM2: 16.5, widthM: 4.4, lengthM: 3.75 },
        { name: "Chambre 1", type: "bedroom", areaM2: 15.6, widthM: 4.1, lengthM: 3.8 },
        { name: "Chambre 2", type: "bedroom", areaM2: 12.4, widthM: 3.65, lengthM: 3.4 },
        { name: "Salle de bain", type: "bath", areaM2: 6.2, widthM: 2.6, lengthM: 2.38 },
        { name: "Hall / Entrée", type: "hall", areaM2: 7.5, widthM: 3.75, lengthM: 2.0 },
        { name: "Loggia / Balcon", type: "balcony", areaM2: 11.0, widthM: 4.4, lengthM: 2.5 },
      ],
    };
  }
  if (/126\s*m[²2]|inkl\.\s*balkon|sonnenberg/.test(lower)) {
    return {
      statedRooms: 4.5,
      statedLivingAreaM2: 126,
      balconyAreaM2: 14,
      priceChf: 940_000,
      location: "Winterthur",
      rooms: [
        { name: "Wohnen", type: "living", areaM2: 26.0, widthM: 5.2, lengthM: 5.0 },
        { name: "Essbereich (offen)", type: "dining", areaM2: 10.4, widthM: 3.25, lengthM: 3.2 },
        { name: "Eltern", type: "bedroom", areaM2: 17.6, widthM: 4.4, lengthM: 4.0 },
        { name: "Zimmer 2", type: "bedroom", areaM2: 14.4, widthM: 4.0, lengthM: 3.6 },
        { name: "Zimmer 3 / Büro", type: "office", areaM2: 12.6, widthM: 3.6, lengthM: 3.5 },
        { name: "Küche", type: "kitchen", areaM2: 10.8, widthM: 3.6, lengthM: 3.0 },
        { name: "Bad / WC", type: "bath", areaM2: 7.2, widthM: 3.0, lengthM: 2.4 },
        { name: "DU / WC", type: "bath", areaM2: 4.2, widthM: 2.1, lengthM: 2.0 },
        { name: "Entrée / Korridor", type: "hall", areaM2: 8.8, widthM: 4.4, lengthM: 2.0 },
        { name: "Balkon", type: "balcony", areaM2: 14.0, widthM: 5.0, lengthM: 2.8 },
      ],
    };
  }
  // Default: Eulachpark Winterthur 4.5-room CAD floor plan (112 m², CHF 940'000)
  return {
    statedRooms: 4.5,
    statedLivingAreaM2: 112,
    balconyAreaM2: 14,
    priceChf: 940_000,
    location: "Winterthur",
    rooms: [
      { name: "Wohnen", type: "living", areaM2: 26.0, widthM: 5.2, lengthM: 5.0 },
      { name: "Essbereich (offen)", type: "dining", areaM2: 10.4, widthM: 3.25, lengthM: 3.2 },
      { name: "Eltern", type: "bedroom", areaM2: 17.6, widthM: 4.4, lengthM: 4.0 },
      { name: "Zimmer 2", type: "bedroom", areaM2: 14.4, widthM: 4.0, lengthM: 3.6 },
      { name: "Zimmer 3 / Büro", type: "office", areaM2: 12.6, widthM: 3.6, lengthM: 3.5 },
      { name: "Küche", type: "kitchen", areaM2: 10.8, widthM: 3.6, lengthM: 3.0 },
      { name: "Bad / WC", type: "bath", areaM2: 7.2, widthM: 3.0, lengthM: 2.4 },
      { name: "DU / WC", type: "bath", areaM2: 4.2, widthM: 2.1, lengthM: 2.0 },
      { name: "Entrée / Korridor", type: "hall", areaM2: 8.8, widthM: 4.4, lengthM: 2.0 },
      { name: "Balkon", type: "balcony", areaM2: 14.0, widthM: 5.0, lengthM: 2.8 },
    ],
  };
}

/** Name-only equivalence: preserve digits and words, ignore typography and accents. */
export function normalizeRoomName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
/** One-to-one matching; never loosen area tolerance or merge distinct numbered rooms. */
export function countMatchedRooms(truth: Record<string, number>, rooms: {name:string;areaM2:number}[]): number {
  const used = new Set<number>();
  let count = 0;
  for (const [name, area] of Object.entries(truth)) {
    const i = rooms.findIndex((r,i) => !used.has(i) && normalizeRoomName(r.name) === normalizeRoomName(name) && Math.abs(r.areaM2-area)<=0.25);
    if(i>=0){used.add(i);count++;}
  }
  return count;
}
