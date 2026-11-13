const LANGUAGE = "en-IN";   // "en-US", "hi-IN", "mr-IN" also work with the browser engine
const FLUSH_MS = 1500;      // wait this long after Stop for the last words

const SpeechRecognitionCtor =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

const FATAL_ERRORS = {
  "not-allowed": "Microphone access was blocked. Allow it in the site settings.",
  "service-not-allowed": "Speech recognition is blocked by the browser. Check your microphone permissions.",
  "audio-capture": "No microphone was detected. Connect or enable your microphone.",
  network: "The browser speech service is unreachable. Check your internet connection.",
  "language-not-supported": "This speech language is not supported by your browser.",
};

export class SpeechRecognitionService {
  constructor() {
    this.state = "idle";   // idle | starting | recording | transcribing
    this.runId = 0;
    this.recognition = null;
    this.wantListening = false;
    this.finals = [];
    this.interim = "";
    this.onResult = null;
    this.onError = null;
    this.onState = null;
  }

  _setState(state) {
    this.state = state;
    this.onState?.(state);
  }

  // Sends the full transcript so far (finished sentences + the live part)
  _emit() {
    const text = [...this.finals, this.interim]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    this.onResult?.(text);
  }

  async start(onResult, onError, onState) {
    if (!SpeechRecognitionCtor) {
      throw new Error(
        "Speech recognition is not supported in this browser. Please use Google Chrome, Microsoft Edge or Safari."
      );
    }

    if (this.state !== "idle") return;

    this.onResult = onResult;
    this.onError = onError;
    this.onState = onState;
    this.finals = [];
    this.interim = "";

    const runId = ++this.runId;
    this.wantListening = true;
    this.state = "starting";

    const r = new SpeechRecognitionCtor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = LANGUAGE;
    r.maxAlternatives = 1;

    r.onstart = () => {
      if (runId === this.runId && this.state === "starting") {
        this._setState("recording");
      }
    };

    r.onresult = (e) => {
      if (runId !== this.runId) return;

      let live = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];

        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) this.finals.push(text);
        } else {
          live += result[0].transcript;
        }
      }

      this.interim = live.trim();
      this._emit();
    };

    r.onerror = (e) => {
      if (runId !== this.runId) return;

      // Normal pauses; the session just restarts
      if (e.error === "no-speech" || e.error === "aborted") return;

      const message = FATAL_ERRORS[e.error] || `Speech error: ${e.error}`;

      if (FATAL_ERRORS[e.error]) {
        this._fail(message);
      } else {
        this.onError?.(message);
      }
    };

    r.onend = () => {
      if (runId !== this.runId) return;

      // Keep words that were still "live" when the session ended
      if (this.interim) {
        this.finals.push(this.interim);
        this.interim = "";
        this._emit();
      }

      // The user pressed Stop
      if (this.state === "transcribing") {
        this._finishStop();
        return;
      }

      // Chrome ends the session after a pause: restart while still listening
      if (this.wantListening) {
        try { r.start(); } catch { /* already started */ }
      }
    };

    this.recognition = r;

    try {
      r.start();
    } catch (err) {
      this._release();
      this.state = "idle";
      throw new Error(
        err?.name === "InvalidStateError"
          ? "The microphone is already starting. Please try again."
          : err?.message || "Could not start speech recognition."
      );
    }
  }

  // Stop listening and keep the last words
  stop() {
    if (this.state !== "recording" && this.state !== "starting") return;

    this.wantListening = false;
    this._setState("transcribing");

    const runId = this.runId;

    try { this.recognition?.stop(); } catch { /* already stopped */ }

    setTimeout(() => {
      if (runId === this.runId && this.state === "transcribing") {
        this._finishStop();
      }
    }, FLUSH_MS);
  }

  // Discard everything immediately (submit / finish / unmount)
  cancel() {
    this._release();
    if (this.state !== "idle") this._setState("idle");
  }

  _finishStop() {
    if (this.interim) {
      this.finals.push(this.interim);
      this.interim = "";
    }

    this._emit();
    this._release();
    this._setState("idle");
  }

  _fail(message) {
    this._release();
    this._setState("idle");
    this.onError?.(message);
  }

  _release() {
    this.runId++;   // ignore any late events from the old session
    this.wantListening = false;

    const r = this.recognition;
    this.recognition = null;

    if (r) {
      r.onstart = null;
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      try { r.abort(); } catch { /* ignore */ }
    }
  }
}