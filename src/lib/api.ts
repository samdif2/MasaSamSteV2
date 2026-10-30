// Client di persistenza dati basato ESCLUSIVAMENTE su Supabase.
// Nessuna chiamata fetch() verso endpoint locali o Netlify Functions.

import { getSupabaseClient, isSupabaseConfigured } from "../supabaseClient";
import { analyzeMatchesDirect, analyzeSingleMatchDirect } from "./gemini";

export interface MasanielloSettings {
  id?: number;
  initialBankroll: number;
  totalEventsN: number;
  expectedEventsK: number;
  averageOdds: number;
  createdAt?: string;
}

export type EventStatus = "Pending" | "Won" | "Lost";

export interface MasanielloEvent {
  id: number;
  matchName: string;
  selection: string;
  odds: number;
  stake: number;
  status: EventStatus;
  createdAt?: string;
}

export interface RawMatchesList {
  id?: number;
  rawText: string;
  createdAt?: string;
}

export interface NewEvent {
  match_name: string;
  selection: string;
  odds: number;
  stake: number;
  status?: EventStatus;
}

// Snapshot completo dello stato Masaniello
export interface SessionState {
  title?: string;
  config: {
    initialBankroll: number;
    totalEvents: number;
    expectedWins: number;
    averageOdds: number;
  };
  events: any[];
  roundStakes: boolean;
  matchesListText: string;
}

export interface MasanielloSession {
  code: string;
  title?: string | null;
  state: SessionState;
  updatedAt: string;
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

export interface PartitaItem {
  id?: number;
  data?: string;
  ora?: string;
  segno?: string;
  probabilita?: string | number | null;
  partita: string;
  competizione?: string;
  quota?: number;
  value_edge?: string;
  raw_line?: string;
  created_at?: string;
}

const ANALYSIS_PROMPT_STORAGE_KEY = "masaniello_analysis_prompt_custom";
const SINGLE_ANALYSIS_PROMPT_STORAGE_KEY = "masaniello_single_analysis_prompt_custom";

/**
 * Helper per estrarre lo stato della sessione da una riga Supabase della tabella `masanielli`
 */
export function mapRowToSession(row: any): MasanielloSession {
  const code = (row.codice || row.code || "").toString().toUpperCase();
  const title = (row.titolo || row.title || "").toString();
  const updatedAt = row.updated_at || row.created_at || new Date().toISOString();

  let state: SessionState;
  const rawState = row.dettaglio_eventi ?? row.state;
  if (rawState) {
    if (typeof rawState === "string") {
      try {
        state = JSON.parse(rawState);
      } catch {
        state = {
          title,
          config: {
            initialBankroll: Number(row.cassa) || 100,
            totalEvents: Number(row.puntate) || 20,
            expectedWins: 11,
            averageOdds: 1.6,
          },
          events: [],
          roundStakes: true,
          matchesListText: "",
        };
      }
    } else {
      state = rawState;
    }
  } else {
    state = {
      title,
      config: {
        initialBankroll: Number(row.cassa) || 100,
        totalEvents: Number(row.puntate) || 20,
        expectedWins: 11,
        averageOdds: 1.6,
      },
      events: [],
      roundStakes: true,
      matchesListText: "",
    };
  }

  return {
    code,
    title: title || state.title || "Masaniello",
    state,
    updatedAt,
  };
}

/**
 * Converte righe dalla tabella 'partite' di Supabase in testo TSV
 */
export function formatPartiteToTSV(rows: any[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  return rows
    .map((row) => {
      if (row.raw_line && typeof row.raw_line === "string" && row.raw_line.trim()) {
        return row.raw_line.trim();
      }
      if (row.raw_text && typeof row.raw_text === "string" && row.raw_text.trim()) {
        return row.raw_text.trim();
      }
      const d = row.data || row.date || "";
      const t = row.ora || row.time || "";
      const s = row.segno || row.market || "";
      const p = row.probabilita || row.probability || "";
      const m = row.partita || row.match || "";
      const c = row.competizione || row.competition || "";
      const q =
        row.quota != null
          ? Number(row.quota).toFixed(2)
          : row.odds != null
          ? Number(row.odds).toFixed(2)
          : "";
      const ve = row.value_edge || row.valueEdge || "";
      return [d, t, s, p, m, c, q, ve].join("\t");
    })
    .join("\n");
}

export const api = {
  // ==========================================
  // MASANIELLI (tabella 'masanielli')
  // ==========================================

  /**
   * Salva o aggiorna un Masaniello con operazione di upsert / insert / update
   * su tabella 'masanielli', inserendo tutti i dettagli nella colonna 'dettaglio_eventi' (JSON)
   */
  async saveSession(code: string, state: SessionState, title?: string): Promise<MasanielloSession> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("Supabase non è configurato. Inserisci URL e Key tramite l'icona ⚙️ nell'header.");
    }

    const cleanCode = code.trim().toUpperCase();
    const cleanTitle = (title || state.title || "").trim() || "Masaniello";
    const cassa = Number(state.config?.initialBankroll || 0);
    const puntate = Number(state.config?.totalEvents || state.events?.length || 0);
    const now = new Date().toISOString();

    const dettaglioEventi: SessionState = {
      ...state,
      title: cleanTitle,
    };

    const payload = {
      codice: cleanCode,
      titolo: cleanTitle,
      cassa: cassa,
      puntate: puntate,
      dettaglio_eventi: dettaglioEventi,
      updated_at: now,
    };

    // Tentativo di upsert con onConflict su 'codice'
    let { error } = await client
      .from("masanielli")
      .upsert(payload, { onConflict: "codice" });

    // Fallback in caso di mancato vincolo onConflict
    if (error) {
      console.warn("[Supabase] Upsert masanielli error, provando update/insert fallback:", error.message);
      const { data: existing } = await client
        .from("masanielli")
        .select("codice")
        .eq("codice", cleanCode)
        .maybeSingle();

      if (existing) {
        const u = await client
          .from("masanielli")
          .update(payload)
          .eq("codice", cleanCode);
        error = u.error;
      } else {
        const i = await client.from("masanielli").insert(payload);
        error = i.error;
      }
    }

    if (error) {
      throw new Error(`Errore salvataggio Supabase (tabella masanielli): ${error.message}`);
    }

    return {
      code: cleanCode,
      title: cleanTitle,
      state: dettaglioEventi,
      updatedAt: now,
    };
  },

