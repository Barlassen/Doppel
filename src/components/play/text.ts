/** Text helpers for Doppel Play: every sentence is a template filled with engine numbers (no model). */
import type { I18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/types";
import { type CardParam, paramMap } from "@/lib/game/cards";
import type { Analysis, CandidateEval, MoveReview } from "@/lib/game/engine";
import type { MoveLabel } from "@/lib/game/evaluate";

type T = Pick<I18n, "t" | "fmt">;

export const cardTitle = ({ t }: T, id: string) => t(`play.cards.${id}.title` as MessageKey);
export const cardDesc = ({ t }: T, id: string, params: CardParam[]) => t(`play.cards.${id}.desc` as MessageKey, paramMap(params));
export const paramLabel = ({ t }: T, key: string) => t(`play.param.${key}` as MessageKey);

export function paramValue({ t, fmt }: T, p: CardParam): string {
  switch (p.unit) {
    case "chf":
      return fmt.chf(p.value);
    case "chfMonth":
      return t("play.unit.month", { amount: p.value });
    case "chfYear":
      return t("play.unit.year", { amount: p.value });
    case "pct":
      return fmt.pct(p.value, Math.abs(p.value * 100 - Math.round(p.value * 100)) > 0.05 ? 1 : 0);
    case "months":
      return t("play.unit.months", { count: p.value });
    case "years":
      return t("play.unit.years", { count: p.value });
    case "daysWeek":
      return t("play.unit.daysWeek", { count: p.value });
    case "age":
      return t("play.position.age", { age: p.value });
  }
}

/** Colour role of a move label (status colours always come with the glyph and the label text). */
export const LABEL_TONE: Record<MoveLabel, string> = {
  brilliant: "text-good",
  best: "text-good",
  good: "text-ink",
  inaccuracy: "text-warn",
  mistake: "text-warn",
  blunder: "text-bad",
  lifeChoice: "text-s1",
};


/** The plain-language review: 1–4 sentences templated from the engine's numbers. */
export function explain(i: T, a: Analysis, r: MoveReview): string[] {
  const { t } = i;
  const mine = a.candidates.find((c) => c.card === r.card) ?? a.hold;
  const best = a.candidates[0];
  const out: string[] = [];
  const move = cardTitle(i, r.card);
  if (mine.lifeChoice) {
    out.push(t("play.explain.lifeChoice", { best: cardTitle(i, best.card), loss: r.loss }));
  } else if (r.label === "lifeChoice") {
    // An undeclared life decision that costs no points: shown with its numbers, never named the best move.
    out.push(t("play.explain.lifeDecision", { best: cardTitle(i, best.card), gain: Math.max(0, (mine.e - best.e) * 100) }));
  } else if (r.card === best.card) {
    out.push(t("play.explain.best", { move, goal: mine.parts.pGoal, crunch: mine.parts.pCrunch, age: a.horizonAge, median: mine.parts.median }));
  } else {
    out.push(t("play.explain.loss", { best: cardTitle(i, best.card), move, loss: r.loss, median: mine.parts.median, bestMedian: best.parts.median, age: a.horizonAge }));
  }
  if (mine.sacrifice) out.push(t("play.review.explainSacrifice", { short: (a.hold.e1 - mine.e1) * 100, long: (mine.e - a.hold.e) * 100, age: a.horizonAge }));
  if (mine.drain) out.push(t("play.review.explainDrain", { age: a.horizonAge }));
  if (mine.mateShare > 0.005) out.push(t("play.review.explainMate", { p: mine.mateShare }));
  const top = biggestChannel(mine);
  if (top) out.push(t("play.explain.channel", { channel: t(`play.channel.${top.channel}` as MessageKey), amount: top.value }));
  return out;
}

export function biggestChannel(c: CandidateEval) {
  const money = c.donut.filter((s) => s.channel !== "goal" && Math.abs(s.value) >= 50);
  if (!money.length || c.card === "hold") return null;
  return money.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
}
