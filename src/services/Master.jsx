import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { InterviewClient } from "./InterviewClient.js";
import { AudioPlayer } from "./audioPlayer.js";
import { SpeechRecognitionService } from "./speechRecognition.js";
import { getSavedName, saveName } from "./identity.js";

const INITIAL_FORM = {
  candidateName: "",
  company: "",
  role: "",
  maxQuestions: 5,
};

// Fallback lists, replaced by the backend's /interview/options when available
const DEFAULT_COMPANIES = [
  "nCircle",
  "TCS",
  "Infosys",
  "Wipro",
  "Accenture",
  "Capgemini",
  "Cognizant",
  "Amazon",
  "Microsoft",
  "Google",
];

const DEFAULT_ROLES = [
  "Backend Developer",
  "Frontend Developer",
  "Full Stack Developer",
  "Software Engineer",
  "Android Developer",
  "Data Analyst",
  "Data Scientist",
  "DevOps Engineer",
  "QA Engineer",
];

const INITIAL_METRICS = {
  questionNumber: 0,
  totalQuestions: 5,
  progress: 0,
};

// Auto-submit after this much inactivity (typing or speaking)
const AUTO_SUBMIT_DELAY_MS = 5000;

function getMessage(error) {
  if (typeof error === "string") return error;
  return error?.message || "Something went wrong. Please try again.";
}

function getOptionValue(item) {
  if (typeof item === "string") return item.trim();

  if (item && typeof item === "object") {
    return String(
      item.value ?? item.id ?? item.name ?? item.label ?? ""
    ).trim();
  }

  return "";
}

function getOptionLabel(item) {
  if (typeof item === "string") return item.trim();

  if (item && typeof item === "object") {
    return String(
      item.label ?? item.name ?? item.value ?? item.id ?? ""
    ).trim();
  }

  return "";
}

function toOptions(list) {
  if (!Array.isArray(list)) return [];

  return list
    .map((item) => ({
      value: getOptionValue(item),
      label: getOptionLabel(item),
    }))
    .filter((item) => item.value);
}

const DEFAULT_COMPANY_OPTIONS = toOptions(DEFAULT_COMPANIES);
const DEFAULT_ROLE_OPTIONS = toOptions(DEFAULT_ROLES);

