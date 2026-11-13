import { useEffect, useRef, useState } from "react";

/**
 * LiveSTT — fast, real-time speech-to-text with two engines:
 *
 *  1. Browser (Web Speech API): zero setup, words appear as you speak.
 *     Chrome / Edge / Safari. Audio goes to the browser vendor's servers.
 *
 *  2. Deepgram (Nova-3, WebSocket streaming): the most accurate option here.
 *     Needs a Deepgram API key (free credit on signup).
 *     NOTE: pasting a key in the browser is fine for testing. In production,
 *     have your backend mint a short-lived token instead and never ship the key.
 *
 * No npm deps besides React. Uses Tailwind utility classes.
 * Microphone access needs https:// or localhost.
 */

const LANGS = [
  { code: "en-IN", label: "English (India)", dg: "en" },
  { code: "en-US", label: "English (US)", dg: "en" },
  { code: "hi-IN", label: "Hindi", dg: "hi" },
  { code: "mr-IN", label: "Marathi (browser engine only)", dg: null },
];

const WORKLET_SRC = `
class PCM extends AudioWorkletProcessor {
  constructor(){ super(); this.buf = new Int16Array(1600); this.n = 0; }
  process(inputs){
    const ch = inputs[0] && inputs[0][0];
    if(!ch) return true;
    for(let i=0;i<ch.length;i++){
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if(this.n === this.buf.length){ this.port.postMessage(this.buf.buffer.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("pcm", PCM);
`;

