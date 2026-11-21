export type DocKind = "listing" | "receipt" | "bill" | "payslip" | "note" | "other";

/** Structured result of any tier. Small on purpose: this is all the twin needs. */
export interface Extraction {
  kind: DocKind;
  /** Listing: price. Receipt/bill: total. Payslip: net pay. Note: target amount. */
  amount?: number;
  merchant?: string;
  date?: string;
  location?: string;
  rooms?: number;
  category?: string;
  label?: string;
  year?: number;
  iban?: string;
  message?: string;
}

export type Tier = 0 | 1 | 2;

export interface PipelineStep {
  name: string;
  ms: number;
  detail?: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: string;
  /** "llm" = real OpenRouter call; "local" = no LLM; "offline" = API key missing, local heuristics used. */
  mode: "llm" | "local" | "offline";
}

export interface SnapResult {
  tier: Tier;
  extraction: Extraction;
  steps: PipelineStep[];
  usage: Usage;
  /** What actually left the browser (image data truncated for display). */
  payload: unknown;
  ocrConfidence?: number;
  imageSize: { width: number; height: number };
  preview?: string;
}
