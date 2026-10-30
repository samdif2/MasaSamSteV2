// Typed client for the Masaniello persistence API (Netlify Functions + Netlify Database).
// Responses use the Drizzle (camelCase) field names; request bodies use snake_case.

export interface MasanielloSettings {
  id: number;
  initialBankroll: number;
  totalEventsN: number;
  expectedEventsK: number;
  averageOdds: number;
  createdAt: string;
}

export type EventStatus = "Pending" | "Won" | "Lost";

export interface MasanielloEvent {
  id: number;
  matchName: string;
  selection: string;
  odds: number;
  stake: number;
  status: EventStatus;
  createdAt: string;
}

export interface RawMatchesList {
  id: number;
  rawText: string;
  createdAt: string;
}

export interface NewEvent {
  match_name: string;
  selection: string;
  odds: number;
  stake: number;
  status?: EventStatus;
}

// Full app snapshot synced across devices under a code
export interface SessionState {
  title?: string;
  config: { initialBankroll: number; totalEvents: number; expectedWins: number; averageOdds: number };
  events: unknown[];
  roundStakes: boolean;
  matchesListText: string;
}

export interface MasanielloSession {
  code: string;
  title?: string | null;
  state: SessionState;
  updatedAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface AnalysisPromptSetting {
  prompt: string;
  updatedAt: string;
}

export interface AnalyzeMatchesResponse {
  output?: string;
  error?: string;
}

export interface SingleMatchData {
  id?: number;
  date?: string;
  time?: string;
  match: string;
  competition?: string;
  market?: string;
  probability?: number | null;
  probabilityRaw?: string;
  originalOdds?: number;
  updatedOdds?: number;
  valueEdge?: string;
}

export const api = {
  getSettings: () => request<MasanielloSettings[]>("/api/settings"),
  getLatestSettings: () => request<MasanielloSettings | null>("/api/settings?latest=1"),
  saveSettings: (s: { initial_bankroll: number; total_events_n: number; expected_events_k: number; average_odds: number }) =>
    request<MasanielloSettings>("/api/settings", { method: "POST", body: JSON.stringify(s) }),

  getEvents: () => request<MasanielloEvent[]>("/api/events"),
  addEvent: (e: NewEvent) => request<MasanielloEvent>("/api/events", { method: "POST", body: JSON.stringify(e) }),
  addEvents: (e: NewEvent[]) => request<MasanielloEvent[]>("/api/events", { method: "POST", body: JSON.stringify(e) }),
  updateEvent: (id: number, patch: { status?: EventStatus; stake?: number; odds?: number }) =>
    request<MasanielloEvent>(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteEvent: (id: number) => request<void>(`/api/events/${id}`, { method: "DELETE" }),

  getRawMatches: () => request<RawMatchesList[]>("/api/raw-matches"),
  getLatestRawMatches: () => request<RawMatchesList | null>("/api/raw-matches?latest=1"),
  saveRawMatches: (raw_text: string) =>
    request<RawMatchesList>("/api/raw-matches", { method: "POST", body: JSON.stringify({ raw_text }) }),

  getLatestSession: () => request<MasanielloSession | null>("/api/sessions/latest"),
  getAllSessions: () => request<MasanielloSession[]>("/api/sessions/list"),
  getSession: (code: string) => request<MasanielloSession>(`/api/sessions/${encodeURIComponent(code)}`),
  saveSession: (code: string, state: SessionState, title?: string) =>
    request<MasanielloSession>(`/api/sessions/${encodeURIComponent(code)}`, {
      method: "PUT",
      body: JSON.stringify({ state, title: title || state.title }),
    }),

  getAnalysisPrompt: () => request<AnalysisPromptSetting | null>("/api/analysis-prompt"),
  saveAnalysisPrompt: (prompt: string) =>
    request<AnalysisPromptSetting>("/api/analysis-prompt", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  analyzeMatches: (matches: string, prompt?: string, signal?: AbortSignal) =>
    request<AnalyzeMatchesResponse>("/api/analyze-matches", {
      method: "POST",
      body: JSON.stringify({ matches, prompt }),
      signal,
    }),

  getSingleAnalysisPrompt: () => request<AnalysisPromptSetting | null>("/api/single-analysis-prompt"),
  saveSingleAnalysisPrompt: (prompt: string) =>
    request<AnalysisPromptSetting>("/api/single-analysis-prompt", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  analyzeSingleMatch: (matchData: SingleMatchData, prompt?: string, signal?: AbortSignal) =>
    request<AnalyzeMatchesResponse>("/api/analyze-single-match", {
      method: "POST",
      body: JSON.stringify({ matchData, prompt }),
      signal,
    }),
};
