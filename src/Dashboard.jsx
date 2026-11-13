import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { InterviewClient } from "./services/InterviewClient.js";

const POLL_MS = 6000;

function formatDate(iso) {
  if (!iso) return "—";

  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function StatusBadge({ session }) {
  const base = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold";

  if (session.status === "completed") {
    return (
      <span className={`${base} bg-emerald-50 text-emerald-700`}>
        Completed
      </span>
    );
  }

  if (session.status === "under_evaluation") {
    return (
      <span className={`${base} bg-amber-50 text-amber-700`}>
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
        Under evaluation
      </span>
    );
  }

  if (session.status === "failed") {
    return <span className={`${base} bg-red-50 text-red-700`}>Failed</span>;
  }

  return (
    <span className={`${base} bg-slate-100 text-slate-600`}>In progress</span>
  );
}

export default function Dashboard() {
  const client = useMemo(() => new InterviewClient(), []);

  const [sessions, setSessions] = useState(null); // null = still loading
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const list = await client.listSessions();
      setSessions(list);
      setError("");
    } catch (err) {
      setError(err?.message || "Could not load your interviews.");
      setSessions((previous) => previous ?? []);
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep refreshing while any interview is still being evaluated
  const waiting = sessions?.some((s) => s.status === "under_evaluation");

  useEffect(() => {
    if (!waiting) return;

    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);

  async function download(sessionId) {
    setBusyId(sessionId);
    setError("");

    try {
      await client.downloadReport(sessionId);
    } catch (err) {
      setError(err?.message || "Could not download the report.");
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function retry(sessionId) {
    setBusyId(sessionId);
    setError("");

    try {
      await client.retryEvaluation(sessionId);
      await load();
    } catch (err) {
      setError(err?.message || "Could not retry the evaluation.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <p className="text-xl font-extrabold tracking-tight text-indigo-700">
              AI Interviewer
            </p>
            <p className="mt-1 text-sm text-slate-500">My interviews</p>
          </div>

          <Link
            to="/"
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            New interview
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Your interview reports
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Reports are prepared after each interview. This page updates by itself while a report is being prepared.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          {sessions === null ? (
            <p className="p-6 text-sm text-slate-500">Loading your interviews...</p>
          ) : sessions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-600">
                You have not taken an interview yet.
              </p>
              <Link
                to="/"
                className="mt-4 inline-block rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                Start your first interview
              </Link>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Started</th>
                  <th className="px-4 py-3 font-semibold">Session ID</th>
                  <th className="px-4 py-3 font-semibold">Company</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map((session) => (
                  <tr key={session.sessionId} data-testid="session-row">
                    <td className="whitespace-nowrap px-4 py-4 text-slate-700">
                      {formatDate(session.startedAt)}
                    </td>
                    <td className="px-4 py-4">
                      <code className="break-all text-xs text-slate-500">
                        {session.sessionId}
                      </code>
                    </td>
                    <td className="px-4 py-4 text-slate-700">{session.company || "—"}</td>
                    <td className="px-4 py-4 text-slate-700">{session.role || "—"}</td>
                    <td className="px-4 py-4">
                      <StatusBadge session={session} />

                      {session.status === "under_evaluation" && session.queuePosition && (
                        <p className="mt-1 text-xs text-slate-500">
                          {session.queuePosition === 1
                            ? "Next in line"
                            : `${session.queuePosition - 1} ahead of you`}
                        </p>
                      )}

                      {session.status === "completed" && session.averageScore != null && (
                        <p className="mt-1 text-xs text-slate-500">
                          Average score {Number(session.averageScore).toFixed(1)}/10
                        </p>
                      )}

                      {session.status === "in_progress" && (
                        <p className="mt-1 text-xs text-slate-500">
                          {session.questionsAnswered ?? 0}/{session.totalQuestions} answered
                        </p>
                      )}

                      {session.status === "failed" && session.error && (
                        <p className="mt-1 max-w-xs text-xs text-red-600">{session.error}</p>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {session.status === "completed" && (
                        <button
                          type="button"
                          onClick={() => download(session.sessionId)}
                          disabled={busyId === session.sessionId}
                          className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {busyId === session.sessionId ? "Preparing..." : "Download"}
                        </button>
                      )}

                      {session.status === "failed" && session.canRetry && (
                        <button
                          type="button"
                          onClick={() => retry(session.sessionId)}
                          disabled={busyId === session.sessionId}
                          className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                          Retry
                        </button>
                      )}

                      {(session.status === "under_evaluation" ||
                        session.status === "in_progress") && (
                        <span className="text-xs text-slate-400">Not ready yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}