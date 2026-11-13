import { authHeaders } from "./identity.js";

const BASE_URL = import.meta.env?.VITE_API_URL || "http://localhost:3000";
const API_BASE = `${BASE_URL}/interview`;

export class InterviewClient {
  constructor() {
    this.sessionId = null;
    this.submitted = false;
    this.onQuestion = null;
    this.onAudio = null;
    this.onSubmitted = null;
    this.onComplete = null;
    this.onError = null;
  }

  async request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...authHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      let message = text;

      try {
        const parsed = JSON.parse(text);
        message = parsed.error || parsed.message || text;
      } catch {
        // Not JSON; use the raw text.
      }

      const error = new Error(message || `Request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response;
  }

  // ---------- setup ----------

  // Company / role / round lists for the dropdowns
  async fetchOptions() {
    const response = await this.request(`${API_BASE}/options`);
    return response.json();
  }

  // ---------- interview ----------

  async startInterview({ company, role, round, maxQuestions, candidateName }) {
    try {
      this.sessionId = null;
      this.submitted = false;

      const response = await this.request(`${API_BASE}/start`, {
        method: "POST",
        body: JSON.stringify({ company, role, round, maxQuestions, candidateName }),
      });

      await this.readEventStream(response);

      return { sessionId: this.sessionId, streamed: true };
    } catch (error) {
      this.onError?.(error);
      throw error;
    }
  }

  async submitAnswer(sessionId, answer) {
    try {
      const activeSessionId = sessionId ?? this.sessionId;

      if (!activeSessionId) {
        throw new Error("Cannot submit answer: session ID is missing.");
      }

      this.submitted = false;

      const response = await this.request(`${API_BASE}/answer`, {
        method: "POST",
        body: JSON.stringify({ sessionId: activeSessionId, answer }),
      });

      await this.readEventStream(response);

      return {
        sessionId: this.sessionId,
        streamed: true,
        submitted: this.submitted,
      };
    } catch (error) {
      this.onError?.(error);
      throw error;
    }
  }

  // Submit early: only the questions answered so far are evaluated
  async finishInterview(sessionId) {
    try {
      const activeSessionId = sessionId ?? this.sessionId;

      if (!activeSessionId) {
        throw new Error("Cannot finish interview: session ID is missing.");
      }

      const response = await this.request(`${API_BASE}/finish`, {
        method: "POST",
        body: JSON.stringify({ sessionId: activeSessionId }),
      });

      return response.json();
    } catch (error) {
      this.onError?.(error);
      throw error;
    }
  }

  // ---------- dashboard ----------

  async listSessions() {
    const response = await this.request(`${API_BASE}/sessions`);
    const data = await response.json();
    return data.sessions ?? [];
  }

  async getSession(sessionId) {
    const response = await this.request(
      `${API_BASE}/sessions/${encodeURIComponent(sessionId)}`
    );
    return response.json();
  }

  async retryEvaluation(sessionId) {
    const response = await this.request(
      `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/retry`,
      { method: "POST" }
    );
    return response.json();
  }

  async downloadReport(sessionId) {
    const response = await this.request(
      `${API_BASE}/report/${encodeURIComponent(sessionId)}`
    );

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `interview-report-${sessionId}.pdf`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  // ---------- server-sent events ----------

  saveSessionId(data) {
    if (!data || typeof data !== "object") return;

    if (data.sessionId !== undefined && data.sessionId !== null) {
      this.sessionId = data.sessionId;
    }
  }

  async readEventStream(response) {
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Streaming response is not supported.");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";

      for (const eventBlock of events) {
        this.processEventBlock(eventBlock);
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      this.processEventBlock(buffer);
    }

    this.onComplete?.();
  }

  processEventBlock(block) {
    const dataLines = [];

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (!dataLines.length) return;

    const rawData = dataLines.join("\n");
    let data;

    try {
      data = JSON.parse(rawData);
    } catch {
      return;
    }

    this.saveSessionId(data);

    switch (data.type) {
      case "question":
        this.onQuestion?.(data);
        break;

      case "audio":
        this.onAudio?.(data);
        break;

      case "submitted":
        this.submitted = true;
        this.onSubmitted?.(data);
        break;

      case "error":
        this.onError?.(new Error(data.error || data.message || "Something went wrong."));
        break;

      default:
        break; // "done" and anything unknown
    }
  }
}