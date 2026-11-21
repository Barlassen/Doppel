"use client";

import { useEffect, useRef, useState } from "react";

const EXAMPLES = [
  "What if I lose my job for 6 months in 2028?",
  "Delay the flat by 2 years",
  "Market crash next year",
  "We have a baby in 2028",
];

interface SpeechRec {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: { 0: { transcript: string } }[] }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
}

export function CommandBar({ onSubmit, busy, message }: { onSubmit: (t: string) => void; busy: boolean; message?: string }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const rec = useRef<SpeechRec | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    setCanListen(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  function listen() {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (e) => {
      const t = e.results[0][0].transcript;
      setText(t);
      onSubmit(t);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  }

  function submit() {
    if (!text.trim() || busy) return;
    onSubmit(text.trim());
  }

  return (
    <div>
      <div className="card flex items-center gap-2 p-1.5 pl-4">
        <span className="text-ink-3">↳</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Ask your twin a what-if…"
          className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-ink-3"
        />
        {canListen && (
          <button
            onClick={listen}
            title="Speak (on-device speech recognition, no cloud cost)"
            className={`grid h-9 w-9 place-items-center rounded-full border border-line transition ${listening ? "pulse-soft border-accent text-accent" : "text-ink-2 hover:text-ink"}`}
          >
            🎙
          </button>
        )}
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "…" : "Simulate"}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            onClick={() => {
              setText(e);
              onSubmit(e);
            }}
            className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 transition hover:border-ink-3 hover:text-ink"
          >
            {e}
          </button>
        ))}
      </div>
      {message && <p className="mt-2 text-xs text-ink-2">{message}</p>}
    </div>
  );
}
