/**
 * Output caps for the vision tasks. A 10-room plan as pretty-printed JSON needs ~600 tokens; the live
 * benchmark showed 320 truncating every plan (finish_reason "length"). The prompts also ask for minified JSON.
 */
export const VISION_PLAN_OUTPUT_TOKENS = 900;
export const VISION_CHART_OUTPUT_TOKENS = 700;