export default function App() {
  const [form, setForm] = useState(() => ({
    ...INITIAL_FORM,
    candidateName: getSavedName(),
  }));
  const [companies, setCompanies] = useState(DEFAULT_COMPANY_OPTIONS);
  const [roles, setRoles] = useState(DEFAULT_ROLE_OPTIONS);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  // idle | starting | active | submitted
  const [sessionStatus, setSessionStatus] = useState("idle");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    "Choose a company and role, then select Start Interview."
  );

  const clientRef = useRef(null);
  const submitAnswerRef = useRef(null);
  const audioRef = useRef(null);
  const speechRef = useRef(null);
  const sessionIdRef = useRef(null);
  const answerRef = useRef("");
  const mountedRef = useRef(false);
  const submittingRef = useRef(false);

  if (!clientRef.current) {
    clientRef.current = new InterviewClient();
  }

  if (!audioRef.current) {
    audioRef.current = new AudioPlayer();
  }

  if (!speechRef.current) {
    speechRef.current = new SpeechRecognitionService();
  }

  const updateAnswer = useCallback((value) => {
    answerRef.current = value;
    setAnswer(value);
  }, []);

  const updateMetrics = useCallback((data = {}) => {
    setMetrics((previous) => {
      const questionNumber = data.questionNumber ?? previous.questionNumber;
      const totalQuestions = data.maxQuestions ?? previous.totalQuestions;

      return {
        questionNumber,
        totalQuestions,
        progress:
          questionNumber && totalQuestions
            ? Math.round((questionNumber / totalQuestions) * 100)
            : previous.progress,
      };
    });
  }, []);

  const playAudio = useCallback((audioData) => {
    if (!audioData) return;

    const player = audioRef.current;

    if (typeof player?.enqueue === "function") {
      player.enqueue(audioData);
    }
  }, []);

  const handleQuestion = useCallback(
    (data) => {
      if (!mountedRef.current) return;

      const nextQuestion = data?.question;
      if (!nextQuestion) return;

      setQuestion(nextQuestion);
      updateAnswer("");
      updateMetrics({
        questionNumber: data.questionNumber,
        maxQuestions: data.maxQuestions,
      });

      if (data.sessionId) sessionIdRef.current = data.sessionId;

      setSessionStatus("active");
      setIsStarting(false);
      setIsSubmitting(false);
      submittingRef.current = false;
      setStatusMessage("Your next interview question is ready.");
    },
    [updateAnswer, updateMetrics]
  );

  const handleAudio = useCallback(
    (data) => {
      if (!mountedRef.current) return;
      playAudio(data?.audio);
    },
    [playAudio]
  );

  // The interview was handed to the evaluation queue
  const handleSubmitted = useCallback((data) => {
    if (!mountedRef.current) return;

    if (data?.sessionId) sessionIdRef.current = data.sessionId;

    try {
      speechRef.current?.cancel?.();
    } catch {
      // Ignore speech cleanup errors.
    }

    setSessionStatus("submitted");
    setIsStarting(false);
    setIsSubmitting(false);
    setIsFinishing(false);
    setIsListening(false);
    setIsTranscribing(false);
    submittingRef.current = false;
    setStatusMessage("Interview submitted.");
  }, []);

  const handleError = useCallback((err) => {
    if (!mountedRef.current) return;

    setError(getMessage(err));
    setIsStarting(false);
    setIsSubmitting(false);
    setIsFinishing(false);
    submittingRef.current = false;
    setStatusMessage("An error occurred.");
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const client = clientRef.current;

    client.onQuestion = handleQuestion;
    client.onAudio = handleAudio;
    client.onSubmitted = handleSubmitted;
    client.onComplete = () => {
      if (!mountedRef.current) return;
      setIsStarting(false);
    };
    client.onError = handleError;

    return () => {
      mountedRef.current = false;

      try {
        speechRef.current?.cancel?.();
        audioRef.current?.stop?.();
      } catch {
        // Ignore cleanup errors.
      }

      client.onQuestion = null;
      client.onAudio = null;
      client.onSubmitted = null;
      client.onComplete = null;
      client.onError = null;
    };
  }, [handleQuestion, handleAudio, handleSubmitted, handleError]);

  // Load company / role lists from the backend (falls back to the defaults)
  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      setIsLoadingOptions(true);

      try {
        const result = await clientRef.current.fetchOptions();

        if (cancelled) return;

        const companyList = toOptions(result?.companies);
        const roleList = toOptions(result?.roles);

        setCompanies(
          companyList.length > 0 ? companyList : DEFAULT_COMPANY_OPTIONS
        );
        setRoles(roleList.length > 0 ? roleList : DEFAULT_ROLE_OPTIONS);
        setOptionsLoaded(true);
      } catch (err) {
        if (cancelled) return;

        setCompanies(DEFAULT_COMPANY_OPTIONS);
        setRoles(DEFAULT_ROLE_OPTIONS);
        setOptionsLoaded(true);
        setError(
          `Could not load companies and roles from the backend. Default lists are available. ${getMessage(err)}`
        );
      } finally {
        if (!cancelled) setIsLoadingOptions(false);
      }
    }

    loadOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleFormChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: name === "maxQuestions" ? Number(value) : value,
    }));

    if ((name === "company" || name === "role") && value.trim()) {
      setError("");
    }
  }

  async function startInterview(event) {
    event?.preventDefault();

    if (isStarting || sessionStatus === "active") return;

    const candidateName = form.candidateName.trim();
    const selectedCompany = String(form.company ?? "").trim();
    const selectedRole = String(form.role ?? "").trim();

    if (!candidateName) {
      setError("Please enter your name.");
      return;
    }

    if (!selectedCompany) {
      setError("Please select a company.");
      return;
    }

    if (!selectedRole) {
      setError("Please select a role.");
      return;
    }

    saveName(candidateName);

    setError("");
    setQuestion("");
    updateAnswer("");

    sessionIdRef.current = null;
    clientRef.current.sessionId = null;
    submittingRef.current = false;

    setMetrics({
      questionNumber: 0,
      totalQuestions: form.maxQuestions,
      progress: 0,
    });

    setIsStarting(true);
    setSessionStatus("starting");
    setStatusMessage("Starting your interview...");

    try {
      const result = await clientRef.current.startInterview({
        company: selectedCompany,
        role: selectedRole,
        maxQuestions: form.maxQuestions,
        candidateName,
      });

      sessionIdRef.current =
        result?.sessionId ?? clientRef.current.sessionId ?? sessionIdRef.current;

      if (!sessionIdRef.current) {
        setSessionStatus("idle");
        setIsStarting(false);
        setError("The backend did not return a session ID. Please try again.");
        return;
      }

      setIsStarting(false);
    } catch (err) {
      setSessionStatus("idle");
      setIsStarting(false);
      handleError(err);
    }
  }

  async function submitAnswer({ automatic = false } = {}) {
    if (submittingRef.current) return;

    if (sessionStatus !== "active") {
      setError("Please start an interview first.");
      return;
    }

    const sessionId = sessionIdRef.current ?? clientRef.current?.sessionId;

    if (!sessionId) {
      setError("Interview session ID is missing. Please start a new interview.");
      return;
    }

    const finalAnswer = answerRef.current.trim();

    if (!finalAnswer) {
      if (!automatic) {
        setError("Please enter or speak your answer first.");
      }
      return;
    }

    try {
      speechRef.current?.cancel?.();
    } catch {
      // Ignore speech cleanup errors.
    }
    setIsListening(false);
    setIsTranscribing(false);

    submittingRef.current = true;
    setError("");
    setIsSubmitting(true);
    setStatusMessage("Saving your answer...");

    try {
      await clientRef.current.submitAnswer(sessionId, finalAnswer);
      // The next question (or the "submitted" event) arrives through the callbacks.
    } catch (err) {
      setIsSubmitting(false);
      submittingRef.current = false;
      handleError(err);
    }
  }

  async function finishInterview() {
    const sessionId = sessionIdRef.current ?? clientRef.current?.sessionId;

    if (isFinishing || !sessionId || sessionStatus !== "active") {
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Finish now? Only the questions you have answered will be evaluated."
      )
    ) {
      return;
    }

    try {
      speechRef.current?.cancel?.();
    } catch {
      // Ignore speech cleanup errors.
    }

    setIsListening(false);
    setIsTranscribing(false);
    setIsFinishing(true);
    setError("");
    setStatusMessage("Submitting your interview...");

    try {
      await clientRef.current.finishInterview(sessionId);
      handleSubmitted({ sessionId });
    } catch (err) {
      setIsFinishing(false);
      handleError(err);
    }
  }

  function startAnother() {
    sessionIdRef.current = null;
    clientRef.current.sessionId = null;
    setQuestion("");
    updateAnswer("");
    setError("");
    setMetrics(INITIAL_METRICS);
    setSessionStatus("idle");
    setStatusMessage("Choose a company and role, then select Start Interview.");
  }

  async function toggleSpeechRecognition() {
    const speech = speechRef.current;

    if (isListening) {
      speech?.stop(); // finish listening and keep the last words
      return;
    }

    if (!speech || typeof speech.start !== "function") {
      setError("Speech recognition is not available. Please type your answer.");
      return;
    }

    setError("");
    const baseText = answerRef.current;

    try {
      await speech.start(
        (text) => {
          if (!mountedRef.current || submittingRef.current) return;
          if (!text.trim()) return;

          updateAnswer((baseText + " " + text).trim());
        },
        (message) => {
          if (!mountedRef.current) return;

          setError(message);
          setStatusMessage("Microphone stopped. Check the error message.");
        },
        (state) => {
          if (!mountedRef.current) return;

          setIsListening(state === "recording");
          setIsTranscribing(state === "transcribing");

          if (state === "recording") {
            setStatusMessage("Listening... speak your answer.");
          }
        }
      );
    } catch (err) {
      setError(getMessage(err));
    }
  }

  submitAnswerRef.current = submitAnswer;

  const isActive = sessionStatus === "active";
  const isSubmitted = sessionStatus === "submitted";
  const isBusy = isStarting || isSubmitting || isFinishing || isTranscribing;

  // Auto-submit after a period of inactivity (typing or speaking)
  useEffect(() => {
    if (!isActive || isBusy || !answer.trim()) return;

    const timer = setTimeout(() => {
      submitAnswerRef.current?.({ automatic: true });
    }, AUTO_SUBMIT_DELAY_MS);

    // Any change to `answer` cancels this timer and starts a new one
    return () => clearTimeout(timer);
  }, [answer, isActive, isBusy]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <p className="text-xl font-extrabold tracking-tight text-indigo-700">
              AI Interviewer
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Practice interviews. Improve with every answer.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
              {isActive
                ? "Interview in progress"
                : isSubmitted
                  ? "Submitted"
                  : "Practice mode"}
            </span>
            <Link
              to="/dashboard"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              My interviews
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Prepare for your next interview
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Choose a company and role and answer the questions. Your report is prepared after the interview and appears under "My interviews".
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setError("")}
              className="font-bold"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:col-span-1">
            <h2 className="text-lg font-bold text-slate-900">Interview setup</h2>
            <p className="mt-1 text-sm text-slate-500">Customize your practice session.</p>

            <form onSubmit={startInterview} className="mt-6 space-y-5">
              <div>
                <label htmlFor="candidateName" className="mb-2 block text-sm font-semibold text-slate-700">
                  Candidate name
                </label>
                <input
                  id="candidateName"
                  name="candidateName"
                  value={form.candidateName}
                  onChange={handleFormChange}
                  placeholder="Enter your name"
                  disabled={isActive || isStarting}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
                  required
                />
              </div>

              <div>
                <label htmlFor="company" className="mb-2 block text-sm font-semibold text-slate-700">
                  Company
                </label>
                <select
                  id="company"
                  name="company"
                  value={form.company}
                  onChange={handleFormChange}
                  disabled={isActive || isStarting}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
                  required
                >
                  <option value="">
                    {isLoadingOptions ? "Loading companies..." : "Select a company"}
                  </option>
                  {companies.map((item, index) => (
                    <option key={`${item.value}-${index}`} value={item.value}>
                      {item.label || item.value}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-slate-500">
                  {isLoadingOptions
                    ? "Loading companies from the backend..."
                    : optionsLoaded
                      ? `${companies.length} companies available`
                      : "Select a company to continue."}
                </p>
              </div>

              <div>
                <label htmlFor="role" className="mb-2 block text-sm font-semibold text-slate-700">
                  Role
                </label>
                <select
                  id="role"
                  name="role"
                  value={form.role}
                  onChange={handleFormChange}
                  disabled={isActive || isStarting}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
                  required
                >
                  <option value="">
                    {isLoadingOptions ? "Loading roles..." : "Select a role"}
                  </option>
                  {roles.map((item, index) => (
                    <option key={`${item.value}-${index}`} value={item.value}>
                      {item.label || item.value}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="maxQuestions" className="mb-2 block text-sm font-semibold text-slate-700">
                  Number of questions
                </label>
                <select
                  id="maxQuestions"
                  name="maxQuestions"
                  value={form.maxQuestions}
                  onChange={handleFormChange}
                  disabled={isActive || isStarting}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
                >
                  {[3, 5, 10, 15].map((count) => (
                    <option key={count} value={count}>
                      {count} questions
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={isStarting || isActive}
                className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isStarting ? "Starting..." : "Start Interview"}
              </button>

              <button
                type="button"
                onClick={finishInterview}
                disabled={!isActive || isFinishing || isSubmitting}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isFinishing ? "Submitting..." : "Finish Interview"}
              </button>
            </form>
          </section>

          <div className="space-y-6 lg:col-span-2">
            {isSubmitted ? (
              <section className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
                  ✓
                </div>
                <h2 className="mt-5 text-xl font-bold text-slate-900">
                  Interview submitted
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
                  Well done. Your answers are being evaluated and your report will be ready soon. You do not need to wait here: check the status any time under "My interviews".
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link
                    to="/dashboard"
                    className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  >
                    View my interviews
                  </Link>
                  <button
                    type="button"
                    onClick={startAnother}
                    className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Start another interview
                  </button>
                </div>
              </section>
            ) : (
              <>
                <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <MetricCard label="Question" value={`${metrics.questionNumber}/${metrics.totalQuestions}`} />
                  <MetricCard label="Progress" value={`${metrics.progress}%`} />
                  <MetricCard label="Company" value={form.company || "—"} />
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <h2 className="text-lg font-bold text-slate-900">Interview question</h2>
                  {isActive && form.role && (
                    <p className="mt-1 text-sm text-slate-500">
                      {form.role} interview{form.company ? ` · ${form.company}` : ""}
                    </p>
                  )}
                  <div className="mt-5 min-h-36 rounded-xl border border-indigo-100 bg-indigo-50/60 p-5">
                    <p className="whitespace-pre-wrap text-base leading-7 text-slate-800">
                      {question || "Your first interview question will appear here after you start the interview."}
                    </p>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-indigo-600 transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, metrics.progress))}%` }}
                    />
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">Your answer</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Type your answer or use speech recognition.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={toggleSpeechRecognition}
                      disabled={!isActive || isBusy}
                      className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                        isListening
                          ? "bg-red-100 text-red-700 hover:bg-red-200"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {isListening ? "Stop listening" : "Use microphone"}
                    </button>
                  </div>

                  <textarea
                    value={answer}
                    onChange={(event) => updateAnswer(event.target.value)}
                    disabled={!isActive || isBusy || isListening}
                    placeholder="Write your answer here..."
                    rows={7}
                    className="mt-5 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm leading-6 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
                  />

                  {isListening && (
                    <p className="mt-2 text-sm font-medium text-red-600">
                      Listening for your answer...
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">{answer.trim().length} characters</p>
                    <button
                      type="button"
                      onClick={() => submitAnswer()}
                      disabled={!isActive || isBusy || !answer.trim()}
                      className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSubmitting ? "Saving..." : "Submit Answer"}
                    </button>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>

        <p aria-live="polite" className="mt-6 text-center text-xs text-slate-500">
          {statusMessage}
        </p>
      </main>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 break-words text-xl font-bold text-slate-900">
        {value ?? "—"}
      </p>
    </div>
  );
}