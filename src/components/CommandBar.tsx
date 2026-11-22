"use client";

import { useEffect, useId, useRef, useState } from "react";

import { commandExamples } from "@/lib/i18n/examples";
import { SPEECH_LANGS, msg, type Msg } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/I18nProvider";

const MAX_COMMAND_LENGTH = 300;
/** Example chips shown before "More examples". */
const VISIBLE_EXAMPLES = 3;
interface SpeechRec {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
}

function speechRecognition() {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function CommandBar({ onSubmit, busy, message, hasHome = true }: {
  onSubmit: (t: string) => void;
  busy: boolean;
  message?: Msg;
  /** False while no home purchase is on the timeline: the "delay the flat" example cannot apply and is left out. */
  hasHome?: boolean;
}) {
  const { locale, t, tm } = useI18n();
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const [speechMessage, setSpeechMessage] = useState<Msg>();
  const [allExamples, setAllExamples] = useState(false);
  const examplesId = useId();
  const rec = useRef<SpeechRec | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCanListen(!!speechRecognition());
    return () => {
      const active = rec.current;
      if (!active) return;
      active.onresult = null;
      active.onerror = null;
      active.onend = null;
      active.stop();
    };
  }, []);

  function listen() {
    const Recognition = speechRecognition();
    if (!Recognition || busy) return;
    if (rec.current) {
      rec.current.stop();
      return;
    }
    setSpeechMessage(undefined);
    const active = new Recognition();
    active.lang = SPEECH_LANGS[locale];
    active.interimResults = false;
    active.onresult = (e) => {
      if (rec.current !== active) return;
      const transcript = e.results[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      setText(transcript.slice(0, MAX_COMMAND_LENGTH));
      setSpeechMessage(msg("speech.review"));
      input.current?.focus();
    };
    active.onend = () => {
      if (rec.current !== active) return;
      rec.current = null;
      setListening(false);
    };
    active.onerror = ({ error }) => {
      if (rec.current !== active) return;
      rec.current = null;
      setListening(false);
      if (error === "not-allowed" || error === "service-not-allowed") {
        setSpeechMessage(msg("speech.denied"));
      } else if (error === "no-speech") {
        setSpeechMessage(msg("speech.noSpeech"));
      } else if (error !== "aborted") {
        setSpeechMessage(msg("speech.unavailable"));
      }
    };
    try {
      rec.current = active;
      active.start();
      setListening(true);
    } catch {
      rec.current = null;
      setSpeechMessage(msg("speech.cantStart"));
    }
  }

  function submit(value: string) {
    if (!value.trim() || busy || rec.current) return;
    setSpeechMessage(undefined);
    onSubmit(value.trim());
  }

  return (
    <div className="min-w-0">
      <form className="card flex min-w-0 items-center gap-1.5 p-1.5 pl-2.5 sm:gap-2 sm:pl-4"
        onSubmit={(e) => { e.preventDefault(); submit(text); }}>
        <span aria-hidden="true" className="hidden text-ink-3 sm:inline">↳</span>
        <input
          ref={input}
          aria-label={t("cmd.inputAria")}
          value={text}
          maxLength={MAX_COMMAND_LENGTH}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("cmd.placeholder")}
          className="w-0 min-w-0 flex-1 rounded-sm bg-transparent py-2 text-[15px] placeholder:text-ink-3"
        />
        {canListen && (
          <button
            type="button"
            onClick={listen}
            disabled={busy}
            aria-label={t(listening ? "cmd.stopDictation" : "cmd.dictate")}
            aria-pressed={listening}
            title={t("cmd.speechTitle")}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line transition ${listening ? "pulse-soft border-accent text-accent" : "text-ink-2 hover:text-ink"}`}
          >
            <span aria-hidden="true">🎙</span>
          </button>
        )}
        <button
          type="submit"
          disabled={busy || listening || !text.trim()}
          className="shrink-0 rounded-full bg-ink px-3 py-2 text-sm font-medium text-bg transition hover:opacity-90 disabled:opacity-50 sm:px-4"
        >
          {t(busy ? "cmd.simulating" : "cmd.simulate")}
        </button>
      </form>
      <div id={examplesId} className="mt-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("cmd.examplesAria")}>
        {commandExamples(locale).filter(({ id }) => hasHome || id !== "delay").slice(0, allExamples ? undefined : VISIBLE_EXAMPLES).map(({ id, text: example }) => (
          <button
            type="button"
            key={id}
            disabled={busy || listening}
            onClick={() => {
              setText(example);
              submit(example);
            }}
            className="max-w-full rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 transition enabled:hover:border-ink-3 enabled:hover:text-ink disabled:opacity-50"
          >
            {example}
          </button>
        ))}
        <button
          type="button"
          aria-expanded={allExamples}
          aria-controls={examplesId}
          onClick={() => setAllExamples((v) => !v)}
          className="rounded-full px-2 py-1 text-xs font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
        >
          {t(allExamples ? "cmd.fewerExamples" : "cmd.moreExamples")}
        </button>
      </div>
      <div role="status" className="text-xs text-ink-2">
        {(speechMessage || message) && <p className="mt-2">{tm(speechMessage ?? message)}</p>}
      </div>
    </div>
  );
}
