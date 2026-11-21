"use client";

import { useEffect, useRef, useState } from "react";

const MAX_COMMAND_LENGTH = 300;
const EXAMPLES = [
  "What if I lose my job for 6 months in 2028?",
  "Delay the flat by 2 years",
  "Market crash next year",
  "We have a baby in 2028",
  "Retire at 60",
  "Invest 500 a month",
];

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

export function CommandBar({ onSubmit, busy, message }: { onSubmit: (t: string) => void; busy: boolean; message?: string }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const [speechMessage, setSpeechMessage] = useState("");
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
    setSpeechMessage("");
    const active = new Recognition();
    active.lang = "en-US";
    active.interimResults = false;
    active.onresult = (e) => {
      if (rec.current !== active) return;
      const transcript = e.results[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      setText(transcript.slice(0, MAX_COMMAND_LENGTH));
      setSpeechMessage("Review the transcript, then select Simulate.");
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
        setSpeechMessage("Microphone access is unavailable. Type your what-if instead.");
      } else if (error === "no-speech") {
        setSpeechMessage("No speech detected. Try again or type your what-if.");
      } else if (error !== "aborted") {
        setSpeechMessage("Browser speech recognition is unavailable. Type your what-if instead.");
      }
    };
    try {
      rec.current = active;
      active.start();
      setListening(true);
    } catch {
      rec.current = null;
      setSpeechMessage("Browser speech recognition could not start. Type your what-if instead.");
    }
  }

  function submit(value: string) {
    if (!value.trim() || busy || rec.current) return;
    setSpeechMessage("");
    onSubmit(value.trim());
  }

  return (
    <div className="min-w-0">
      <form className="card flex min-w-0 items-center gap-1.5 p-1.5 pl-2.5 sm:gap-2 sm:pl-4"
        onSubmit={(e) => { e.preventDefault(); submit(text); }}>
        <span aria-hidden="true" className="hidden text-ink-3 sm:inline">↳</span>
        <input
          ref={input}
          aria-label="What-if for your twin"
          value={text}
          maxLength={MAX_COMMAND_LENGTH}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask your twin a what-if…"
          className="w-0 min-w-0 flex-1 rounded-sm bg-transparent py-2 text-[15px] placeholder:text-ink-3"
        />
        {canListen && (
          <button
            type="button"
            onClick={listen}
            disabled={busy}
            aria-label={listening ? "Stop speech recognition" : "Dictate your what-if"}
            aria-pressed={listening}
            title="Browser speech recognition"
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
          {busy ? "Simulating…" : "Simulate"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((example) => (
          <button
            type="button"
            key={example}
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
      </div>
      <div role="status" className="text-xs text-ink-2">
        {(speechMessage || message) && <p className="mt-2">{speechMessage || message}</p>}
      </div>
    </div>
  );
}
