// TEMPORARY identity, until the app has a real login.
//
// The browser creates a random ID once, keeps it in localStorage and sends it
// with every request. This is identity by possession, not security: whoever has
// the ID can see that candidate's reports, and clearing the browser data loses
// access to the old reports.
//
// When real login exists, change authHeaders() to return the login token, e.g.
//   return { Authorization: `Bearer ${token}` };
// and set ALLOW_DEV_IDENTITY=false on the backend.

const ID_KEY = "ai-interviewer-candidate-id";
const NAME_KEY = "ai-interviewer-candidate-name";

let memoryId = null;   // used only if localStorage is blocked

function randomId() {

  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Non-secure pages have no crypto.randomUUID
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getCandidateId() {

  try {
    let id = localStorage.getItem(ID_KEY);

    if (!id) {
      id = randomId();
      localStorage.setItem(ID_KEY, id);
    }

    return id;

  } catch {
    if (!memoryId) memoryId = randomId();
    return memoryId;
  }
}

export function authHeaders() {
  return { "x-candidate-id": getCandidateId() };
}

export function getSavedName() {
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
}

export function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
}