  /**
   * Recupera un Masaniello per codice dalla tabella 'masanielli'
   */
  async getSession(code: string): Promise<MasanielloSession> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("Supabase non è configurato. Inserisci URL e Key tramite l'icona ⚙️.");
    }

    const cleanCode = code.trim().toUpperCase();
    const { data, error } = await client
      .from("masanielli")
      .select("*")
      .eq("codice", cleanCode)
      .maybeSingle();

    if (error) {
      throw new Error(`Errore recupero Supabase (tabella masanielli): ${error.message}`);
    }

    if (!data) {
      throw new Error("Code not found");
    }

    return mapRowToSession(data);
  },

  /**
   * Recupera l'ultimo Masaniello salvato dalla tabella 'masanielli'
   */
  async getLatestSession(): Promise<MasanielloSession | null> {
    const client = getSupabaseClient();
    if (!client) return null;

    const { data, error } = await client
      .from("masanielli")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return mapRowToSession(data);
  },

  /**
   * Recupera la lista di tutti i Masanielli con `supabase.from('masanielli').select('*')`
   */
  async getAllSessions(): Promise<MasanielloSession[]> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("Supabase non è configurato. Inserisci URL e Key tramite l'icona ⚙️ nell'header.");
    }

    const { data, error } = await client
      .from("masanielli")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      throw new Error(`Errore recupero Masanielli da Supabase: ${error.message}`);
    }

    if (!Array.isArray(data)) return [];
    return data.map(mapRowToSession);
  },

  // ==========================================
  // PARTITE (tabella 'partite')
  // ==========================================

  /**
   * Legge l'elenco partite dalla tabella 'partite' di Supabase
   */
  async getPartite(): Promise<any[]> {
    const client = getSupabaseClient();
    if (!client) return [];

    const { data, error } = await client
      .from("partite")
      .select("*");

    if (error) {
      throw new Error(`Errore lettura partite da Supabase: ${error.message}`);
    }

    return Array.isArray(data) ? data : [];
  },

  /**
   * Sincronizza l'intero elenco partite su Supabase nella tabella 'partite'
   */
  /**
   * Sincronizza l'intero elenco partite su Supabase nella tabella 'partite'
   */
  async savePartiteRows(rows: PartitaItem[]): Promise<void> {
    const client = getSupabaseClient();
    if (!client) return;

    // Cancella le righe precedenti e reinserisce quelle aggiornate
    try {
      await client.from("partite").delete().gte("id", 0);
    } catch { /* ignore */ }

    if (rows.length > 0) {
      const { error } = await client.from("partite").insert(rows);
      if (error) {
        throw new Error(`Errore inserimento partite su Supabase: ${error.message}`);
      }
    }
  },

  /**
   * Elimina una singola partita dalla tabella 'partite' di Supabase
   */
  async deletePartita(matchName: string, rawLine?: string): Promise<void> {
    const client = getSupabaseClient();
    if (!client || !matchName) return;

    try {
      const { error } = await client.from("partite").delete().eq("partita", matchName);
      if (error && rawLine) {
        await client.from("partite").delete().eq("raw_line", rawLine);
      }
    } catch { /* ignore */ }
  },

  /**
   * Elimina tutte le partite dalla tabella 'partite'
   */
  async clearPartite(): Promise<void> {
    const client = getSupabaseClient();
    if (!client) return;
    try {
      await client.from("partite").delete().gte("id", 0);
    } catch { /* ignore */ }
  },

  // Retrocompatibilità per rawMatches
  async getLatestRawMatches(): Promise<RawMatchesList | null> {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data } = await client.from("partite").select("*");
    if (!data || data.length === 0) return null;
    const rawText = formatPartiteToTSV(data);
    return { rawText, createdAt: new Date().toISOString() };
  },

  async saveRawMatches(rawText: string): Promise<RawMatchesList> {
    // Sincronizzato direttamente con la tabella partite
    return { rawText, createdAt: new Date().toISOString() };
  },

  // Retrocompatibilità per settings Masaniello
  async saveSettings(s: { initial_bankroll: number; total_events_n: number; expected_events_k: number; average_odds: number }) {
    return {
      id: 1,
      initialBankroll: s.initial_bankroll,
      totalEventsN: s.total_events_n,
      expectedEventsK: s.expected_events_k,
      averageOdds: s.average_odds,
      createdAt: new Date().toISOString(),
    };
  },

  // ==========================================
  // PROMPT DI ANALISI (gestiti in locale senza fetch)
  // ==========================================
  async getAnalysisPrompt(): Promise<AnalysisPromptSetting | null> {
    try {
      const p = localStorage.getItem(ANALYSIS_PROMPT_STORAGE_KEY) || "";
      return p ? { prompt: p, updatedAt: new Date().toISOString() } : null;
    } catch {
      return null;
    }
  },

  async saveAnalysisPrompt(prompt: string): Promise<AnalysisPromptSetting> {
    try {
      localStorage.setItem(ANALYSIS_PROMPT_STORAGE_KEY, prompt);
    } catch { /* ignore */ }
    return { prompt, updatedAt: new Date().toISOString() };
  },

  async getSingleAnalysisPrompt(): Promise<AnalysisPromptSetting | null> {
    try {
      const p = localStorage.getItem(SINGLE_ANALYSIS_PROMPT_STORAGE_KEY) || "";
      return p ? { prompt: p, updatedAt: new Date().toISOString() } : null;
    } catch {
      return null;
    }
  },

  async saveSingleAnalysisPrompt(prompt: string): Promise<AnalysisPromptSetting> {
    try {
      localStorage.setItem(SINGLE_ANALYSIS_PROMPT_STORAGE_KEY, prompt);
    } catch { /* ignore */ }
    return { prompt, updatedAt: new Date().toISOString() };
  },

  // ==========================================
  // ANALISI GEMINI AI (diretta in-browser senza fetch Netlify)
  // ==========================================
  async analyzeMatches(matches: string, prompt?: string, signal?: AbortSignal): Promise<AnalyzeMatchesResponse> {
    try {
      const output = await analyzeMatchesDirect(matches, prompt || "", signal);
      return { output };
    } catch (err: any) {
      return { error: err?.message || "Errore durante l'analisi con Gemini AI" };
    }
  },

  async analyzeSingleMatch(matchData: SingleMatchData, prompt?: string, signal?: AbortSignal): Promise<AnalyzeMatchesResponse> {
    try {
      const output = await analyzeSingleMatchDirect(matchData, prompt, signal);
      return { output };
    } catch (err: any) {
      return { error: err?.message || "Errore durante l'analisi della singola partita con Gemini AI" };
    }
  },
};
