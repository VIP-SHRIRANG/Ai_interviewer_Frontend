const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

// Adjust if your interviewRoutes.js uses different paths
const PATHS = {
  topics: "/interview/topics",
  start: "/interview/start",
  answer: "/interview/answer",
  options: "/interview/options",
  finish: "/interview/finish",
  report: (id) => `/interview/report/${id}`,
};

async function readError(res) {
  try {
    const data = await res.json();
    return data.error || data.message || res.statusText;
  } catch {
    return res.statusText;
  }
}

export class InterviewClient {
  constructor() {
    this.sessionId = null;
    this.onQuestion = null;
    this.onAudio = null;
    this.onFeedback = null;
    this.onSessionCompleted = null;
    this.onComplete = null;
    this.onError = null;
  }

  // async fetchTopics() {
  //   const res = await fetch(`${BASE_URL}${PATHS.topics}`);
  //   if (!res.ok) throw new Error(`Topics failed (${res.status}): ${await readError(res)}`);
  //   return res.json(); // { topics: [...] }
  // }

  async fetchOptions() {
  const res = await fetch(`${BASE_URL}${PATHS.options}`);
  if (!res.ok) throw new Error(`Options failed (${res.status}): ${await readError(res)}`);
  return res.json();   // { companies: [...], roles: [...] }
}

async startInterview({ company, role, round, maxQuestions, candidateName }) {
  this.sessionId = null;
  return this._stream(
    PATHS.start,
    { company, role, round, topic: role, maxQuestions, candidateName },
    { resolveOnSession: true }
  );
}

  // async startInterview({ topic, difficulty, maxQuestions, candidateName }) {
  //   this.sessionId = null;
  //   return this._stream(
  //     PATHS.start,
  //     { topic, difficulty, maxQuestions, candidateName },
  //     { resolveOnSession: true }
  //   );
  // }

  async submitAnswer(sessionId, answer) {
    return this._stream(PATHS.answer, { sessionId, answer });
  }

  async finishInterview(sessionId) {
    const res = await fetch(`${BASE_URL}${PATHS.finish}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (!res.ok) throw new Error(`Finish failed (${res.status}): ${await readError(res)}`);

    const data = await res.json();
    const s = data.summary;
    return {
      completed: true,
      summary: {
        averageScore: data.averageScore,
        status: data.status,
        ...(s && typeof s === "object" ? s : { summary: s }),
      },
    };
  }

  async downloadReport(sessionId) {
    const res = await fetch(`${BASE_URL}${PATHS.report(sessionId)}`);
    if (!res.ok) throw new Error(`Report failed (${res.status}): ${await readError(res)}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `interview-report-${sessionId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async _stream(path, body, { resolveOnSession = false } = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Backend error ${res.status}: ${await readError(res)}`);

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve({ sessionId: this.sessionId, streamed: true });
        }
      };

      (async () => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop();

            for (const part of parts) {
              const dataLine = part
                .split("\n")
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).trim())
                .join("");
              if (!dataLine) continue;

              let evt;
              try { evt = JSON.parse(dataLine); } catch { continue; }

              this._handleEvent(evt);
              if (resolveOnSession && this.sessionId) finish();
            }
          }
          finish();
        } catch (err) {
          if (!settled) { settled = true; reject(err); }
          else this.onError?.(err);
        }
      })();
    });
  }

  _handleEvent(evt) {
    if (evt.sessionId) this.sessionId = evt.sessionId;

    switch (evt.type) {
      case "audio":
        this.onAudio?.(evt.audio);
        break;
      case "question":
        this.onQuestion?.(evt);
        break;
      case "feedback":
        this.onFeedback?.({ ...(evt.evaluation || {}), feedback: evt.feedback });
        break;
      case "completed": {
        const s = evt.summary;
        this.onSessionCompleted?.({
          summary: {
            averageScore: evt.averageScore,
            ...(s && typeof s === "object" ? s : { summary: s }),
          },
        });
        break;
      }
      case "error":
        this.onError?.(new Error(evt.error || evt.message || "Backend error"));
        break;
      case "done":
        this.onComplete?.();
        break;
    }
  }
}