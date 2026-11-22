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

const pp = (x: number) => Math.round(x * 1000) / 10;

/** The plain-language review: 1–4 sentences templated from the engine's numbers. */
export function explain(i: T, a: Analysis, r: MoveReview): string[] {
  const { t, fmt } = i;
  const mine = a.candidates.find((c) => c.card === r.card) ?? a.hold;
  const best = a.candidates[0];
  const out: string[] = [];
  const move = cardTitle(i, r.card);
  if (mine.lifeChoice) {
    out.push(t("play.review.explainLifeChoice", { best: cardTitle(i, best.card), dGoal: fmt.signed(pp(mine.parts.pGoal - best.parts.pGoal)), median: mine.parts.median }));
  } else if (r.card === best.card) {
    out.push(t("play.review.explainBest", { move, goal: mine.parts.pGoal, crunch: mine.parts.pCrunch, age: a.horizonAge }));
  } else {
    out.push(
      t("play.review.explainLoss", {
        best: cardTitle(i, best.card),
        loss: r.loss,
        dGoal: fmt.signed(pp(mine.parts.pGoal - best.parts.pGoal)),
        dCrunch: fmt.signed(pp(mine.parts.pCrunch - best.parts.pCrunch)),
        age: a.horizonAge,
        median: mine.parts.median,
        bestMedian: best.parts.median,
      }),
    );
  }
  if (mine.sacrifice) out.push(t("play.review.explainSacrifice", { short: (a.hold.e1 - mine.e1) * 100, long: (mine.e - a.hold.e) * 100, age: a.horizonAge }));
  if (mine.drain) out.push(t("play.review.explainDrain", { age: a.horizonAge }));
  if (mine.mateShare > 0.005) out.push(t("play.review.explainMate", { p: mine.mateShare }));
  const top = biggestChannel(mine);
  if (top) out.push(t("play.review.explainChannel", { channel: t(`play.channel.${top.channel}` as MessageKey), amount: top.value }));
  return out;
}

export function biggestChannel(c: CandidateEval) {
  const money = c.donut.filter((s) => s.channel !== "goal" && Math.abs(s.value) >= 50);
  if (!money.length || c.card === "hold") return null;
  return money.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
}
