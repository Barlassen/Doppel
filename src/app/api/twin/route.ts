import { NextResponse } from "next/server";

/**
 * Single LLM gateway. Three narrow jobs, tiny prompts, small output caps:
 *   extract_text  – compressed OCR text → JSON (Tier 1)
 *   extract_image – 512px grayscale JPEG → JSON (Tier 2, only on low OCR confidence)
 *   command       – what-if sentence → JSON ops for the deterministic simulator
 *   narrate       – exact numbers from the engine → 2–3 sentence explanation
 * The LLM never does financial maths.
 */

const TEXT_MODEL = process.env.DOPPEL_TEXT_MODEL ?? "google/gemini-2.5-flash-lite";
const VISION_MODEL = process.env.DOPPEL_VISION_MODEL ?? "google/gemini-2.5-flash-lite";

const EXTRACT_SYS =
  'Swiss finance doc → JSON. Keys: kind(listing|receipt|bill|payslip|note|other), amount(CHF number: listing price, receipt total, net pay, or note target), merchant, date(YYYY-MM-DD), location(town), rooms, category(groceries|dining|transport|shopping|bills|insurance|travel|other), label(≤5 words), year. Omit unknown keys.';

const COMMAND_SYS =
  'Turn the what-if into JSON {"ops":[...]}. Ops: {"op":"add","type":"house|child|jobloss|crash|raise|expense|income","label","month","amount","duration"} | {"op":"shift","id","months"} | {"op":"remove","id"}. month=months from now. amount CHF (house=price, child=monthly cost≈1500, raise=yearly gross, crash=0). duration in months (jobloss, child). Use ids from Events.';

const NARRATE_SYS =
  "You are the client's Swiss private banker. Using ONLY the given numbers, write ≤3 short sentences: verdict, main reason, one concrete next step. No new numbers, no disclaimers.";

type Task =
  | { task: "extract_text"; text: string }
  | { task: "extract_image"; image: string }
  | { task: "command"; text: string; now: string; events: string }
  | { task: "narrate"; facts: Record<string, unknown> };

export async function POST(req: Request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ ok: false, offline: true });

  const body = (await req.json()) as Task;
  let model = TEXT_MODEL;
  let maxTokens = 120;
  let messages: unknown[];

  switch (body.task) {
    case "extract_text":
      messages = [
        { role: "system", content: EXTRACT_SYS },
        { role: "user", content: body.text.slice(0, 800) },
      ];
      break;
    case "extract_image":
      model = VISION_MODEL;
      messages = [
        { role: "system", content: EXTRACT_SYS },
        { role: "user", content: [{ type: "image_url", image_url: { url: body.image } }] },
      ];
      break;
    case "command":
      maxTokens = 150;
      messages = [
        { role: "system", content: COMMAND_SYS },
        { role: "user", content: `Now: ${body.now}. Events: ${body.events || "none"}.\n${body.text.slice(0, 300)}` },
      ];
      break;
    case "narrate":
      maxTokens = 160;
      messages = [
        { role: "system", content: NARRATE_SYS },
        { role: "user", content: JSON.stringify(body.facts) },
      ];
      break;
    default:
      return NextResponse.json({ ok: false, error: "unknown task" }, { status: 400 });
  }

  const json = body.task !== "narrate";
  const request = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0,
    ...(json ? { response_format: { type: "json_object" } } : {}),
    usage: { include: true },
  };

  const t0 = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "Doppel",
    },
    body: JSON.stringify(request),
  });
  const ms = Date.now() - t0;

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}` }, { status: 502 });
  }
  const out = await res.json();
  const content: string = out.choices?.[0]?.message?.content ?? "";
  let data: unknown = content;
  if (json) {
    try {
      data = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      return NextResponse.json({ ok: false, error: "model returned invalid JSON", raw: content }, { status: 502 });
    }
  }

  return NextResponse.json({
    ok: true,
    data,
    ms,
    usage: {
      promptTokens: out.usage?.prompt_tokens ?? 0,
      completionTokens: out.usage?.completion_tokens ?? 0,
      costUsd: out.usage?.cost ?? 0,
      model: out.model ?? model,
    },
    request: redact(request),
  });
}

/** Shorten base64 images so the inspector can display the payload. */
function redact(r: Record<string, unknown>) {
  return JSON.parse(
    JSON.stringify(r).replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, (m) => `${m.slice(0, 40)}…(${Math.round(m.length * 0.75 / 1024)} KB)`),
  );
}