const SpeechRecognitionCtor =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export default function WisprLive() {
  const [engine, setEngine] = useState(SpeechRecognitionCtor ? "browser" : "deepgram");
  const [lang, setLang] = useState(LANGS[0].code);
  const [apiKey, setApiKey] = useState("");
  const [listening, setListening] = useState(false);
  const [lines, setLines] = useState([]);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const active = useRef(false);
  const recog = useRef(null);
  const dg = useRef({ ws: null, ctx: null, stream: null, node: null });
  const endRef = useRef(null);

  useEffect(() => () => stop(), []); // eslint-disable-line
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, interim]);

  const commit = (t) => {
    const s = t.trim();
    if (s) setLines((l) => [...l, s]);
  };

  /* --------------------------- Browser engine ---------------------------- */
  const startBrowser = () => {
    if (!SpeechRecognitionCtor) {
      setError("This browser has no Web Speech API. Use Chrome, Edge or Safari, or switch to Deepgram.");
      return;
    }
    const r = new SpeechRecognitionCtor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) commit(res[0].transcript);
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(
        e.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in the site settings."
          : e.error === "network"
          ? "The browser speech service is unreachable. Check your connection."
          : `Speech error: ${e.error}`
      );
      if (e.error === "not-allowed" || e.error === "network") stop();
    };
    // Chrome ends the session after a pause; restart while the user is still listening.
    r.onend = () => {
      setInterim("");
      if (active.current) {
        try { r.start(); } catch { /* already started */ }
      }
    };
    recog.current = r;
    r.start();
  };

  /* --------------------------- Deepgram engine --------------------------- */
  const startDeepgram = async () => {
    const lg = LANGS.find((l) => l.code === lang)?.dg;
    if (!lg) { setError("Marathi isn't available with Deepgram. Use the browser engine."); return; }
    if (!apiKey.trim()) { setError("Paste your Deepgram API key first."); return; }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule(
      URL.createObjectURL(new Blob([WORKLET_SRC], { type: "text/javascript" }))
    );

    const params = new URLSearchParams({
      model: "nova-3",
      language: lg,
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      endpointing: "300",
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["token", apiKey.trim()]);
    ws.binaryType = "arraybuffer";

    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const text = m.channel?.alternatives?.[0]?.transcript;
      if (text === undefined) return;
      if (m.is_final) { commit(text); setInterim(""); }
      else setInterim(text);
    };
    ws.onerror = () => setError("Deepgram connection failed. Check the API key and your network.");
    ws.onclose = (e) => {
      if (active.current) {
        setError(e.code === 1008 || e.code === 4001 ? "Deepgram rejected the API key." : "Deepgram connection closed.");
        stop();
      }
    };
    await new Promise((res, rej) => {
      ws.onopen = res;
      setTimeout(() => rej(new Error("Deepgram timed out.")), 8000);
    });

    const node = new AudioWorkletNode(ctx, "pcm");
    node.port.onmessage = (e) => ws.readyState === 1 && ws.send(e.data);
    ctx.createMediaStreamSource(stream).connect(node);
    dg.current = { ws, ctx, stream, node };
  };

  /* ------------------------------ Controls ------------------------------- */
  const start = async () => {
    setError("");
    active.current = true;
    setListening(true);
    try {
      if (engine === "browser") startBrowser();
      else await startDeepgram();
    } catch (err) {
      setError(
        err?.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in the site settings."
          : String(err?.message || err)
      );
      stop();
    }
  };

  function stop() {
    active.current = false;
    try { recog.current?.stop(); } catch { /* noop */ }
    recog.current = null;
    const { ws, ctx, stream, node } = dg.current;
    try { ws?.readyState === 1 && ws.send(JSON.stringify({ type: "CloseStream" })); } catch { /* noop */ }
    node?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    ws?.close();
    ctx?.close();
    dg.current = { ws: null, ctx: null, stream: null, node: null };
    setListening(false);
    setInterim((i) => { if (i.trim()) commit(i); return ""; });
  }

  const copy = async () => {
    await navigator.clipboard.writeText(lines.join(" "));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const field =
    "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600 disabled:opacity-50";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">Live transcription</h1>
          <p className="mt-1 text-slate-600">Words appear as you speak.</p>
        </header>

        <section className="rounded-lg bg-white border border-slate-300 p-4 mb-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block mb-1 font-medium">Engine</span>
            <select
              className={field}
              value={engine}
              disabled={listening}
              onChange={(e) => setEngine(e.target.value)}
            >
              <option value="browser">Browser speech (no setup)</option>
              <option value="deepgram">Deepgram Nova-3 (most accurate)</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="block mb-1 font-medium">Language</span>
            <select
              className={field}
              value={lang}
              disabled={listening}
              onChange={(e) => setLang(e.target.value)}
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>

          {engine === "deepgram" && (
            <label className="text-sm sm:col-span-2">
              <span className="block mb-1 font-medium">Deepgram API key</span>
              <input
                type="password"
                autoComplete="off"
                className={field}
                value={apiKey}
                disabled={listening}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste key (kept in memory only)"
              />
            </label>
          )}
        </section>

        <section className="flex items-center gap-4 mb-4">
          <button
            onClick={listening ? stop : start}
            aria-pressed={listening}
            className={`flex items-center gap-2 rounded-full px-6 py-3 font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-600 ${
              listening ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            <span className={`inline-block h-3 w-3 rounded-full bg-white ${listening ? "animate-pulse" : ""}`} />
            {listening ? "Stop" : "Start listening"}
          </button>
          <div className="flex-1" />
          <button onClick={copy} disabled={!lines.length} className="text-sm underline underline-offset-2 disabled:opacity-40 disabled:no-underline">
            {copied ? "Copied" : "Copy text"}
          </button>
          <button
            onClick={() => { setLines([]); setInterim(""); }}
            disabled={!lines.length && !interim}
            className="text-sm underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
          >
            Clear
          </button>
        </section>

        {error && (
          <p role="alert" className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <section
          className="rounded-lg bg-white border border-slate-300 p-5 h-[24rem] overflow-y-auto leading-relaxed text-lg"
          aria-live="polite"
        >
          {!lines.length && !interim && (
            <p className="text-slate-500 text-base">
              {listening ? "Listening… start talking." : "Press Start listening and speak. Your words appear here."}
            </p>
          )}
          {lines.map((l, i) => <span key={i}>{l} </span>)}
          {interim && <span className="text-slate-500">{interim}</span>}
          <div ref={endRef} />
        </section>
      </div>
    </div>
  );
}