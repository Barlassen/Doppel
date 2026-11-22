"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Msg } from "@/lib/i18n/types";
import { ASK_QUESTION_LIMIT, statusMsg, type TwinStatus } from "@/lib/llm";
import { CardHeader } from "./ui";

/** What the card shows after a question or "Explain my situation". */
export interface AssistantReply {
  /** The question asked, or undefined for the situation summary. */
  question?: string;
  text?: string;
  error?: Msg;
  /** Who worded `text`: a model, or the built-in offline template. */
  source?: { model: string } | "template";
  /** Tokens and cost as the ledger recorded them, and how the figures were obtained when not provider-reported. */
  usage?: { tokens: number; costUsd: number; basis?: Msg };
}

/**
 * "Ask your twin": whether an assistant is connected, a question box whose answer may only quote the engine's
 * figures, and the one-click situation summary. The numbers never come from the model; offline the summary is the
 * local template and the question box says the assistant is not connected.
 */
export function AskCard({
  status,
  busy,
  reply,
  onAsk,
  onExplain,
}: {
  /** "checking" until the gateway answered; undefined when it cannot be reached. */
  status: TwinStatus | undefined | "checking";
  busy: boolean;
  reply: AssistantReply | null;
  onAsk: (question: string) => void;
  onExplain: () => void;
}) {
  const { t, tm, fmt } = useI18n();
  const [question, setQuestion] = useState("");
  const connected = status !== "checking" && !!status?.configured && !!status.textModel;
  const state = status === "checking" ? "checking" : connected ? "on" : "off";
  return (
    <section id="assistant" className="card scroll-mt-36 p-5 sm:p-6" data-testid="ask-card">
      <CardHeader
        title={t("llm.askLabel")}
        aside={
          <span className="flex items-center gap-1.5 text-[11px] text-ink-2" data-testid="assistant-state" data-state={state}
            title={status === "checking" ? t("llm.checking") : tm(statusMsg(status))}>
            <span aria-hidden="true" className={`inline-block size-2 rounded-full ${state === "on" ? "bg-good" : state === "off" ? "bg-ink-3" : "pulse-soft bg-warn"}`} />
            {t(`ux.ask.${state}`)}
          </span>
        }
      />
      <form className="flex min-w-0 items-center gap-1.5" onSubmit={(e) => {
        e.preventDefault();
        if (!connected || busy || !question.trim()) return;
        onAsk(question.trim());
      }}>
        <input
          aria-label={t("llm.askLabel")}
          className="w-0 min-w-0 flex-1 rounded-full border border-line bg-surface px-3 py-2 text-sm placeholder:text-ink-3 disabled:opacity-60"
          placeholder={t("ux.ask.placeholder")}
          maxLength={ASK_QUESTION_LIMIT}
          value={question}
          disabled={!connected}
          onChange={(e) => setQuestion(e.currentTarget.value)}
        />
        <button type="submit" disabled={!connected || busy || !question.trim()} className="shrink-0 rounded-full bg-ink px-3.5 py-2 text-sm font-medium text-bg disabled:opacity-50">
          {t("llm.askSend")}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onExplain} disabled={busy} className="rounded-full border border-line px-3 py-1 text-xs font-medium transition hover:border-ink-3 disabled:opacity-50">
          {t(reply && !reply.question ? "banker.refresh" : "banker.explain")}
        </button>
        {state === "off" && <span className="min-w-0 text-xs text-ink-2" data-testid="assistant-offline">{tm(statusMsg(status === "checking" ? undefined : status))}</span>}
      </div>

      <div role="status" className="mt-3" data-testid="assistant-reply">
        {busy && <p className="pulse-soft text-sm text-ink-2">{t("banker.loading")}</p>}
        {!busy && reply?.error && <p className="text-sm text-warn">{tm(reply.error)}</p>}
        {!busy && reply?.text !== undefined && (
          <>
            {reply.question && <p className="mb-1 text-xs text-ink-2">{reply.question}</p>}
            <p className="font-serif text-lg leading-snug sm:text-xl">{t("common.quote", { text: reply.text })}</p>
            <p className="num mt-2 text-xs text-ink-2" data-testid="banker-source">
              {reply.source === "template" ? t("ux.bankerTemplate") : reply.source ? t("ux.bankerModel", { model: reply.source.model }) : ""}
              {reply.usage && <> · {t("common.tokens", { count: reply.usage.tokens })} · {fmt.usd(reply.usage.costUsd)}</>}
              {reply.usage?.basis && <> · {tm(reply.usage.basis)}</>}
            </p>
          </>
        )}
        {!busy && !reply && connected && <p className="text-xs text-ink-2">{t("ux.ask.note")}</p>}
      </div>
    </section>
  );
}
