import React, { useState, useEffect, useMemo, useRef } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api, type MasanielloSession, type SessionState } from './lib/api';
import {
  Trophy,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Play,
  Download,
  Copy,
  Check,
  Calculator,
  TrendingUp,
  Coins,
  Target,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  ArrowLeft,
  Info,
  Clock,
  Percent,
  Layers,
  ChevronRight,
  RefreshCw,
  FileCode,
  ClipboardList,
  Plus,
  Trash2,
  X,
  Cloud,
  CloudOff,
  Save,
  KeyRound,
  Loader2,
  FolderArchive,
  Search,
  Calendar,
  FileDown,
  Lock,
  Settings,
} from 'lucide-react';
import {
  getSupabaseConfig,
  setSupabaseConfig,
  isSupabaseConfigured,
  initSupabaseClient,
  getSupabaseClient,
} from './supabaseClient';

export interface MasanielloEvent {
  id: number;
  date?: string;
  time?: string;
  match: string;
  market: string;
  probability?: number | null;
  probabilityRaw?: string;
  valueEdge?: string;
  competition?: string;
  odds: number;
  status: 'pending' | 'won' | 'lost';
  placedStake?: number;
}


export interface MasanielloConfig {
  initialBankroll: number;
  totalEvents: number;
  expectedWins: number;
  averageOdds: number;
}

export interface ParsedMatchItem {
  id: number;
  date: string;
  time: string;
  market: string;
  probability: number | null;
  probabilityRaw: string;
  match: string;
  competition: string;
  odds: number;
  valueEdge: string;
  rawLine?: string;
}

// Estrae la probabilità numerica (percentuale 0-100) da stringhe tipo "65.4%", "65,4%", "65", "0.65"
function parseProbability(raw: string | undefined): number | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.replace('%', '').replace(',', '.').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  if (num > 0 && num <= 1) return num * 100;
  return num;
}

// Helper per il parsing dell'elenco partite inserito nella pagina "Elenco Partite"
// Supporta il formato TSV: Data [TAB] Ora inizio [TAB] Segno [TAB] Probabilità [TAB] Partita [TAB] Competizione (Nazione) [TAB] Quota Book [TAB] Value Edge
function parseMatchesList(rawText: string): ParsedMatchItem[] {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const results: ParsedMatchItem[] = [];

  lines.forEach((line, idx) => {
    // Dividi per TAB reale (\t) o tabulazioni/spazi multipli
    let parts: string[] = [];
    if (line.includes('\t')) {
      parts = line.split('\t').map(s => s.trim());
    } else {
      parts = line.split(/\s{2,}/).map(s => s.trim());
    }

    // Salta l'eventuale riga di intestazione (es. Data\tOra inizio\tSegno...)
    if (idx === 0) {
      const p0 = (parts[0] || '').toLowerCase();
      const p1 = (parts[1] || '').toLowerCase();
      if (p0 === 'data' || p0 === 'date' || p1.includes('ora') || p1.includes('inizio') || line.toLowerCase().includes('probabilit')) {
        return;
      }
    }

    let date = '';
    let time = '';
    let market = '';
    let probabilityRaw = '';
    let probability: number | null = null;
    let match = '';
    let competition = '';
    let odds = 1.60;
    let valueEdge = '';

    if (parts.length >= 7) {
      // Formato TSV completo: Data | Ora | Segno | Probabilità | Partita | Competizione | Quota Book | Value Edge
      date = parts[0] || '';
      time = parts[1] || '';
      market = parts[2] || '';
      probabilityRaw = parts[3] || '';
      probability = parseProbability(probabilityRaw);
      match = parts[4] || '';
      competition = parts[5] || '';
      const parsedOdds = parseFloat((parts[6] || '').replace(',', '.'));
      if (!isNaN(parsedOdds) && parsedOdds > 1) {
        odds = parsedOdds;
      }
      valueEdge = parts[7] || '';
    } else if (parts.length >= 4) {
      // Formato retrocompatibile a 4 colonne (es. Ora, Partita, Segno, Quota)
      const isFirstTime = /^\d{1,2}[:.]\d{2}$/.test(parts[0]);
      if (isFirstTime) {
        time = parts[0];
        match = parts[1];
        market = parts[2];
        const parsedOdds = parseFloat((parts[3] || '').replace(',', '.'));
        if (!isNaN(parsedOdds) && parsedOdds > 1) odds = parsedOdds;
      } else {
        date = parts[0];
        time = parts[1];
        match = parts[2];
        const parsedOdds = parseFloat((parts[3] || '').replace(',', '.'));
        if (!isNaN(parsedOdds) && parsedOdds > 1) odds = parsedOdds;
      }
    } else if (parts.length === 3) {
      const isFirstTime = /^\d{1,2}[:.]\d{2}$/.test(parts[0]);
      if (isFirstTime) {
        time = parts[0];
        match = parts[1];
        const parsedOdds = parseFloat((parts[2] || '').replace(',', '.'));
        if (!isNaN(parsedOdds) && parsedOdds > 1) odds = parsedOdds;
      } else {
        match = parts[0];
        market = parts[1];
        const parsedOdds = parseFloat((parts[2] || '').replace(',', '.'));
        if (!isNaN(parsedOdds) && parsedOdds > 1) odds = parsedOdds;
      }
    } else {
      match = line;
    }

    // Normalizza il segno per corrispondere ai valori tipici (O1.5, O2.5, U2.5, U3.5)
    let cleanMarket = market.toUpperCase().replace(/\s+/g, '');
    if (cleanMarket === 'OVER1.5' || cleanMarket === 'OVER1,5') cleanMarket = 'O1.5';
    if (cleanMarket === 'OVER2.5' || cleanMarket === 'OVER2,5') cleanMarket = 'O2.5';
    if (cleanMarket === 'UNDER2.5' || cleanMarket === 'UNDER2,5') cleanMarket = 'U2.5';
    if (cleanMarket === 'UNDER3.5' || cleanMarket === 'UNDER3,5') cleanMarket = 'U3.5';

    results.push({
      id: results.length + 1,
      date: date || '',
      time: time || '--:--',
      market: cleanMarket || market,
      probability,
      probabilityRaw: probabilityRaw || (probability !== null ? `${probability.toFixed(1)}%` : ''),
      match: match || `Partita #${results.length + 1}`,
      competition: competition || '',
      odds,
      valueEdge: valueEdge || '',
      rawLine: line,
    });
  });

  return results;
}

// Normalizza stringhe per confronto (minuscolo, spazi normalizzati)
function normalizeString(str: string): string {
  return (str || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Normalizza il nome della partita / squadre unificando trattini e spazi
function normalizeMatchName(str: string): string {
  if (!str) return '';
  return str
    .trim()
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-') // unifica trattini (en-dash, em-dash, minus, ecc.)
    .replace(/\s*-\s*/g, ' - ') // standardizza spazi attorno al trattino
    .replace(/\s+/g, ' ');
}

// Normalizza il segno per il confronto (es. "O2.5", "Over 2.5", "OVER 2,5")
function normalizeMarket(marketStr: string): string {
  if (!marketStr) return '';
  let s = marketStr.trim().toUpperCase().replace(/\s+/g, '').replace(',', '.');
  if (s === 'OVER1.5') return 'O1.5';
  if (s === 'OVER2.5') return 'O2.5';
  if (s === 'UNDER2.5') return 'U2.5';
  if (s === 'UNDER3.5') return 'U3.5';
  return s;
}

// Estrae i nomi delle squadre da una stringa partita (es. "Lille - Le Havre" -> ["lille", "le havre"])
function extractTeams(matchStr: string): string[] {
  if (!matchStr) return [];
  const normalized = matchStr.trim();
  if (!normalized) return [];
  const parts = normalized
    .split(/\s+(?:[-–—/]|vs\.?|v\.?)\s+|[-–—/]/i)
    .map(s => normalizeString(s))
    .filter(s => s.length > 1);
  return parts.length > 0 ? parts : [normalizeString(normalized)];
}

// Verifica se una squadra della partita (o la partita stessa) è presente nel Masaniello
function isTeamInMasaniello(matchStr: string, eventsList: MasanielloEvent[]): boolean {
  if (!matchStr || !matchStr.trim()) return false;
  // Non considerare i placeholder vuoti tipo "Partita #1"
  if (/^partita\s*#?\d+$/i.test(matchStr.trim())) return false;
  if (/^evento\s*#?\d+$/i.test(matchStr.trim())) return false;

  const matchTeams = extractTeams(matchStr);
  const matchNorm = normalizeMatchName(matchStr);

  for (const ev of eventsList) {
    if (!ev || !ev.match || !ev.match.trim()) continue;
    if (/^partita\s*#?\d+$/i.test(ev.match.trim())) continue;
    if (/^evento\s*#?\d+$/i.test(ev.match.trim())) continue;

    const evNorm = normalizeMatchName(ev.match);
    if (matchNorm && evNorm && matchNorm === evNorm) {
      return true;
    }

    const evTeams = extractTeams(ev.match);
    for (const mt of matchTeams) {
      if (mt.length < 2) continue;
      for (const et of evTeams) {
        if (et.length < 2) continue;
        if (mt === et) {
          return true;
        }
      }
    }
  }

  return false;
}

// Restituisce la classe di colore del carattere in base a:
// 1) Se una squadra è presente nel Masaniello -> ROSSO
// 2) Probabilità < 62% -> GRIGIO
// 3) Probabilità 62% - 64% -> BIANCO
// 4) Probabilità > 64% e <= 66% -> GIALLO
// 5) Probabilità > 66% e <= 68% -> AZZURRO
// 6) Probabilità > 68% -> VERDE
// 7) Non espressa -> BIANCO (default)
function getMatchColorInfo(
  matchItem: ParsedMatchItem,
  eventsList: MasanielloEvent[]
): {
  textColorClass: string;
  colorName: 'red' | 'gray' | 'white' | 'yellow' | 'azzurro' | 'green';
  isInMasaniello: boolean;
} {
  const isPresentInMasa = isTeamInMasaniello(matchItem.match, eventsList);
  if (isPresentInMasa) {
    return {
      textColorClass: 'text-red-500 font-semibold',
      colorName: 'red',
      isInMasaniello: true,
    };
  }

  const p = matchItem.probability;
  if (p === null || p === undefined || isNaN(p)) {
    return {
      textColorClass: 'text-white',
      colorName: 'white',
      isInMasaniello: false,
    };
  }

  if (p < 62) {
    return {
      textColorClass: 'text-slate-400',
      colorName: 'gray',
      isInMasaniello: false,
    };
  }
  if (p <= 64) {
    return {
      textColorClass: 'text-white',
      colorName: 'white',
      isInMasaniello: false,
    };
  }
  if (p <= 66) {
    return {
      textColorClass: 'text-yellow-400 font-medium',
      colorName: 'yellow',
      isInMasaniello: false,
    };
  }
  if (p <= 68) {
    return {
      textColorClass: 'text-sky-400 font-medium',
      colorName: 'azzurro',
      isInMasaniello: false,
    };
  }
  return {
    textColorClass: 'text-emerald-400 font-medium',
    colorName: 'green',
    isInMasaniello: false,
  };
}

// Accorcia e formatta la data a GG/MM/AA
function formatDateShort(rawDate: string | undefined): string {
  if (!rawDate || !rawDate.trim()) return '';
  const d = rawDate.trim();
  const match = d.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3].length === 4 ? match[3].slice(-2) : match[3];
    return `${day}/${month}/${year}`;
  }
  return d;
}

// Formatta l'ora a OO:MM
function formatTimeShort(rawTime: string | undefined): string {
  if (!rawTime || !rawTime.trim()) return '';
  const t = rawTime.trim();
  const match = t.match(/^(\d{1,2})[:\.](\d{2})$/);
  if (match) {
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }
  return t;
}

// Calcola il Value Edge in percentuale: (Probabilità% * Quota) - 100%
// Si ricalcola dinamicamente in tempo reale al variare della quota
function calculateEventValueEdge(probability: number | null | undefined, odds: number): string {
  if (probability === null || probability === undefined || isNaN(probability) || probability <= 0 || !odds || isNaN(odds) || odds <= 1) {
    return '—';
  }
  const edge = (probability * odds) - 100;
  const sign = edge > 0 ? '+' : '';
  return `${sign}${edge.toFixed(1)}%`;
}

// Parsa una data e un'ora (supporta GG/MM/AA, GG/MM/AAAA, AAAA-MM-GG con ore OO:MM o OO.MM) in timestamp ms per confronto
function parseDateTimeToTimestamp(dateStr: string, timeStr: string): number | null {
  if (!dateStr || !dateStr.trim()) return null;
  const d = dateStr.trim();
  const t = (timeStr || '00:00').trim().replace('.', ':');

  let day = 0, month = 0, year = 0;

  // Pattern 1: DD/MM/YYYY o DD/MM/YY (o con - o .)
  const itMatch = d.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (itMatch) {
    day = parseInt(itMatch[1], 10);
    month = parseInt(itMatch[2], 10);
    let y = parseInt(itMatch[3], 10);
    if (y < 100) y += 2000;
    year = y;
  } else {
    // Pattern 2: YYYY-MM-DD
    const isoMatch = d.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
    if (isoMatch) {
      year = parseInt(isoMatch[1], 10);
      month = parseInt(isoMatch[2], 10);
      day = parseInt(isoMatch[3], 10);
    } else {
      return null;
    }
  }

  let hours = 0, minutes = 0;
  const tMatch = t.match(/^(\d{1,2})[:\.](\d{2})/);
  if (tMatch) {
    hours = parseInt(tMatch[1], 10);
    minutes = parseInt(tMatch[2], 10);
  }

  return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
}

const STORAGE_KEY = 'masaniello_calculator_state_v3';
const MATCHES_LIST_STORAGE_KEY = 'masaniello_matches_list_raw';
const ROUND_STAKES_KEY = 'masaniello_round_stakes';
const SYNC_CODE_KEY = 'masaniello_sync_code';
const TITLE_STORAGE_KEY = 'masaniello_active_title';
const SESSIONS_HISTORY_KEY = 'masaniello_sessions_history';
// Formatta il titolo predefinito nel formato "Masa [GG-MM-AA]" (es. "Masa 11-10-26")
function getDefaultTitle(date: Date = new Date()): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `Masa ${day}-${month}-${year}`;
}

// Salva/aggiorna la sessione nella cronologia locale per disponibilità immediata e offline
function updateLocalSessionsCache(session: MasanielloSession) {
  try {
    const raw = localStorage.getItem(SESSIONS_HISTORY_KEY);
    let list: MasanielloSession[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    const idx = list.findIndex(s => s.code.toUpperCase() === session.code.toUpperCase());
    if (idx >= 0) {
      list[idx] = session;
    } else {
      list.unshift(session);
    }
    if (list.length > 50) list = list.slice(0, 50);
    localStorage.setItem(SESSIONS_HISTORY_KEY, JSON.stringify(list));
  } catch {
    // quota
  }
}

type SyncStatus = 'loading' | 'idle' | 'pending' | 'saving' | 'saved' | 'error';

// Short, easy-to-type code (no ambiguous characters like 0/O, 1/I)
function generateSyncCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

// Calcolo della probabilità di vincita (distribuzione Poisson-Binomiale)
// Restituisce la probabilità esatta di raggiungere ALMENO targetWins vittorie
function calculateWinProbability(oddsList: number[], targetWins: number): number {
  if (targetWins <= 0) return 1.0;
  if (targetWins > oddsList.length) return 0.0;

  let dp = [1.0];
  for (let i = 0; i < oddsList.length; i++) {
    const q = Math.max(1.0001, oddsList[i]);
    const p = 1.0 / q;
    const nextDp = new Array(dp.length + 1).fill(0);
    nextDp[0] = dp[0] * (1.0 - p);
    for (let w = 1; w <= dp.length; w++) {
      const prevWin = dp[w - 1] || 0;
      const prevLoss = dp[w] || 0;
      nextDp[w] = prevLoss * (1.0 - p) + prevWin * p;
    }
    dp = nextDp;
  }

  let totalProb = 0;
  for (let w = targetWins; w < dp.length; w++) {
    totalProb += dp[w];
  }
  return totalProb;
}

// Calcolo teorico della vincita potenziale per la progressione Masaniello
// Data cassa iniziale C0, totale eventi N, eventi attesi K e quota media Q:
// Vincita Finale = C0 / P(successo)
// Per C0 = 100, N = 20, K = 11, Q = 1.60: P = 82,288%, Vincita = € 121,52, Resa = 21,52%
function calculatePotentialPayout(
  initialBankroll: number,
  totalEvents: number,
  expectedWins: number,
  averageOdds: number
): number {
  if (initialBankroll <= 0 || expectedWins <= 0 || expectedWins > totalEvents) return 0;
  const oddsList = new Array(totalEvents).fill(Math.max(1.0001, averageOdds));
  const prob = calculateWinProbability(oddsList, expectedWins);
  if (prob <= 0) return 0;
  return initialBankroll / prob;
}

// Calcolo esatto dello Stake all'evento k secondo il modello matematico Masaniello:
// Nr: Eventi rimanenti
// Ur: Eventi attesi rimanenti
// Qk: Quota evento corrente
// Ck: Cassa attuale disponibile
// futureOdds: Quote degli eventi futuri rimanenti
// Lo stake replica esattamente il valore atteso della cassa:
// Stake = Ck * (P_win - P_loss) / [ Qk * P_cur ]
// Per C1 = 100, N = 20, K = 11, Q = 1.60: Stake 1 = € 9,36
function calculateStake(
  currentBankroll: number,
  eventOdds: number,
  remainingWins: number,
  remainingEventsCount: number,
  futureOdds?: number[]
): number {
  // Condizioni Limite:
  if (currentBankroll <= 0 || remainingWins <= 0) return 0;
  if (remainingWins > remainingEventsCount) return 0;

  // Se dobbiamo vincere TUTTI gli eventi rimanenti (Ur === Nr):
  if (remainingWins === remainingEventsCount) {
    return Math.round(currentBankroll * 100) / 100;
  }

  const q = Math.max(1.0001, eventOdds);
  const future = (futureOdds && futureOdds.length === remainingEventsCount - 1)
    ? futureOdds
    : new Array(remainingEventsCount - 1).fill(q);

  const pWin = calculateWinProbability(future, remainingWins - 1);
  const pLoss = calculateWinProbability(future, remainingWins);
  const pCur = (1.0 / q) * pWin + (1.0 - 1.0 / q) * pLoss;
  if (pCur <= 0) return 0;

  const stake = currentBankroll * (pWin - pLoss) / (q * pCur);
  return Math.round(stake * 100) / 100;
}

export default function App() {
  // Navigation state ('masaniello' or 'elenco_partite')
  const [currentPage, setCurrentPage] = useState<'masaniello' | 'elenco_partite'>('masaniello');

  // Config state
  const [config, setConfig] = useState<MasanielloConfig>({
    initialBankroll: 100,
    totalEvents: 20,
    expectedWins: 11,
    averageOdds: 1.60,
  });

  // Events list
  const [events, setEvents] = useState<MasanielloEvent[]>([]);
  const [showResetModal, setShowResetModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Round stakes toggle state (persisted, default true / switch ON)
  const [roundStakes, setRoundStakes] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(ROUND_STAKES_KEY);
      if (stored !== null) {
        return stored === 'true';
      }
      return true; // default ON
    } catch {
      return true;
    }
  });

  // Titolo editabile del Masaniello attivo (default "Masa [GG-MM-AA]")
  const [title, setTitle] = useState<string>(() => {
    try {
      return localStorage.getItem(TITLE_STORAGE_KEY) || getDefaultTitle();
    } catch {
      return getDefaultTitle();
    }
  });

  // Elenco partite raw text (persisted across pages and browser sessions)
  const [matchesListText, setMatchesListText] = useState<string>(() => {
    try {
      return localStorage.getItem(MATCHES_LIST_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  // Popup modal state: target event index for match import (null when modal is closed)
  const [importTargetIndex, setImportTargetIndex] = useState<number | null>(null);

  // Parsed matches from the text in Elenco Partite
  const parsedMatches = useMemo(() => {
    return parseMatchesList(matchesListText);
  }, [matchesListText]);

  // Tab di visualizzazione nella pagina Elenco Partite: 'table' (anteprima colorata) o 'text' (incolla TSV)
  const [matchesViewTab, setMatchesViewTab] = useState<'table' | 'text'>('table');

  // Finestra "Elimina partite prima di" (Data e Ora limite)
  const [showDeleteBeforeModal, setShowDeleteBeforeModal] = useState(false);
  const [deleteBeforeDate, setDeleteBeforeDate] = useState('');
  const [deleteBeforeTime, setDeleteBeforeTime] = useState('');

  // Modale e configurazione Supabase dinamica da localStorage
  const [showSupabaseModal, setShowSupabaseModal] = useState(false);
  const [supabaseUrlInput, setSupabaseUrlInput] = useState('');
  const [supabaseKeyInput, setSupabaseKeyInput] = useState('');
  const [supabaseConfigError, setSupabaseConfigError] = useState('');

  // Stato copia TSV per le partite nell'Elenco Partite
  const [copiedMatchId, setCopiedMatchId] = useState<number | null>(null);
  // Stato feedback copia TSV per le partite nella Home (Masaniello)
  const [copiedMasaTSV, setCopiedMasaTSV] = useState(false);

  // Funzione per copiare i dati della singola partita in formato TSV con un TAB reale tra i campi
  const handleCopyMatchTSV = async (m: ParsedMatchItem) => {
    const prob = m.probabilityRaw || (m.probability !== null ? `${m.probability.toFixed(1)}%` : '');
    const oddsStr = m.odds ? m.odds.toFixed(2) : '';
    const timeStr = m.time && m.time !== '--:--' ? m.time : '';
    const tsvLine = [
      m.date || '',
      timeStr,
      m.market || '',
      prob,
      m.match || '',
      m.competition || '',
      oddsStr,
      m.valueEdge || '',
    ].join('\t');

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(tsvLine);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = tsvLine;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedMatchId(m.id);
      setTimeout(() => {
        setCopiedMatchId((prev) => (prev === m.id ? null : prev));
      }, 1500);
    } catch (err) {
      console.error('Failed to copy match TSV:', err);
    }
  };

  // Funzione per copiare tutti i dati delle partite del Masaniello in formato TSV negli appunti
  // Campi: [Data][TAB][Ora][TAB][Segno][TAB][Probabilità%][TAB][Squadra A - Squadra B][TAB][Competizione][TAB][Quota][TAB][Value Edge%][TAB]V/P
  const handleCopyMasanielloTSV = async () => {
    const activeEvents = progression.evaluatedEvents.filter(ev =>
      (ev.match && ev.match.trim().length > 0) ||
      (ev.date && ev.date.trim().length > 0) ||
      (ev.time && ev.time.trim().length > 0) ||
      (ev.market && ev.market.trim().length > 0) ||
      ev.status !== 'pending'
    );
    const eventsToExport = activeEvents.length > 0 ? activeEvents : progression.evaluatedEvents;

    const lines = eventsToExport.map(ev => {
      // 1. Data
      const dateStr = ev.date || '';

      // 2. Ora
      const timeStr = ev.time && ev.time !== '--:--' ? ev.time : (ev.time || '');

      // 3. Segno
      const marketStr = ev.market || '';

      // 4. Probabilità%
      let probStr = '';
      if (ev.probability !== null && ev.probability !== undefined && !isNaN(ev.probability)) {
        probStr = `${ev.probability.toFixed(1)}%`;
      } else if (ev.probabilityRaw) {
        probStr = ev.probabilityRaw.includes('%') ? ev.probabilityRaw : `${ev.probabilityRaw}%`;
      }

      // 5. Squadra A - Squadra B
      const matchStr = ev.match || '';

      // 6. Competizione (se non salvata sull'evento, cerca da parsedMatches)
      let competitionStr = ev.competition || '';
      if (!competitionStr && matchStr) {
        const normEv = normalizeMatchName(matchStr);
        const found = parsedMatches.find(m => {
          const normM = normalizeMatchName(m.match);
          return normM === normEv || (normM && normEv && (normM.includes(normEv) || normEv.includes(normM)));
        });
        if (found && found.competition) {
          competitionStr = found.competition;
        }
      }

      // 7. Quota
      const oddsStr = ev.odds ? ev.odds.toFixed(2) : '';

      // 8. Value Edge%
      let edgeStr = '';
      const calcEdge = calculateEventValueEdge(ev.probability, ev.odds);
      if (calcEdge && calcEdge !== '—') {
        edgeStr = calcEdge;
      } else if (ev.valueEdge && ev.valueEdge !== '—') {
        edgeStr = ev.valueEdge;
      }

      // 9. V/P
      let outcomeStr = '';
      if (ev.status === 'won') outcomeStr = 'V';
      else if (ev.status === 'lost') outcomeStr = 'P';

      return [
        dateStr,
        timeStr,
        marketStr,
        probStr,
        matchStr,
        competitionStr,
        oddsStr,
        edgeStr,
        outcomeStr,
      ].join('\t');
    });

    const tsvContent = lines.join('\n');

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(tsvContent);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = tsvContent;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedMasaTSV(true);
      setTimeout(() => {
        setCopiedMasaTSV(false);
      }, 1500);
    } catch (err) {
      console.error('Failed to copy Masaniello TSV:', err);
    }
  };


  // Helper to format currency/stake based on roundStakes toggle
  const formatStake = (val: number): string => {
    if (roundStakes) {
      return Math.round(val).toString();
    }
    return val.toFixed(2);
  };

  // ---- Cloud sync (Netlify Database) ----
  // The whole state is saved under a sync code; any device that opens the site
  // loads the latest saved state (or the one for its code / ?code= in the URL).
  const [syncCode, setSyncCode] = useState<string>('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('loading');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string>('');
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [copiedSyncCode, setCopiedSyncCode] = useState(false);
  const hydratedRef = useRef(false);
  const lastSyncedJsonRef = useRef<string>('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modale Elenco Masanielli e conferma caricamento
  const [showSessionsListModal, setShowSessionsListModal] = useState(false);
  const [sessionsList, setSessionsList] = useState<MasanielloSession[]>([]);
  const [loadingSessionsList, setLoadingSessionsList] = useState(false);
  const [sessionsListError, setSessionsListError] = useState('');
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [confirmSessionToLoad, setConfirmSessionToLoad] = useState<MasanielloSession | null>(null);

  const currentState = (): SessionState => ({
    title,
    config,
    events,
    roundStakes,
    matchesListText,
  });

  const applyRemoteState = (state: SessionState, remoteTitle?: string | null) => {
    if (remoteTitle) {
      setTitle(remoteTitle);
      try { localStorage.setItem(TITLE_STORAGE_KEY, remoteTitle); } catch { /* ignore */ }
    } else if (state.title) {
      setTitle(state.title);
      try { localStorage.setItem(TITLE_STORAGE_KEY, state.title); } catch { /* ignore */ }
    } else {
      const fallbackTitle = getDefaultTitle();
      setTitle(fallbackTitle);
      try { localStorage.setItem(TITLE_STORAGE_KEY, fallbackTitle); } catch { /* ignore */ }
    }
    if (state.config) setConfig(state.config);
    if (Array.isArray(state.events) && state.events.length > 0) setEvents(state.events as MasanielloEvent[]);
    if (typeof state.roundStakes === 'boolean') setRoundStakes(state.roundStakes);
    if (typeof state.matchesListText === 'string') setMatchesListText(state.matchesListText);
  };

  const adoptCode = (code: string) => {
    setSyncCode(code);
    try { localStorage.setItem(SYNC_CODE_KEY, code); } catch { /* ignore */ }
    const url = new URL(window.location.href);
    if (url.searchParams.get('code') !== code) {
      url.searchParams.set('code', code);
      window.history.replaceState(null, '', url.toString());
    }
  };

  const applySession = (session: MasanielloSession) => {
    lastSyncedJsonRef.current = JSON.stringify(session.state);
    applyRemoteState(session.state, session.title);
    adoptCode(session.code);
    setLastSyncedAt(session.updatedAt);
    setSyncStatus('saved');
    setSyncError('');
    updateLocalSessionsCache(session);
  };

  const saveNow = async (state: SessionState = currentState(), code: string = syncCode, activeTitle: string = title) => {
    if (!code || !state.events.length) return;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    
    const resolvedTitle = activeTitle.trim() || state.title || getDefaultTitle();
    const stateToSave: SessionState = { ...state, title: resolvedTitle };
    const json = JSON.stringify(stateToSave);
    
    setSyncStatus('saving');
    try {
      // 1. Salva nel database (tabella masaniello_sessions con code, title e state)
      const saved = await api.saveSession(code, stateToSave, resolvedTitle);
      lastSyncedJsonRef.current = json;
      setLastSyncedAt(saved.updatedAt);
      setSyncStatus('saved');
      setSyncError('');
      updateLocalSessionsCache(saved);

      // 2. Aggiorna tabella PostgreSQL masaniello_settings con i parametri attuali
      api.saveSettings({
        initial_bankroll: stateToSave.config.initialBankroll,
        total_events_n: stateToSave.config.totalEvents,
        expected_events_k: stateToSave.config.expectedWins,
        average_odds: stateToSave.config.averageOdds,
      }).catch(err => {
        console.warn('Errore salvataggio masaniello_settings:', err);
      });

      // 3. Aggiorna tabella PostgreSQL raw_matches_list se presente testo partite
      if (stateToSave.matchesListText && stateToSave.matchesListText.trim()) {
        api.saveRawMatches(stateToSave.matchesListText).catch(err => {
          console.warn('Errore salvataggio raw_matches_list:', err);
        });
      }
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err instanceof Error ? err.message : 'Errore di salvataggio');
    }
  };

  // Interroga il database e mostra la lista di tutti i Masanielli salvati in precedenza,
  // ordinati rigorosamente dal più recente al più vecchio in base alla data/ora di salvataggio
  const handleOpenSessionsList = async () => {
    setShowSessionsListModal(true);
    setLoadingSessionsList(true);
    setSessionsListError('');
    try {
      const remoteSessions = await api.getAllSessions().catch(() => []);
      
      let localSessions: MasanielloSession[] = [];
      try {
        const raw = localStorage.getItem(SESSIONS_HISTORY_KEY);
        if (raw) localSessions = JSON.parse(raw);
      } catch { /* ignore */ }

      const map = new Map<string, MasanielloSession>();
      for (const s of localSessions) {
        if (s && s.code) map.set(s.code.toUpperCase(), s);
      }
      for (const s of remoteSessions) {
        if (s && s.code) map.set(s.code.toUpperCase(), s);
      }

      // Se la sessione corrente non è ancora nella lista, aggiungila
      if (syncCode) {
        const existing = map.get(syncCode.toUpperCase());
        map.set(syncCode.toUpperCase(), {
          code: syncCode.toUpperCase(),
          title: title || existing?.title || getDefaultTitle(),
          state: currentState(),
          updatedAt: lastSyncedAt || new Date().toISOString(),
        });
      }

      // Ordinamento Inverso: lista ordinata rigorosamente dal più recente al più vecchio (updatedAt DESC)
      const sorted = Array.from(map.values()).sort((a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return timeB - timeA;
      });

      setSessionsList(sorted);
    } catch {
      setSessionsListError('Errore durante il recupero dei Masanielli.');
    } finally {
      setLoadingSessionsList(false);
    }
  };

  // Pull the latest version of the current code from the server
  const pullFromServer = async () => {
    if (!syncCode) return;
    setSyncStatus('loading');
    try {
      applySession(await api.getSession(syncCode));
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err instanceof Error ? err.message : 'Errore di sincronizzazione');
    }
  };

  const loadByCode = async (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    setSyncStatus('loading');
    try {
      applySession(await api.getSession(code));
      setShowSyncModal(false);
      setCodeInput('');
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err instanceof Error && err.message !== 'Code not found' ? err.message : `Codice "${code}" non trovato`);
    }
  };

  // Apre la modale di configurazione Supabase popolando i campi con i valori attuali dal localStorage
  const handleOpenSupabaseModal = () => {
    const creds = getSupabaseConfig();
    setSupabaseUrlInput(creds.url);
    setSupabaseKeyInput(creds.key);
    setSupabaseConfigError('');
    setShowSupabaseModal(true);
  };

  // Ricarica i dati dell'applicazione dal server / database
  const reloadAppData = async () => {
    const urlCode = new URLSearchParams(window.location.search).get('code')?.trim().toUpperCase() || '';
    let storedCode = '';
    try { storedCode = localStorage.getItem(SYNC_CODE_KEY) || ''; } catch { /* ignore */ }
    const preferredCode = urlCode || storedCode || syncCode;

    setSyncStatus('loading');
    try {
      let session: MasanielloSession | null = null;
      if (preferredCode) {
        session = await api.getSession(preferredCode).catch(err => {
          if (err instanceof Error && err.message === 'Code not found') return null;
          throw err;
        });
      }
      if (!session && !urlCode) {
        session = await api.getLatestSession().catch(() => null);
      }
      if (session) {
        applySession(session);
        return;
      }
      setSyncStatus('idle');
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err instanceof Error ? err.message : 'Errore nel ricaricamento dei dati');
    }
  };

  // Salva la configurazione Supabase nel localStorage, reinizializza il client e ricarica i dati
  const handleSaveSupabaseConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSupabaseConfigError('');
    const cleanUrl = supabaseUrlInput.trim();
    const cleanKey = supabaseKeyInput.trim();

    if (!cleanUrl || !cleanKey) {
      setSupabaseConfigError('Compila entrambi i campi obbligatori (*)');
      return;
    }

    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      setSupabaseConfigError("L'URL di Supabase deve iniziare con https:// (es. https://xyzcompany.supabase.co)");
      return;
    }

    // 1. Salva valori nel localStorage
    setSupabaseConfig(cleanUrl, cleanKey);
    // 2. Chiudi la modale
    setShowSupabaseModal(false);
    // 3. Reinizializza il client Supabase
    initSupabaseClient(cleanUrl, cleanKey);
    // 4. Ricarica i dati dell'applicazione
    await reloadAppData();
  };

  // All'avvio dell'app: se i valori nel localStorage non sono presenti o sono vuoti,
  // apri automaticamente la modale di configurazione per impedire all'app di bloccarsi.
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      const creds = getSupabaseConfig();
      setSupabaseUrlInput(creds.url);
      setSupabaseKeyInput(creds.key);
      setShowSupabaseModal(true);
    }
  }, []);

  // Set browser document title
  useEffect(() => {
    document.title = 'Masaniello SamSte';
  }, []);

  // Load on mount: server first, localStorage only as offline fallback
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const urlCode = new URLSearchParams(window.location.search).get('code')?.trim().toUpperCase() || '';
      let storedCode = '';
      try { storedCode = localStorage.getItem(SYNC_CODE_KEY) || ''; } catch { /* ignore */ }
      const preferredCode = urlCode || storedCode;

      try {
        let session: MasanielloSession | null = null;
        if (preferredCode) {
          session = await api.getSession(preferredCode).catch(err => {
            if (err instanceof Error && err.message === 'Code not found') return null;
            throw err;
          });
        }
        if (!session && !urlCode) session = await api.getLatestSession();
        if (cancelled) return;
        if (session) {
          applySession(session);
          hydratedRef.current = true;
          return;
        }
        setSyncStatus('idle');
      } catch (err) {
        if (cancelled) return;
        setSyncStatus('error');
        setSyncError(err instanceof Error ? err.message : 'Server non raggiungibile');
      }

      // Nothing on the server yet (or offline / pagina pulita): use local cache or defaults
      adoptCode(preferredCode || generateSyncCode());
      const initialTitle = getDefaultTitle();
      setTitle(initialTitle);
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        const parsed = saved ? JSON.parse(saved) : null;
        if (parsed?.config && Array.isArray(parsed.events) && parsed.events.length > 0) {
          setConfig(parsed.config);
          setEvents(parsed.events);
          if (typeof parsed.roundStakes === 'boolean') setRoundStakes(parsed.roundStakes);
        } else {
          initializeEvents(20, 1.60);
        }
      } catch {
        initializeEvents(20, 1.60);
      }
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-save to the server (debounced) and keep a local offline copy
  useEffect(() => {
    if (!hydratedRef.current || events.length === 0) return;
    const state = currentState();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ config, events, roundStakes }));
      localStorage.setItem(ROUND_STAKES_KEY, String(roundStakes));
      localStorage.setItem(MATCHES_LIST_STORAGE_KEY, matchesListText);
      localStorage.setItem(TITLE_STORAGE_KEY, title);
    } catch {
      // storage quota
    }
    if (!syncCode || JSON.stringify(state) === lastSyncedJsonRef.current) return;
    setSyncStatus('pending');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { saveNow(state, syncCode, title); }, 1200);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [config, events, roundStakes, matchesListText, syncCode, title]);

  // When the tab becomes visible again (e.g. switching back on the phone),
  // fetch the latest server copy if there are no unsaved local edits
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !syncCode || !hydratedRef.current) return;
      if (JSON.stringify(currentState()) !== lastSyncedJsonRef.current) return;
      api.getSession(syncCode)
        .then(session => {
          if (JSON.stringify(session.state) !== lastSyncedJsonRef.current) applySession(session);
        })
        .catch(() => { /* keep local state */ });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  // Helper to initialize events
  function initializeEvents(count: number, defaultOdds: number) {
    const newEvents: MasanielloEvent[] = [];
    for (let i = 1; i <= count; i++) {
      newEvents.push({
        id: i,
        date: '',
        time: '',
        match: '',
        market: '',
        probability: null,
        probabilityRaw: '',
        odds: defaultOdds,
        status: 'pending',
      });
    }
    setEvents(newEvents);
  }

  // Handle generating new progression
  const handleGenerate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isProgressionActive) return;
    if (config.expectedWins > config.totalEvents) {
      return;
    }
    initializeEvents(config.totalEvents, config.averageOdds);
  };

  // Preset buttons
  const applyPreset = (total: number, wins: number, odds: number) => {
    if (isProgressionActive) return;
    const newConfig = {
      ...config,
      totalEvents: total,
      expectedWins: wins,
      averageOdds: odds,
    };
    setConfig(newConfig);
    initializeEvents(total, odds);
  };

  // Progression evaluation
  const progression = useMemo(() => {
    let currentBankroll = config.initialBankroll;
    let wins = 0;
    let losses = 0;
    const maxAllowedLosses = config.totalEvents - config.expectedWins;
    let progressionStatus: 'in_progress' | 'won' | 'lost' = 'in_progress';
    const evaluatedEvents = [];
    let nextFound = false;

    for (let index = 0; index < events.length; index++) {
      const ev = events[index];
      const remainingEventsCount = config.totalEvents - index;
      const remainingWins = config.expectedWins - wins;
      const bankrollBefore = currentBankroll;

      // Extract future remaining odds
      const futureOddsList: number[] = [];
      for (let j = index + 1; j < events.length; j++) {
        futureOddsList.push(events[j].odds || config.averageOdds);
      }

      let calculatedStake = 0;
      let isNextToPlay = false;

      // If event was already played and concluded (won or lost), its stake is PERMANENTLY FROZEN.
      // Modifying odds in subsequent games MUST NOT alter earlier placed stakes!
      if (ev.status === 'won' || ev.status === 'lost') {
        calculatedStake = ev.placedStake ?? calculateStake(
          currentBankroll,
          ev.odds,
          remainingWins,
          remainingEventsCount,
          futureOddsList
        );
      } else if (progressionStatus === 'in_progress') {
        if (ev.status === 'pending' && !nextFound) {
          isNextToPlay = true;
          nextFound = true;
        }

        calculatedStake = calculateStake(
          currentBankroll,
          ev.odds,
          remainingWins,
          remainingEventsCount,
          futureOddsList
        );
      }

      let bankrollAfter = currentBankroll;

      if (ev.status === 'won') {
        wins++;
        const profit = calculatedStake * (ev.odds - 1);
        currentBankroll += profit;
        bankrollAfter = currentBankroll;
      } else if (ev.status === 'lost') {
        losses++;
        currentBankroll -= calculatedStake;
        bankrollAfter = currentBankroll;
      }

      // Check lifecycle termination after this event
      if (wins >= config.expectedWins) {
        progressionStatus = 'won';
      } else if (losses > maxAllowedLosses) {
        progressionStatus = 'lost';
      }

      evaluatedEvents.push({
        ...ev,
        bankrollBefore,
        calculatedStake,
        bankrollAfter,
        isNextToPlay,
      });
    }

    // Potential initial stats
    const potentialPayout = calculatePotentialPayout(
      config.initialBankroll,
      config.totalEvents,
      config.expectedWins,
      config.averageOdds
    );
    const potentialNetProfit = potentialPayout - config.initialBankroll;
    const potentialROI = config.initialBankroll > 0 ? (potentialNetProfit / config.initialBankroll) * 100 : 0;

    const remainingWinsNeeded = Math.max(0, config.expectedWins - wins);
    const remainingLossesAllowed = Math.max(0, maxAllowedLosses - losses);

    // Current net balance
    const currentProfit = currentBankroll - config.initialBankroll;
    const currentROI = config.initialBankroll > 0 ? (currentProfit / config.initialBankroll) * 100 : 0;

    return {
      evaluatedEvents,
      wins,
      losses,
      maxAllowedLosses,
      remainingWinsNeeded,
      remainingLossesAllowed,
      status: progressionStatus,
      currentBankroll,
      currentProfit,
      currentROI,
      potentialPayout,
      potentialNetProfit,
      potentialROI,
    };
  }, [config, events]);

  // Update specific event field (tutte le modifiche disabilitate se la partita è vinta o persa)
  const updateEvent = (index: number, updates: Partial<MasanielloEvent>) => {
    setEvents(prev => {
      // Quando una partita risulta "V" o "P" tutte le modifiche su quella partita devono essere DISABILITATE
      if (prev[index].status !== 'pending') {
        return prev;
      }
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  };

  // Inserisce i dati della partita selezionata dal popup nel Masaniello (data, ora, descrizione, segno, probabilità, quota)
  const handleSelectMatchForEvent = (targetIndex: number, item: ParsedMatchItem) => {
    setEvents(prev => {
      const next = [...prev];
      if (targetIndex >= 0 && targetIndex < next.length) {
        if (next[targetIndex].status !== 'pending') return prev;
        next[targetIndex] = {
          ...next[targetIndex],
          date: formatDateShort(item.date) || next[targetIndex].date || '',
          time: formatTimeShort(item.time) || next[targetIndex].time || '',
          match: item.match,
          market: item.market,
          probability: item.probability,
          probabilityRaw: item.probabilityRaw,
          competition: item.competition || '',
          valueEdge: item.valueEdge || '',
          odds: item.odds,
        };
      }
      return next;
    });
    setImportTargetIndex(null);
  };

  // Cancella la partita dal Masaniello (tasto "X" accanto alla descrizione partita)
  // La "X" per eliminare la partita dal Masaniello deve essere attiva SOLO se la partita è in gioco (non "V" o "P")
  const clearEventMatch = (index: number) => {
    setEvents(prev => {
      if (index < 0 || index >= prev.length) return prev;
      // Se la partita risulta già 'won' o 'lost', non è possibile eliminarla
      if (prev[index].status !== 'pending') return prev;
      const next = [...prev];
      next[index] = {
        ...next[index],
        date: '',
        time: '',
        match: '',
        market: '',
        probability: null,
        probabilityRaw: '',
        competition: '',
        valueEdge: '',
      };
      return next;
    });
  };

  // Apre la finestra "Elimina partite prima di" con Data Odierna e Ora di Roma - 2 ore
  const openDeleteBeforeModal = () => {
    const now = new Date();
    const romeFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = romeFormatter.formatToParts(now);
    const map: Record<string, string> = {};
    parts.forEach(p => { map[p.type] = p.value; });

    const y = parseInt(map.year, 10);
    const m = parseInt(map.month, 10);
    const d = parseInt(map.day, 10);
    const h = parseInt(map.hour, 10);
    const min = parseInt(map.minute, 10);

    // Data Default = DATA ODIERNA (formato YYYY-MM-DD)
    const defaultDateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    // Ora Default = individua l'ora esatta di sistema (Fuso orario Roma) e torna indietro di 2 ore
    const romeDateObj = new Date(y, m - 1, d, h, min);
    romeDateObj.setHours(romeDateObj.getHours() - 2);

    const defaultH = String(romeDateObj.getHours()).padStart(2, '0');
    const defaultMin = String(romeDateObj.getMinutes()).padStart(2, '0');
    const defaultTimeStr = `${defaultH}:${defaultMin}`;

    setDeleteBeforeDate(defaultDateStr);
    setDeleteBeforeTime(defaultTimeStr);
    setShowDeleteBeforeModal(true);
  };

  // Esegue l'eliminazione delle partite precedenti alla data e ora indicate (comprese)
  const handleExecuteDeleteBefore = () => {
    if (!deleteBeforeDate || !deleteBeforeTime) return;
    const cutoffTs = parseDateTimeToTimestamp(deleteBeforeDate, deleteBeforeTime);
    if (cutoffTs === null) return;

    const rawLines = matchesListText.split(/\r?\n/);
    const remainingLines = rawLines.filter((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return true;

      let parts: string[] = [];
      if (line.includes('\t')) {
        parts = line.split('\t').map(s => s.trim());
      } else {
        parts = line.split(/\s{2,}/).map(s => s.trim());
      }

      // Mantieni eventuale riga di intestazione
      if (idx === 0) {
        const p0 = (parts[0] || '').toLowerCase();
        const p1 = (parts[1] || '').toLowerCase();
        if (p0 === 'data' || p0 === 'date' || p1.includes('ora') || p1.includes('inizio') || line.toLowerCase().includes('probabilit')) {
          return true;
        }
      }

      let datePart = '';
      let timePart = '';
      if (parts.length >= 7) {
        datePart = parts[0];
        timePart = parts[1];
      } else if (parts.length >= 2) {
        if (/^\d{1,2}[:.]\d{2}$/.test(parts[0])) {
          timePart = parts[0];
          datePart = parts[1];
        } else {
          datePart = parts[0];
          timePart = parts[1];
        }
      }

      if (!datePart) {
        return true;
      }

      const matchTs = parseDateTimeToTimestamp(datePart, timePart);
      if (matchTs === null) {
        return true;
      }

      // Elimina se precedente o uguale alla data e ora selezionate
      if (matchTs <= cutoffTs) {
        return false;
      }

      return true;
    });

    const newText = remainingLines.join('\n');
    setMatchesListText(newText);
    try {
      localStorage.setItem(MATCHES_LIST_STORAGE_KEY, newText);
    } catch {
      // quota
    }
    setShowDeleteBeforeModal(false);
  };



  // Elimina una singola partita dall'Elenco Partite (a schermo, dal TSV e dal database online)
  const handleDeleteSingleMatch = (targetItem: ParsedMatchItem) => {
    // Controllo di sicurezza: se la partita è attualmente inserita/attiva nel Masaniello, blocca l'eliminazione
    if (isTeamInMasaniello(targetItem.match, events)) {
      return;
    }
    const rawLines = matchesListText.split(/\r?\n/);
    let removed = false;
    const remainingLines = rawLines.filter((line) => {
      if (removed) return true;
      const trimmed = line.trim();
      if (!trimmed) return true;

      // Corrispondenza con la rawLine salvata
      if (targetItem.rawLine && trimmed === targetItem.rawLine.trim()) {
        removed = true;
        return false;
      }

      // Fallback: corrispondenza con nome partita e orario/segno
      if (line.includes(targetItem.match)) {
        const matchesTime = !targetItem.time || targetItem.time === '--:--' || line.includes(targetItem.time);
        const matchesMarket = !targetItem.market || line.includes(targetItem.market);
        if (matchesTime && matchesMarket) {
          removed = true;
          return false;
        }
      }

      return true;
    });

    const newText = remainingLines.join('\n');
    setMatchesListText(newText);
    try {
      localStorage.setItem(MATCHES_LIST_STORAGE_KEY, newText);
    } catch { /* ignore */ }

    // Salva automaticamente nel database online per mantenere la sincronizzazione completa
    saveNow({ ...currentState(), matchesListText: newText });
  };



  // Verifica se il Masaniello è in progressione (cioè almeno la prima partita o una partita è "V" o "P")
  const isProgressionActive = useMemo(() => {
    return events.some(e => e.status === 'won' || e.status === 'lost');
  }, [events]);

  // Imposta esito evento con congelamento definitivo della puntata
  const setEventStatus = (index: number, newStatus: 'pending' | 'won' | 'lost') => {
    setEvents(prev => {
      const next = [...prev];
      if (newStatus === 'pending') {
        next[index] = {
          ...next[index],
          status: 'pending',
          placedStake: undefined,
        };
      } else {
        // Congela la puntata calcolata al momento della chiusura
        const currentCalculatedStake = progression.evaluatedEvents[index]?.calculatedStake || 0;
        next[index] = {
          ...next[index],
          status: newStatus,
          placedStake: next[index].placedStake ?? currentCalculatedStake,
        };
      }
      return next;
    });
  };

  // Full reset (Nuovo Masaniello)
  // Requisiti: azzera parametri e giocate, non cancella la lista partite grezze (raw_matches_list),
  // genera un nuovo codice univoco e reimposta il titolo con la data odierna "Masa [GG-MM-AA]"
  const handleFullReset = () => {
    localStorage.removeItem(STORAGE_KEY);
    const defaultConf: MasanielloConfig = {
      initialBankroll: 100,
      totalEvents: 20,
      expectedWins: 11,
      averageOdds: 1.60,
    };
    setConfig(defaultConf);
    
    // Inizializza eventi puliti
    const newEvents: MasanielloEvent[] = [];
    for (let i = 1; i <= defaultConf.totalEvents; i++) {
      newEvents.push({
        id: i,
        match: '',
        market: '',
        odds: defaultConf.averageOdds,
        status: 'pending',
      });
    }
    setEvents(newEvents);

    // ATTENZIONE: La lista delle partite grezze (matchesListText / raw_matches_list) NON viene toccata!
    // Rimane disponibile e pronta all'uso nell'Elenco Partite e nel popup di importazione.

    // Genera un nuovo codice univoco per il database
    const newCode = generateSyncCode();
    adoptCode(newCode);

    // Titolo aggiornato automaticamente con la data odierna nel formato "Masa [GG-MM-AA]"
    const newTitle = getDefaultTitle();
    setTitle(newTitle);
    try { localStorage.setItem(TITLE_STORAGE_KEY, newTitle); } catch { /* ignore */ }

    setShowResetModal(false);

    // Salva immediatamente il nuovo Masaniello nel database
    const newState: SessionState = {
      title: newTitle,
      config: defaultConf,
      events: newEvents,
      roundStakes,
      matchesListText,
    };
    saveNow(newState, newCode, newTitle);
  };

  // Generate Standalone HTML file content
  const generateStandaloneHTML = () => {
    return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Masaniello SamSte</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --danger: #ef4444;
      --amber: #f59e0b;
      --highlight: #0284c7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text); padding: 20px; line-height: 1.5; }
    .container { max-width: 1200px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    h1 { font-size: 1.5rem; font-weight: 700; color: #fff; }
    .subtitle { color: var(--text-muted); font-size: 0.875rem; }
    .grid-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .card-title { font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 6px; }
    .card-val { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .card-sub { font-size: 0.75rem; margin-top: 4px; color: var(--text-muted); }
    .text-success { color: var(--success); }
    .text-danger { color: var(--danger); }
    .text-primary { color: var(--primary); }
    .text-amber { color: var(--amber); }

    .panel { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 24px; }
    .panel-header { font-size: 1.1rem; font-weight: 600; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; align-items: flex-end; }
    label { display: block; font-size: 0.8rem; font-weight: 500; color: var(--text-muted); margin-bottom: 4px; }
    input, select { width: 100%; padding: 8px 12px; background: #0f172a; border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.95rem; }
    input:focus, select:focus { outline: none; border-color: var(--primary); }

    .btn { padding: 9px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; border: none; font-size: 0.9rem; transition: 0.15s ease; }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-danger { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .btn-danger:hover { background: rgba(239, 68, 68, 0.25); }
    .presets-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
    .preset-btn { background: #334155; color: #cbd5e1; font-size: 0.75rem; padding: 4px 10px; border-radius: 4px; border: none; cursor: pointer; }
    .preset-btn:hover { background: #475569; color: #fff; }

    .status-banner { padding: 14px 18px; border-radius: 8px; margin-bottom: 24px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }
    .status-in_progress { background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); color: #93c5fd; }
    .status-won { background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #6ee7b7; }
    .status-lost { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; }

    .table-container { overflow-x: auto; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; text-align: left; min-width: 780px; }
    th { padding: 12px 14px; font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); background: #162032; border-bottom: 1px solid var(--border); }
    td { padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 0.9rem; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr.next-bet { background: rgba(59, 130, 246, 0.08); outline: 1px solid rgba(59, 130, 246, 0.3); }
    tr.row-won { background: rgba(16, 185, 129, 0.04); }
    tr.row-lost { background: rgba(239, 68, 68, 0.04); }

    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .badge-won { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .badge-lost { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .badge-pending { background: #334155; color: #94a3b8; }
    .badge-next { background: #2563eb; color: #fff; }

    .stake-box { font-weight: 700; font-size: 1.05rem; color: #38bdf8; font-variant-numeric: tabular-nums; }
    .money { font-variant-numeric: tabular-nums; font-family: monospace; }
    @media (max-width: 768px) { body { padding: 12px; } }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Calcolatore Masaniello</h1>
        <div class="subtitle">Gestione scientifica del capitale &middot; Algoritmo Binomiale Tartaglia</div>
      </div>
      <button class="btn btn-danger" onclick="confirmReset()">Nuovo Masaniello</button>
    </header>

    <div class="panel">
      <div class="panel-header">Parametri della Progressione</div>
      <form id="configForm" onsubmit="event.preventDefault(); applyConfig();">
        <div class="form-grid">
          <div>
            <label>Cassa Iniziale (€)</label>
            <input type="number" id="inpBankroll" step="1" min="1" value="100" required>
          </div>
          <div>
            <label>Eventi Totali (N)</label>
            <input type="number" id="inpTotal" min="2" max="50" value="20" required>
          </div>
          <div>
            <label>Eventi Attesi (K)</label>
            <input type="number" id="inpExpected" min="1" max="49" value="11" required>
          </div>
          <div>
            <label>Quota Media</label>
            <input type="number" id="inpOdds" step="0.01" min="1.05" value="1.60" required>
          </div>
          <div>
            <button type="submit" class="btn btn-primary" style="width: 100%;">Inizia Masaniello</button>
          </div>
        </div>
      </form>
      <div class="presets-row">
        <span style="font-size: 0.75rem; color: var(--text-muted);">Preset rapidi:</span>
        <button class="preset-btn" onclick="setPreset(20, 11, 1.60)" style="background:#2563eb; color:#fff;">11 su 20 @ 1.60 (Default)</button>
        <button class="preset-btn" onclick="setPreset(10, 6, 2.00)">6 su 10 @ 2.00</button>
        <button class="preset-btn" onclick="setPreset(6, 4, 1.85)">4 su 6 @ 1.85</button>
        <button class="preset-btn" onclick="setPreset(8, 5, 1.75)">5 su 8 @ 1.75</button>
        <button class="preset-btn" onclick="setPreset(12, 7, 2.10)">7 su 12 @ 2.10</button>
      </div>
    </div>

    <div class="grid-metrics" id="metricsGrid"></div>
    <div id="statusBanner"></div>

    <div class="panel" style="padding: 0; overflow: hidden;">
      <div style="padding: 16px; border-bottom: 1px solid var(--border); font-weight: 600;">Tabella Eventi Masaniello</div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 45px;">#</th>
              <th>Descrizione Partita</th>
              <th>Mercato / Segno</th>
              <th style="width: 95px;">Quota</th>
              <th style="width: 130px;">Puntata (€)</th>
              <th style="width: 140px;">Esito</th>
              <th style="width: 130px;">Cassa Residua</th>
            </tr>
          </thead>
          <tbody id="eventsTbody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    const STORAGE_KEY = 'masaniello_standalone_storage_v3';
    let state = {
      config: { initialBankroll: 100, totalEvents: 20, expectedWins: 11, averageOdds: 1.60 },
      events: []
    };

    // Calcolo esatto della probabilità di vincita Poisson-Binomiale
    function calculateWinProbability(oddsList, targetWins) {
      if (targetWins <= 0) return 1.0;
      if (targetWins > oddsList.length) return 0.0;
      let dp = [1.0];
      for (let i = 0; i < oddsList.length; i++) {
        const q = Math.max(1.0001, oddsList[i]);
        const p = 1.0 / q;
        const nextDp = new Array(dp.length + 1).fill(0);
        nextDp[0] = dp[0] * (1.0 - p);
        for (let w = 1; w <= dp.length; w++) {
          const prevWin = dp[w - 1] || 0;
          const prevLoss = dp[w] || 0;
          nextDp[w] = prevLoss * (1.0 - p) + prevWin * p;
        }
        dp = nextDp;
      }
      let totalProb = 0;
      for (let w = targetWins; w < dp.length; w++) {
        totalProb += dp[w];
      }
      return totalProb;
    }

    // Calcolo vincita potenziale Masaniello
    function calculatePotentialPayout(initialBankroll, totalEvents, expectedWins, averageOdds) {
      if (initialBankroll <= 0 || expectedWins <= 0 || expectedWins > totalEvents) return 0;
      const oddsList = new Array(totalEvents).fill(Math.max(1.0001, averageOdds));
      const prob = calculateWinProbability(oddsList, expectedWins);
      if (prob <= 0) return 0;
      return initialBankroll / prob;
    }

    // Formula esatta dello Stake Masaniello:
    // Stake = Ck * (P_win - P_loss) / [ Qk * P_cur ]
    function calculateStake(currentBankroll, eventOdds, remainingWins, remainingEventsCount, futureOdds) {
      if (currentBankroll <= 0 || remainingWins <= 0) return 0;
      if (remainingWins > remainingEventsCount) return 0;
      if (remainingWins === remainingEventsCount) return Math.round(currentBankroll * 100) / 100;

      const q = Math.max(1.0001, eventOdds);
      const future = (futureOdds && futureOdds.length === remainingEventsCount - 1)
        ? futureOdds
        : new Array(remainingEventsCount - 1).fill(q);

      const pWin = calculateWinProbability(future, remainingWins - 1);
      const pLoss = calculateWinProbability(future, remainingWins);
      const pCur = (1.0 / q) * pWin + (1.0 - 1.0 / q) * pLoss;
      if (pCur <= 0) return 0;

      const stake = currentBankroll * (pWin - pLoss) / (q * pCur);
      return Math.round(stake * 100) / 100;
    }

    function loadState() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.config && parsed.events && parsed.events.length > 0) {
            state = parsed;
            document.getElementById('inpBankroll').value = state.config.initialBankroll;
            document.getElementById('inpTotal').value = state.config.totalEvents;
            document.getElementById('inpExpected').value = state.config.expectedWins;
            document.getElementById('inpOdds').value = state.config.averageOdds;
            render();
            return;
          }
        }
      } catch (e) {}
      initEvents(state.config.totalEvents, state.config.averageOdds);
      render();
    }

    function saveState() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e){}
    }

    function initEvents(count, odds) {
      state.events = [];
      for (let i = 1; i <= count; i++) {
        state.events.push({ id: i, match: '', market: '', odds: odds, status: 'pending' });
      }
      saveState();
    }

    function applyConfig() {
      const bankroll = parseFloat(document.getElementById('inpBankroll').value) || 100;
      const total = parseInt(document.getElementById('inpTotal').value) || 20;
      const expected = parseInt(document.getElementById('inpExpected').value) || 11;
      const odds = parseFloat(document.getElementById('inpOdds').value) || 1.60;
      if (expected > total) { alert("Gli eventi attesi non possono superare il totale."); return; }
      state.config = { initialBankroll: bankroll, totalEvents: total, expectedWins: expected, averageOdds: odds };
      initEvents(total, odds);
      render();
    }

    function setPreset(total, expected, odds) {
      document.getElementById('inpTotal').value = total;
      document.getElementById('inpExpected').value = expected;
      document.getElementById('inpOdds').value = odds;
      applyConfig();
    }

    function updateEvent(index, key, val) {
      if (key === 'odds' && state.events[index].status !== 'pending') {
        return; // Quota bloccata se l'evento è già concluso
      }
      state.events[index][key] = val;
      saveState();
      render();
    }

    function setEventStatus(index, newStatus) {
      if (newStatus === 'pending') {
        delete state.events[index].placedStake;
        state.events[index].status = 'pending';
      } else {
        const frozen = window._lastEvaluated && window._lastEvaluated[index] ? window._lastEvaluated[index].stake : 0;
        state.events[index].placedStake = state.events[index].placedStake || frozen;
        state.events[index].status = newStatus;
      }
      saveState();
      render();
    }

    function confirmReset() {
      if (confirm("Vuoi davvero resettare la progressione e ripartire da zero?")) {
        localStorage.removeItem(STORAGE_KEY);
        state.config = { initialBankroll: 100, totalEvents: 20, expectedWins: 11, averageOdds: 1.60 };
        document.getElementById('inpBankroll').value = 100;
        document.getElementById('inpTotal').value = 20;
        document.getElementById('inpExpected').value = 11;
        document.getElementById('inpOdds').value = 1.60;
        initEvents(20, 1.60);
        render();
      }
    }

    function render() {
      let currentBankroll = state.config.initialBankroll;
      let wins = 0, losses = 0;
      const maxLosses = state.config.totalEvents - state.config.expectedWins;
      let status = 'in_progress';
      let nextFound = false;

      const evaluated = state.events.map((ev, idx) => {
        const remainingEventsCount = state.config.totalEvents - idx;
        const remainingWins = state.config.expectedWins - wins;
        const futureOdds = [];
        for (let j = idx + 1; j < state.events.length; j++) {
          futureOdds.push(state.events[j].odds || state.config.averageOdds);
        }

        let isNext = false;
        let stake = 0;

        // Se l'evento è già stato giocato (vinto o perso), la sua puntata è congelata
        if (ev.status === 'won' || ev.status === 'lost') {
          stake = (ev.placedStake !== undefined) ? ev.placedStake : calculateStake(currentBankroll, ev.odds, remainingWins, remainingEventsCount, futureOdds);
        } else if (status === 'in_progress') {
          if (ev.status === 'pending' && !nextFound) {
            isNext = true;
            nextFound = true;
          }
          stake = calculateStake(currentBankroll, ev.odds, remainingWins, remainingEventsCount, futureOdds);
        }

        let after = currentBankroll;
        if (ev.status === 'won') {
          wins++;
          currentBankroll += stake * (ev.odds - 1);
          after = currentBankroll;
        } else if (ev.status === 'lost') {
          losses++;
          currentBankroll -= stake;
          after = currentBankroll;
        }

        if (wins >= state.config.expectedWins && status === 'in_progress') status = 'won';
        else if (losses > maxLosses && status === 'in_progress') status = 'lost';

        return { ...ev, stake, after, isNext };
      });

      window._lastEvaluated = evaluated;

      const payout = calculatePotentialPayout(state.config.initialBankroll, state.config.totalEvents, state.config.expectedWins, state.config.averageOdds);
      const profit = payout - state.config.initialBankroll;
      const roi = state.config.initialBankroll > 0 ? (profit / state.config.initialBankroll) * 100 : 0;

      // Render Metrics
      const netCurrent = currentBankroll - state.config.initialBankroll;
      const netClass = netCurrent >= 0 ? 'text-success' : 'text-danger';
      document.getElementById('metricsGrid').innerHTML = \`
        <div class="card">
          <div class="card-title">Cassa Attuale</div>
          <div class="card-val \${netClass}">€ \${currentBankroll.toFixed(2)}</div>
          <div class="card-sub">Iniziale: € \${state.config.initialBankroll.toFixed(2)} (\${netCurrent >= 0 ? '+' : ''}\${netCurrent.toFixed(2)} €)</div>
        </div>
        <div class="card">
          <div class="card-title">Vincita Potenziale Totale</div>
          <div class="card-val text-primary">€ \${payout.toFixed(2)}</div>
          <div class="card-sub">Resa: \${(payout / state.config.initialBankroll).toFixed(2)}x</div>
        </div>
        <div class="card">
          <div class="card-title">Profitto Netto Atteso</div>
          <div class="card-val text-success">+€ \${profit.toFixed(2)}</div>
          <div class="card-sub">Rendimento (ROI): +\${roi.toFixed(2)}%</div>
        </div>
        <div class="card">
          <div class="card-title">Stato Progressione</div>
          <div class="card-val" style="font-size: 1.25rem;">Vinte \${wins}/\${state.config.expectedWins}</div>
          <div class="card-sub">Errori: \${losses} su \${maxLosses} max consentiti</div>
        </div>
      \`;

      // Render Status Banner
      const banner = document.getElementById('statusBanner');
      if (status === 'won') {
        banner.className = 'status-banner status-won';
        banner.innerHTML = \`<div>&check; <strong>Masaniello Concluso con Successo!</strong> Hai raggiunto i \${state.config.expectedWins} eventi vincenti attesi.</div><div>Cassa finale: € \${currentBankroll.toFixed(2)}</div>\`;
      } else if (status === 'lost') {
        banner.className = 'status-banner status-lost';
        banner.innerHTML = \`<div>&cross; <strong>Masaniello Chiuso / Perso.</strong> Superato il limite di \${maxLosses} errori consentiti.</div><div>Cassa residua: € \${currentBankroll.toFixed(2)}</div>\`;
      } else {
        const nextEv = evaluated.find(e => e.isNext);
        banner.className = 'status-banner status-in_progress';
        banner.innerHTML = \`
          <div><strong>Progressione in corso:</strong> Mancano \${state.config.expectedWins - wins} vittorie. Errori residui concessi: \${maxLosses - losses}.</div>
          \${nextEv ? \`<div style="color: #fff;">Prossima puntata raccomandata (#\${nextEv.id}): <strong class="stake-box">€ \${nextEv.stake.toFixed(2)}</strong></div>\` : ''}
        \`;
      }

      // Render Table Rows (Descrizione e Segno sempre modificabili, Quota bloccata su partite concluse)
      const tbody = document.getElementById('eventsTbody');
      tbody.innerHTML = evaluated.map((ev, idx) => {
        const rowClass = ev.isNext ? 'next-bet' : (ev.status === 'won' ? 'row-won' : (ev.status === 'lost' ? 'row-lost' : ''));
        const isClosed = ev.status !== 'pending';
        const prevEv = idx > 0 ? evaluated[idx - 1] : null;
        const isPrevFinished = idx === 0 || (prevEv ? (prevEv.status === 'won' || prevEv.status === 'lost') : false);
        // Dalla seconda partita in poi, se quella precedente non è finita, nascondi la puntata calcolata
        const showStake = isClosed || (idx === 0 && status === 'in_progress') || (isPrevFinished && ev.isNext && status === 'in_progress');

        return \`
          <tr class="\${rowClass}">
            <td style="font-weight: 600; color: var(--text-muted);">\${ev.id}</td>
            <td>
              <input type="text" value="\${ev.match || ''}" placeholder="Es: Milan - Inter"
                onchange="updateEvent(\${idx}, 'match', this.value)" style="padding: 5px 8px; font-size: 0.85rem;">
            </td>
            <td>
              <select onchange="updateEvent(\${idx}, 'market', this.value)" style="padding: 5px 8px; font-size: 0.85rem; width: 75px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px;">
                <option value=""></option>
                <option value="O1.5" \${ev.market === 'O1.5' ? 'selected' : ''}>O1.5</option>
                <option value="O2.5" \${ev.market === 'O2.5' ? 'selected' : ''}>O2.5</option>
                <option value="U2.5" \${ev.market === 'U2.5' ? 'selected' : ''}>U2.5</option>
                <option value="U3.5" \${ev.market === 'U3.5' ? 'selected' : ''}>U3.5</option>
              </select>
            </td>
            <td>
              <input type="number" step="0.01" min="1.01" value="\${ev.odds}"
                \${isClosed ? 'disabled title="Quota non modificabile per partite già concluse" style="padding: 5px 8px; font-size: 0.85rem; opacity: 0.55; cursor: not-allowed;"' : 'style="padding: 5px 8px; font-size: 0.85rem;"'}
                onchange="updateEvent(\${idx}, 'odds', parseFloat(this.value) || 1.60)">
            </td>
            <td>
              \${showStake ? \`
                <span class="stake-box">€ \${ev.stake.toFixed(2)}</span>
                \${ev.isNext ? '<span class="badge badge-next" style="margin-left: 6px;">Gioca Ora</span>' : ''}
                \${isClosed ? '<span style="font-size:0.7rem; color:#64748b; margin-left:4px;">[fissa]</span>' : ''}
              \` : '<span style="color:#64748b; font-family:monospace; font-size:0.95rem;" title="In attesa dell\\\'esito della partita precedente">—</span>'}
            </td>
            <td>
              <select onchange="setEventStatus(\${idx}, this.value)" style="padding: 5px 8px; font-size: 0.85rem;">
                <option value="pending" \${ev.status === 'pending' ? 'selected' : ''}>Da Giocare</option>
                <option value="won" \${ev.status === 'won' ? 'selected' : ''}>&check; Vinta</option>
                <option value="lost" \${ev.status === 'lost' ? 'selected' : ''}>&cross; Persa</option>
              </select>
            </td>
            <td>
              <span class="money \${ev.after >= state.config.initialBankroll ? 'text-success' : 'text-danger'}">
                € \${ev.after.toFixed(2)}
              </span>
            </td>
          </tr>
        \`;
      }).join('');
    }

    window.onload = loadState;
  </script>
</body>
</html>`;
  };

  // Generazione e download del PDF su foglio A4 (sfondo bianco, scritte nere, V in verde, P in rosso)
  const handleDownloadPDF = () => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Sfondo bianco
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    // In alto: Nome del Masaniello
    const masaName = (title || 'Masaniello SamSte').trim();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text(masaName, 14, 18);

    // Dettaglio codice e data
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(80, 80, 80);
    const dateFormatted = new Date().toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    doc.text(`Codice: ${syncCode || '------'}   |   Data: ${dateFormatted}`, 14, 23.5);

    // Linea divisoria nera sottile
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.line(14, 26, pageWidth - 14, 26);

    // Sotto: Parametri Masaniello
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text('PARAMETRI MASANIELLO', 14, 32);

    const paramsHead = [['Cassa Iniziale', 'Eventi Totali (N)', 'Eventi Attesi (K)', 'Quota Media', 'Vincita Prevista', 'Resa / ROI']];
    const paramsBody = [[
      `€ ${config.initialBankroll.toFixed(2)}`,
      `${config.totalEvents}`,
      `${config.expectedWins}`,
      `${config.averageOdds.toFixed(2)}`,
      `€ ${progression.potentialPayout.toFixed(2)}`,
      `+${progression.potentialROI.toFixed(1)}%`
    ]];

    autoTable(doc, {
      startY: 35,
      head: paramsHead,
      body: paramsBody,
      theme: 'grid',
      styles: {
        fontSize: 8,
        textColor: [0, 0, 0],
        fillColor: [255, 255, 255],
        lineColor: [0, 0, 0],
        lineWidth: 0.15,
        halign: 'center',
        cellPadding: 2,
      },
      headStyles: {
        fillColor: [245, 245, 245],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        lineColor: [0, 0, 0],
        lineWidth: 0.2,
        halign: 'center',
      },
      margin: { left: 14, right: 14 },
    });

    const afterParamsY = (doc as any).lastAutoTable?.finalY || 45;

    // Riepilogo stato progressione
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    const statusLabel = progression.status === 'won' ? 'VINTA' : progression.status === 'lost' ? 'CHIUSA CON PERDITA' : 'IN CORSO';
    doc.text(
      `Stato: ${statusLabel}   |   Vinte: ${progression.wins}   |   Perse: ${progression.losses}   |   Cassa Attuale: € ${progression.currentBankroll.toFixed(2)}   |   Profitto: € ${progression.currentProfit.toFixed(2)}`,
      14,
      afterParamsY + 4
    );

    // Sotto: Tabella Partite & Gestione Eventi
    const tableStartY = afterParamsY + 9;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text('TABELLA PARTITE & GESTIONE EVENTI', 14, tableStartY);

    const eventsHead = [['#', 'Partita / Evento', 'Segno', 'Quota', 'Puntata', 'Esito', 'Cassa']];
    const eventsBody = progression.evaluatedEvents.map((ev, i) => {
      const isWon = ev.status === 'won';
      const isLost = ev.status === 'lost';
      const isPending = ev.status === 'pending';
      const isNext = ev.isNextToPlay;
      const prevEv = i > 0 ? progression.evaluatedEvents[i - 1] : null;
      const isPrevFinished = i === 0 || (prevEv ? (prevEv.status === 'won' || prevEv.status === 'lost') : false);
      const shouldShowStake = !isPending || (i === 0 && progression.status === 'in_progress') || (isPrevFinished && isNext && progression.status === 'in_progress');

      let stakeText = '-';
      if (shouldShowStake && ev.calculatedStake > 0) {
        stakeText = `€ ${formatStake(ev.calculatedStake)}`;
      }

      let esitoText = '-';
      if (isWon) esitoText = 'V';
      else if (isLost) esitoText = 'P';

      let cassaText = '-';
      if (!isPending || isNext) {
        cassaText = `€ ${ev.bankrollAfter.toFixed(2)}`;
      }

      return [
        `#${ev.id}`,
        ev.match || `Partita #${ev.id}`,
        ev.market || '-',
        ev.odds.toFixed(2),
        stakeText,
        esitoText,
        cassaText,
      ];
    });

    autoTable(doc, {
      startY: tableStartY + 3,
      head: eventsHead,
      body: eventsBody,
      theme: 'grid',
      styles: {
        fontSize: 7.5,
        textColor: [0, 0, 0],
        fillColor: [255, 255, 255],
        lineColor: [0, 0, 0],
        lineWidth: 0.15,
        cellPadding: 1.6,
      },
      headStyles: {
        fillColor: [245, 245, 245],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        lineColor: [0, 0, 0],
        lineWidth: 0.2,
        halign: 'center',
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { halign: 'left', cellWidth: 'auto' },
        2: { halign: 'center', cellWidth: 16 },
        3: { halign: 'center', cellWidth: 16 },
        4: { halign: 'right', cellWidth: 22 },
        5: { halign: 'center', cellWidth: 16 },
        6: { halign: 'right', cellWidth: 22 },
      },
      didParseCell: (data) => {
        // Scritta "V" per Vinta in verde, Scritta "P" per persa in ROSSO
        if (data.section === 'body' && data.column.index === 5) {
          const val = String(data.cell.raw).trim();
          if (val === 'V') {
            data.cell.styles.textColor = [22, 163, 74]; // Verde
            data.cell.styles.fontStyle = 'bold';
          } else if (val === 'P') {
            data.cell.styles.textColor = [220, 38, 38]; // Rosso
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
      margin: { left: 14, right: 14, bottom: 12 },
    });

    // Nome del file = nome del masaniello
    const safeFileName = `${masaName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Masaniello'}.pdf`;
    doc.save(safeFileName);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header Bar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg border flex items-center justify-center bg-blue-600/20 border-blue-500/30 text-blue-400">
              {currentPage === 'masaniello' ? (
                <Calculator className="w-5 h-5" />
              ) : (
                <ClipboardList className="w-5 h-5" />
              )}
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                {currentPage === 'masaniello' ? 'Masaniello Pro' : 'Elenco Partite'}
                <span className="text-[11px] font-medium border rounded px-1.5 py-0.5 text-slate-400 border-slate-700">
                  {currentPage === 'masaniello' ? 'Money Management' : 'Pronostici'}
                </span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Pulsante Ingranaggio Configurazione Supabase */}
            <button
              type="button"
              onClick={handleOpenSupabaseModal}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 font-medium transition-colors cursor-pointer shadow-xs"
              title="Configurazione Supabase"
              aria-label="Configurazione Supabase"
            >
              <Settings className="w-4 h-4 text-slate-300" />
              <span className="hidden sm:inline">Supabase</span>
            </button>

            {currentPage === 'masaniello' ? (
              <>
                <button
                  type="button"
                  onClick={() => setCurrentPage('elenco_partite')}
                  className="text-xs bg-blue-950/50 hover:bg-blue-900/60 text-blue-300 border border-blue-700/50 px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  <span>Elenco Partite</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetModal(true)}
                  className="text-xs bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Nuovo Masaniello</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setCurrentPage('masaniello')}
                className="text-xs sm:text-sm bg-blue-600 hover:bg-blue-500 text-white font-medium px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Torna al Masaniello</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Cloud sync bar */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-4 sm:px-8 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
            {syncStatus === 'error' ? (
              <CloudOff className="w-4 h-4 text-rose-400 shrink-0" />
            ) : syncStatus === 'loading' || syncStatus === 'saving' ? (
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
            ) : (
              <Cloud className={`w-4 h-4 shrink-0 ${syncStatus === 'saved' ? 'text-emerald-400' : 'text-slate-400'}`} />
            )}
            
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-medium">Codice:</span>
              <button
                type="button"
                onClick={() => {
                  if (!syncCode) return;
                  navigator.clipboard?.writeText(syncCode);
                  setCopiedSyncCode(true);
                  setTimeout(() => setCopiedSyncCode(false), 2000);
                }}
                title="Copia codice negli appunti"
                className="font-mono font-semibold tracking-wider text-white bg-slate-800 border border-slate-700 rounded px-2 py-0.5 flex items-center gap-1 cursor-pointer hover:bg-slate-700"
              >
                {syncCode || '------'}
                {copiedSyncCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
              </button>
            </div>

            {/* Pulsante chiaro "Elenco Masanielli" posizionato vicino alla sezione del codice */}
            <button
              type="button"
              onClick={handleOpenSessionsList}
              className="bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 hover:text-white border border-blue-500/40 hover:border-blue-400 px-3 py-1 rounded-lg flex items-center gap-1.5 font-medium transition-colors cursor-pointer shadow-xs"
              title="Visualizza lo storico di tutti i Masanielli salvati"
            >
              <FolderArchive className="w-3.5 h-3.5 text-blue-400" />
              <span>Elenco Masanielli</span>
            </button>

            {/* Campo Titolo Editabile del Masaniello attivo */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-medium">Titolo:</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Masa GG-MM-AA"
                title="Titolo editabile del Masaniello attivo (salvato nel database)"
                className="bg-slate-950 border border-slate-700 hover:border-slate-600 focus:border-blue-500 rounded-lg px-2.5 py-1 text-white font-medium text-xs focus:outline-none transition-colors w-36 sm:w-48"
              />
            </div>

            <span className={`truncate text-[11px] ${syncStatus === 'error' ? 'text-rose-300' : 'text-slate-500'}`}>
              {syncStatus === 'loading' && 'Caricamento…'}
              {syncStatus === 'saving' && 'Salvataggio…'}
              {syncStatus === 'pending' && 'Modifiche non salvate…'}
              {syncStatus === 'idle' && 'Non ancora salvato'}
              {syncStatus === 'saved' && lastSyncedAt && `Salvato ${new Date(lastSyncedAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
              {syncStatus === 'error' && (syncError || 'Errore di sincronizzazione')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => saveNow()}
              disabled={!syncCode || syncStatus === 'saving' || syncStatus === 'loading'}
              className="bg-emerald-700/80 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1 rounded-lg flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Salva</span>
            </button>
            <button
              type="button"
              onClick={pullFromServer}
              disabled={!syncCode || syncStatus === 'saving' || syncStatus === 'loading'}
              title="Ricarica l'ultima versione salvata per questo codice"
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 px-3 py-1 rounded-lg flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Sync</span>
            </button>
            <button
              type="button"
              onClick={() => { setCodeInput(''); setShowSyncModal(true); }}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1 rounded-lg flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Carica Codice</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {currentPage === 'masaniello' ? (
        <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Section A: Config Form Panel */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Target className="w-4 h-4 text-blue-400" />
                  Parametri Masaniello
                </h2>
                {isProgressionActive && (
                  <span className="text-[11px] font-semibold text-amber-300 bg-amber-950/70 border border-amber-600/50 px-2.5 py-0.5 rounded-md flex items-center gap-1 shadow-xs">
                    <Lock className="w-3 h-3 text-amber-400" />
                    Progressione in corso: Parametri bloccati
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {isProgressionActive
                  ? "La progressione è già iniziata (ci sono partite con esito V o P). I parametri non possono essere modificati durante la progressione."
                  : "Definisci il capitale da investire e la strategia di rendimento prima di avviare le giocate."}
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              {/* Controllo Interruttore Importi arrotondati */}
              <div className="flex items-center gap-2">
                <label
                  htmlFor="round-stakes-toggle"
                  className={`text-xs font-medium select-none flex items-center gap-2 ${
                    isProgressionActive ? 'text-slate-500 cursor-not-allowed' : 'text-slate-300 cursor-pointer'
                  }`}
                >
                  <span>Arrotonda</span>
                </label>
                <button
                  id="round-stakes-toggle"
                  type="button"
                  role="switch"
                  disabled={isProgressionActive}
                  aria-checked={roundStakes}
                  onClick={() => !isProgressionActive && setRoundStakes(!roundStakes)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                    isProgressionActive ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    roundStakes ? 'bg-blue-600' : 'bg-slate-700'
                  }`}
                >
                  <span className="sr-only">Importi arrotondati</span>
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      roundStakes ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <form onSubmit={handleGenerate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Cassa Iniziale (€)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  step="1"
                  disabled={isProgressionActive}
                  value={config.initialBankroll}
                  onChange={(e) => setConfig({ ...config, initialBankroll: Math.max(1, parseFloat(e.target.value) || 0) })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  required
                />
                <span className="absolute right-3 top-2 text-xs text-slate-500 font-mono">EUR</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Eventi Totali (N)
              </label>
              <input
                type="number"
                min="2"
                max="50"
                disabled={isProgressionActive}
                value={config.totalEvents}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 2;
                  setConfig({
                    ...config,
                    totalEvents: val,
                    expectedWins: Math.min(config.expectedWins, val - 1 || 1),
                  });
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Eventi Attesi / Vinti (K)
              </label>
              <input
                type="number"
                min="1"
                max={Math.max(1, config.totalEvents - 1)}
                disabled={isProgressionActive}
                value={config.expectedWins}
                onChange={(e) => setConfig({ ...config, expectedWins: parseInt(e.target.value) || 1 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Quota Media
              </label>
              <input
                type="number"
                step="0.01"
                min="1.05"
                max="20"
                disabled={isProgressionActive}
                value={config.averageOdds}
                onChange={(e) => setConfig({ ...config, averageOdds: parseFloat(e.target.value) || 2.00 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                required
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={isProgressionActive}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Genera Masaniello</span>
              </button>
            </div>
          </form>
        </section>

        {/* Section B: Key Metric Summary Cards */}
        <section className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Cassa Attuale */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-medium uppercase tracking-wider">Cassa Attuale</span>
              <Coins className="w-4 h-4 text-blue-400" />
            </div>
            <div className={`text-2xl font-bold font-mono tabular-nums ${
              progression.currentProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              € {progression.currentBankroll.toFixed(2)}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
              <span>Iniziale: € {config.initialBankroll.toFixed(2)}</span>
              <span>·</span>
              <span className={progression.currentProfit >= 0 ? 'text-emerald-400 font-medium' : 'text-rose-400 font-medium'}>
                {progression.currentProfit >= 0 ? '+' : ''}{progression.currentProfit.toFixed(2)} €
              </span>
            </div>
          </div>

          {/* Card 2: Vincita Potenziale Totale */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-medium uppercase tracking-wider">Vincita Potenziale</span>
              <Trophy className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-white">
              € {progression.potentialPayout.toFixed(2)}
            </div>
            <div className="mt-1 text-xs text-slate-400 flex items-center gap-1.5">
              <span>Resa finale:</span>
              <span className="text-blue-400 font-semibold font-mono">
                {config.initialBankroll > 0 ? (progression.potentialPayout / config.initialBankroll).toFixed(2) : 0}x
              </span>
            </div>
          </div>

          {/* Card 3: Resa / Profitto Netto */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-medium uppercase tracking-wider">Profitto Netto Atteso</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
              +€ {progression.potentialNetProfit.toFixed(2)}
            </div>
            <div className="mt-1 text-xs text-slate-400 flex items-center gap-1.5">
              <span>Rendimento (ROI):</span>
              <span className="text-emerald-400 font-semibold font-mono">
                +{progression.potentialROI.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Card 4: Progressione & Errori */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-medium uppercase tracking-wider">Progressione</span>
              <Layers className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-white flex items-baseline gap-2">
              <span>{progression.wins} / {config.expectedWins}</span>
              <span className="text-xs font-normal text-slate-400">vinte</span>
            </div>
            <div className="mt-1 text-xs text-slate-400 flex items-center justify-between">
              <span>Errori: <strong className="text-slate-200">{progression.losses} / {progression.maxAllowedLosses}</strong></span>
              <span className={progression.remainingLossesAllowed > 0 ? 'text-amber-400' : 'text-rose-400'}>
                {progression.remainingLossesAllowed} residui
              </span>
            </div>
          </div>
        </section>

        {/* Status Callout Banner */}
        {progression.status === 'won' ? (
          <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-emerald-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-emerald-300">
                  Masaniello Concluso con Successo!
                </h3>
                <p className="text-xs text-emerald-300/80">
                  Hai raggiunto i {config.expectedWins} eventi vincenti prefissati. Obiettivo di cassa raggiunto!
                </p>
              </div>
            </div>
            <div className="text-right font-mono sm:border-l sm:border-emerald-500/20 sm:pl-5">
              <div className="text-xs text-emerald-400 uppercase">Cassa Finale Realizzata</div>
              <div className="text-xl font-bold text-white">€ {progression.currentBankroll.toFixed(2)}</div>
            </div>
          </div>
        ) : progression.status === 'lost' ? (
          <div className="bg-rose-950/40 border border-rose-500/40 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-rose-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                <XCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-rose-300">
                  Masaniello Chiuso / Perso
                </h3>
                <p className="text-xs text-rose-300/80">
                  È stato superato il numero massimo di errori consentiti ({progression.maxAllowedLosses}). La progressione si è interrotta per proteggere il capitale residuo.
                </p>
              </div>
            </div>
            <div className="text-right font-mono sm:border-l sm:border-rose-500/20 sm:pl-5">
              <div className="text-xs text-rose-400 uppercase">Cassa Residua</div>
              <div className="text-xl font-bold text-white">€ {progression.currentBankroll.toFixed(2)}</div>
            </div>
          </div>
        ) : null}

        {/* Section C: Events Table */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-400" />
                Tabella Partite & Gestione Eventi
              </h2>
              <p className="text-xs text-slate-400">
                Inserisci quota e dettagli partita. La puntata consigliata si aggiorna dinamicamente in tempo reale.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCurrentPage('elenco_partite')}
                className="text-xs bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-750 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
              >
                <ClipboardList className="w-3.5 h-3.5 text-blue-400" />
                <span>Elenco Partite</span>
              </button>
              <div className="text-xs text-slate-400 flex items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span> Vinta
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span> Persa
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span> In Gioco
                </span>
              </div>
            </div>
          </div>

          {/* Desktop Table View (hidden on mobile, visible on sm and up) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse min-w-[820px]">
              <thead>
                <tr className="bg-slate-950/60 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-2 text-center w-10">#</th>
                  <th className="py-3 px-1 text-center w-20">Data</th>
                  <th className="py-3 px-1 text-center w-14">Ora</th>
                  <th className="py-3 px-2 min-w-[140px]">Descrizione Partita</th>
                  <th className="py-3 px-1 text-center w-16">Segno</th>
                  <th className="py-3 px-1 text-center w-16">Prob.</th>
                  <th className="py-3 px-2 text-center w-28">Quota</th>
                  <th className="py-3 px-1 text-center w-20">Value Edge</th>
                  <th className="py-3 px-2 text-center w-28">Puntata</th>
                  <th className="py-3 px-2 text-center w-24">Esito</th>
                  <th className="py-3 px-3 text-right w-24">Cassa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-sans">
                {progression.evaluatedEvents.map((ev, index) => {
                  const isWon = ev.status === 'won';
                  const isLost = ev.status === 'lost';
                  const isPending = ev.status === 'pending';
                  const isClosed = isWon || isLost;
                  const isNext = ev.isNextToPlay;
                  const prevEv = index > 0 ? progression.evaluatedEvents[index - 1] : null;
                  const isPrevFinished = index === 0 || (prevEv ? (prevEv.status === 'won' || prevEv.status === 'lost') : false);
                  const shouldShowStake = !isPending || (index === 0 && progression.status === 'in_progress') || (isPrevFinished && isNext && progression.status === 'in_progress');
                  const valueEdgeStr = calculateEventValueEdge(ev.probability, ev.odds);

                  return (
                    <tr
                      key={ev.id}
                      className={`transition-colors ${
                        isNext
                          ? 'bg-blue-950/25 ring-1 ring-inset ring-blue-500/40'
                          : isWon
                          ? 'bg-emerald-950/15'
                          : isLost
                          ? 'bg-rose-950/15'
                          : 'hover:bg-slate-800/30'
                      }`}
                    >
                      {/* # Index */}
                      <td className="py-2.5 px-2 text-center font-mono font-medium text-slate-400 text-xs">
                        {isNext ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs shadow">
                            {ev.id}
                          </span>
                        ) : (
                          ev.id
                        )}
                      </td>

                      {/* Data (formato GG/MM/AA) */}
                      <td className="py-2.5 px-1 text-center">
                        <input
                          type="text"
                          disabled={isClosed}
                          value={ev.date || ''}
                          onChange={(e) => updateEvent(index, { date: e.target.value })}
                          placeholder="GG/MM/AA"
                          className={`w-18 border rounded px-1.5 py-1.5 text-[11px] text-center font-mono placeholder-slate-600 transition-colors ${
                            isClosed
                              ? 'bg-slate-900/50 border-slate-800 text-slate-500 cursor-not-allowed select-none'
                              : 'bg-slate-950/70 border-slate-800 text-white focus:outline-none focus:border-blue-500'
                          }`}
                          title={isClosed ? 'Partita conclusa (modifiche disabilitate)' : 'Data (formato GG/MM/AA)'}
                        />
                      </td>

                      {/* Ora (formato OO:MM) */}
                      <td className="py-2.5 px-1 text-center">
                        <input
                          type="text"
                          disabled={isClosed}
                          value={ev.time || ''}
                          onChange={(e) => updateEvent(index, { time: e.target.value })}
                          placeholder="OO:MM"
                          className={`w-14 border rounded px-1 py-1.5 text-[11px] text-center font-mono placeholder-slate-600 transition-colors ${
                            isClosed
                              ? 'bg-slate-900/50 border-slate-800 text-slate-500 cursor-not-allowed select-none'
                              : 'bg-slate-950/70 border-slate-800 text-white focus:outline-none focus:border-blue-500'
                          }`}
                          title={isClosed ? 'Partita conclusa (modifiche disabilitate)' : 'Ora inizio (formato OO:MM)'}
                        />
                      </td>

                      {/* Match Description */}
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-1 w-full">
                          <button
                            type="button"
                            disabled={isClosed}
                            onClick={() => setImportTargetIndex(index)}
                            className={`w-6 h-6 rounded flex items-center justify-center shrink-0 shadow-sm transition-all ${
                              isClosed
                                ? 'bg-slate-800 text-slate-600 border border-slate-700/60 cursor-not-allowed opacity-40'
                                : 'bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white cursor-pointer'
                            }`}
                            title={isClosed ? 'Partita conclusa (inserimento disabilitato)' : `Importa partita dall'elenco per l'evento #${ev.id}`}
                          >
                            <Plus className="w-3.5 h-3.5 stroke-[3]" />
                          </button>
                          <input
                            type="text"
                            disabled={isClosed}
                            value={ev.match}
                            onChange={(e) => updateEvent(index, { match: e.target.value })}
                            placeholder={`Partita #${ev.id}`}
                            className={`w-full flex-1 min-w-0 border rounded px-2.5 py-1.5 text-xs placeholder-slate-600 transition-colors ${
                              isClosed
                                ? 'bg-slate-900/50 border-slate-800 text-slate-500 cursor-not-allowed select-none'
                                : 'bg-slate-950/70 border-slate-800 text-white focus:outline-none focus:border-blue-500'
                            }`}
                            title={isClosed ? 'Partita conclusa (modifiche disabilitate)' : undefined}
                          />
                          {ev.match && ev.match.trim().length > 0 && ev.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => clearEventMatch(index)}
                              className="bg-slate-800 hover:bg-rose-950/80 hover:text-rose-400 text-slate-400 border border-slate-700 hover:border-rose-700/60 rounded w-6 h-6 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                              title="Cancella partita dal Masaniello (torna disponibile nell'elenco)"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Market / Sign Dropdown */}
                      <td className="py-2.5 px-1 text-center">
                        <select
                          disabled={isClosed}
                          value={ev.market || ''}
                          onChange={(e) => updateEvent(index, { market: e.target.value })}
                          className={`w-16 border rounded px-1 py-1.5 text-xs text-center font-mono transition-colors ${
                            isClosed
                              ? 'bg-slate-900/50 border-slate-800 text-slate-500 cursor-not-allowed select-none'
                              : 'bg-slate-950/70 border-slate-800 text-white focus:outline-none focus:border-blue-500 cursor-pointer'
                          }`}
                          title={isClosed ? 'Partita conclusa (modifiche disabilitate)' : undefined}
                        >
                          <option value=""></option>
                          <option value="O1.5">O1.5</option>
                          <option value="O2.5">O2.5</option>
                          <option value="U2.5">U2.5</option>
                          <option value="U3.5">U3.5</option>
                          {ev.market && !['', 'O1.5', 'O2.5', 'U2.5', 'U3.5'].includes(ev.market) && (
                            <option value={ev.market}>{ev.market}</option>
                          )}
                        </select>
                      </td>

                      {/* Probabilità NON MODIFICABILE */}
                      <td className="py-2.5 px-1 text-center">
                        <input
                          type="text"
                          readOnly
                          tabIndex={-1}
                          value={
                            ev.probability !== null && ev.probability !== undefined
                              ? `${ev.probability.toFixed(1)}%`
                              : ev.probabilityRaw || '—'
                          }
                          className="w-14 bg-slate-900/60 border border-slate-800/80 rounded px-1 py-1.5 text-xs text-center font-mono text-slate-300 cursor-default select-none focus:outline-none"
                          title="Probabilità (non modificabile a mano, importata dall'elenco partite)"
                        />
                      </td>

                      {/* Quota / Odds */}
                      <td className="py-2.5 px-2">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            disabled={ev.status !== 'pending'}
                            onClick={() => {
                              const newOdds = Math.round((ev.odds - 0.01) * 100) / 100;
                              updateEvent(index, { odds: Math.max(1.01, newOdds) });
                            }}
                            className="bg-blue-950 hover:bg-blue-900 border border-blue-800 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-xs w-6 h-6 rounded flex items-center justify-center shadow-sm cursor-pointer transition-all shrink-0 select-none"
                            title="Riduci quota di 0,01"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            step="0.01"
                            min="1.01"
                            disabled={ev.status !== 'pending'}
                            value={ev.odds}
                            onChange={(e) => updateEvent(index, { odds: Math.max(1.01, parseFloat(e.target.value) || 1.01) })}
                            className={`w-12 text-center border rounded py-1.5 px-0.5 text-xs font-mono transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                              ev.status !== 'pending'
                                ? 'bg-slate-900/50 border-slate-800 text-slate-500 cursor-not-allowed select-none'
                                : 'bg-slate-950/70 border-slate-800 text-white focus:outline-none focus:border-blue-500'
                            }`}
                            title={ev.status !== 'pending' ? 'Quota bloccata per eventi già conclusi (vinta/persa)' : 'Modifica quota'}
                          />
                          <button
                            type="button"
                            disabled={ev.status !== 'pending'}
                            onClick={() => {
                              const newOdds = Math.round((ev.odds + 0.01) * 100) / 100;
                              updateEvent(index, { odds: Math.max(1.01, newOdds) });
                            }}
                            className="bg-blue-950 hover:bg-blue-900 border border-blue-800 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-xs w-6 h-6 rounded flex items-center justify-center shadow-sm cursor-pointer transition-all shrink-0 select-none"
                            title="Aumenta quota di 0,01"
                          >
                            +
                          </button>
                        </div>
                      </td>

                      {/* Value Edge CALCOLATO NON MODIFICABILE A MANO */}
                      <td className="py-2.5 px-1 text-center">
                        <input
                          type="text"
                          readOnly
                          tabIndex={-1}
                          value={valueEdgeStr}
                          className={`w-16 bg-slate-900/60 border border-slate-800/80 rounded px-1 py-1.5 text-xs text-center font-mono cursor-default select-none focus:outline-none font-semibold ${
                            ev.probability && (ev.probability * ev.odds) - 100 > 0
                              ? 'text-emerald-400'
                              : ev.probability && (ev.probability * ev.odds) - 100 < 0
                              ? 'text-rose-400'
                              : 'text-slate-400'
                          }`}
                          title="Value Edge calcolato: (Probabilità * Quota) - 100%. Si ricalcola al variare della quota."
                        />
                      </td>

                      {/* Puntata Calcolata */}
                      <td className="py-2.5 px-2 text-center">
                        {shouldShowStake ? (
                          <span className={`font-mono font-bold text-sm tabular-nums ${
                            isNext ? 'text-cyan-400 text-base' : 'text-slate-200'
                          }`}>
                            € {formatStake(ev.calculatedStake)}
                          </span>
                        ) : (
                          <span
                            className="text-slate-500 font-mono text-sm select-none"
                            title="In attesa dell'esito della partita precedente"
                          >
                            —
                          </span>
                        )}
                      </td>

                      {/* Esito Selector (Caselle piccole V / P / X) */}
                      <td className="py-2.5 px-2">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEventStatus(index, 'won')}
                            className={`w-7 h-7 rounded text-xs font-bold transition-all flex items-center justify-center cursor-pointer shadow-sm ${
                              isWon
                                ? 'bg-emerald-600 text-white ring-1 ring-emerald-400'
                                : 'bg-slate-800/90 text-slate-400 hover:text-emerald-300 hover:bg-emerald-950/60'
                            }`}
                            title="Vinta (V)"
                          >
                            V
                          </button>

                          <button
                            type="button"
                            onClick={() => setEventStatus(index, 'lost')}
                            className={`w-7 h-7 rounded text-xs font-bold transition-all flex items-center justify-center cursor-pointer shadow-sm ${
                              isLost
                                ? 'bg-rose-600 text-white ring-1 ring-rose-400'
                                : 'bg-slate-800/90 text-slate-400 hover:text-rose-300 hover:bg-rose-900/50'
                            }`}
                            title="Persa (P)"
                          >
                            P
                          </button>

                          <button
                            type="button"
                            onClick={() => setEventStatus(index, 'pending')}
                            className={`w-7 h-7 rounded text-xs font-bold transition-all flex items-center justify-center cursor-pointer ${
                              isPending
                                ? 'bg-slate-700/80 text-slate-300'
                                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                            }`}
                            title="Reset (X)"
                          >
                            X
                          </button>
                        </div>
                      </td>

                      {/* Cassa Residua */}
                      <td className="py-2.5 px-3 text-right font-mono font-medium text-xs tabular-nums">
                        {isPending && !isNext ? (
                          <span className="text-slate-600">-</span>
                        ) : (
                          <span className={ev.bankrollAfter >= config.initialBankroll ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                            € {ev.bankrollAfter.toFixed(2)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card / 3-Rows View (visible on portrait / mobile only) */}
          <div className="block sm:hidden divide-y divide-slate-800/80">
            {progression.evaluatedEvents.map((ev, index) => {
              const isWon = ev.status === 'won';
              const isLost = ev.status === 'lost';
              const isPending = ev.status === 'pending';
              const isClosed = isWon || isLost;
              const isNext = ev.isNextToPlay;
              const prevEv = index > 0 ? progression.evaluatedEvents[index - 1] : null;
              const isPrevFinished = index === 0 || (prevEv ? (prevEv.status === 'won' || prevEv.status === 'lost') : false);
              const shouldShowStake = !isPending || (index === 0 && progression.status === 'in_progress') || (isPrevFinished && isNext && progression.status === 'in_progress');
              const valueEdgeStr = calculateEventValueEdge(ev.probability, ev.odds);

              return (
                <div
                  key={ev.id}
                  className={`p-3 space-y-2.5 transition-colors ${
                    isNext
                      ? 'bg-blue-950/30 ring-1 ring-inset ring-blue-500/50'
                      : isWon
                      ? 'bg-emerald-950/20'
                      : isLost
                      ? 'bg-rose-950/20'
                      : 'hover:bg-slate-800/20'
                  }`}
                >
                  {/* Prima riga Mobile: [Data (GG/MM/AA)] [Ora (OO:MM)] [Probabilità] [Value Edge] [Cassa attuale] */}
                  <div className="flex items-center justify-between gap-1.5 w-full">
                    <div className="flex items-center gap-1 min-w-0">
                      {/* Data */}
                      <input
                        type="text"
                        disabled={isClosed}
                        value={ev.date || ''}
                        onChange={(e) => updateEvent(index, { date: e.target.value })}
                        placeholder="GG/MM/AA"
                        className={`w-16 border rounded px-1 py-1 text-[11px] text-center font-mono placeholder-slate-600 transition-colors ${
                          isClosed
                            ? 'bg-slate-900/50 border-slate-800 text-slate-500 cursor-not-allowed select-none'
                            : 'bg-slate-950/70 border-slate-800 text-white focus:outline-none focus:border-blue-500'
                        }`}
                        title={isClosed ? 'Partita conclusa (modifiche disabilitate)' : 'Data (GG/MM/AA)'}
                      />
                      {/* Ora */}
                      <input
                        type="text"
                        disabled={isClosed}
                        value={ev.time || ''}
                        onChange={(e) => updateEvent(index, { time: e.target.value })}
                        placeholder="OO:MM"
                        className={`w-12 border rounded px-1 py-1 text-[11px] text-center font-mono placeholder-slate-600 transition-colors ${
                          isClosed
                            ? 'bg-slate-900/50 border-slate-800 text-slate-500 cursor-not-allowed select-none'
                            : 'bg-slate-950/70 border-slate-800 text-white focus:outline-none focus:border-blue-500'
                        }`}
                        title={isClosed ? 'Partita conclusa (modifiche disabilitate)' : 'Ora (OO:MM)'}
                      />
                      {/* Probabilità NON MODIFICABILE */}
                      <input
                        type="text"
                        readOnly
                        tabIndex={-1}
                        value={
                          ev.probability !== null && ev.probability !== undefined
                            ? `${ev.probability.toFixed(1)}%`
                            : ev.probabilityRaw || '—'
                        }
                        className="w-13 bg-slate-900/60 border border-slate-800/80 rounded px-1 py-1 text-[11px] text-center font-mono text-slate-300 cursor-default select-none focus:outline-none"
                        title="Probabilità (non modificabile a mano)"
                      />
                      {/* Value Edge CALCOLATO NON MODIFICABILE A MANO */}
                      <input
                        type="text"
                        readOnly
                        tabIndex={-1}
                        value={valueEdgeStr}
                        className={`w-14 bg-slate-900/60 border border-slate-800/80 rounded px-1 py-1 text-[11px] text-center font-mono font-semibold cursor-default select-none focus:outline-none ${
                          ev.probability && (ev.probability * ev.odds) - 100 > 0
                            ? 'text-emerald-400'
                            : ev.probability && (ev.probability * ev.odds) - 100 < 0
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }`}
                        title="Value Edge calcolato: si ricalcola al variare della quota"
                      />
                    </div>

                    {/* Cassa attuale alla fine della prima riga */}
                    <div className="text-right font-mono text-xs shrink-0 tabular-nums pl-1">
                      {isPending && !isNext ? (
                        <span className="text-slate-600">-</span>
                      ) : (
                        <span className={ev.bankrollAfter >= config.initialBankroll ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                          €{ev.bankrollAfter.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Seconda riga Mobile: N. partita, [+] e la descrizione partita */}
                  <div className="flex items-center gap-1.5 w-full">
                    <span className="font-mono text-xs font-bold text-slate-400 w-5 shrink-0 text-center">
                      {isNext ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white font-bold text-[11px]">
                          {ev.id}
                        </span>
                      ) : (
                        `#${ev.id}`
                      )}
                    </span>
                    <button
                      type="button"
                      disabled={isClosed}
                      onClick={() => setImportTargetIndex(index)}
                      className={`w-6 h-6 rounded flex items-center justify-center shrink-0 shadow-sm transition-all ${
                        isClosed
                          ? 'bg-slate-800 text-slate-600 border border-slate-700/60 cursor-not-allowed opacity-40'
                          : 'bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white cursor-pointer'
                      }`}
                      title={isClosed ? 'Partita conclusa (inserimento disabilitato)' : `Importa partita dall'elenco per l'evento #${ev.id}`}
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[3]" />
                    </button>
                    <input
                      type="text"
                      disabled={isClosed}
                      value={ev.match}
                      onChange={(e) => updateEvent(index, { match: e.target.value })}
                      placeholder={`Partita #${ev.id}`}
                      className={`flex-1 min-w-0 border rounded px-2 py-1 text-xs placeholder-slate-600 transition-colors ${
                        isClosed
                          ? 'bg-slate-900/50 border-slate-800 text-slate-500 cursor-not-allowed select-none'
                          : 'bg-slate-950/70 border-slate-800 text-white focus:outline-none focus:border-blue-500'
                      }`}
                      title={isClosed ? 'Partita conclusa (modifiche disabilitate)' : undefined}
                    />
                    {ev.match && ev.match.trim().length > 0 && ev.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => clearEventMatch(index)}
                        className="bg-slate-800 hover:bg-rose-950/80 hover:text-rose-400 text-slate-400 border border-slate-700 hover:border-rose-700/60 rounded w-6 h-6 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                        title="Cancella partita (torna disponibile nell'elenco)"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Terza riga Mobile: Non modificare nulla. Quindi Segno | Quota | Puntata € | V P X */}
                  <div className="flex items-center justify-between gap-1 w-full pt-0.5 text-xs">
                    {/* Segno (dimezzato) */}
                    <div className="shrink-0">
                      <select
                        disabled={isClosed}
                        value={ev.market || ''}
                        onChange={(e) => updateEvent(index, { market: e.target.value })}
                        className={`w-14 border rounded px-1 py-1 text-[11px] text-center font-mono transition-colors ${
                          isClosed
                            ? 'bg-slate-900/50 border-slate-800 text-slate-500 cursor-not-allowed select-none'
                            : 'bg-slate-950/70 border-slate-800 text-white focus:outline-none focus:border-blue-500 cursor-pointer'
                        }`}
                        title={isClosed ? 'Partita conclusa (modifiche disabilitate)' : undefined}
                      >
                        <option value=""></option>
                        <option value="O1.5">O1.5</option>
                        <option value="O2.5">O2.5</option>
                        <option value="U2.5">U2.5</option>
                        <option value="U3.5">U3.5</option>
                        {ev.market && !['', 'O1.5', 'O2.5', 'U2.5', 'U3.5'].includes(ev.market) && (
                          <option value={ev.market}>{ev.market}</option>
                        )}
                      </select>
                    </div>

                    {/* Quota con tasti - e + */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        disabled={ev.status !== 'pending'}
                        onClick={() => {
                          const newOdds = Math.round((ev.odds - 0.01) * 100) / 100;
                          updateEvent(index, { odds: Math.max(1.01, newOdds) });
                        }}
                        className="bg-blue-950 hover:bg-blue-900 border border-blue-800 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-xs w-5 h-6 rounded flex items-center justify-center cursor-pointer transition-all shrink-0"
                        title="Riduci 0,01"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        step="0.01"
                        min="1.01"
                        disabled={ev.status !== 'pending'}
                        value={ev.odds}
                        onChange={(e) => updateEvent(index, { odds: Math.max(1.01, parseFloat(e.target.value) || 1.01) })}
                        className={`w-11 text-center border rounded py-1 px-0 text-[11px] font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                          ev.status !== 'pending'
                            ? 'bg-slate-900/50 border-slate-800 text-slate-500 cursor-not-allowed'
                            : 'bg-slate-950/70 border-slate-800 text-white focus:outline-none focus:border-blue-500'
                        }`}
                      />
                      <button
                        type="button"
                        disabled={ev.status !== 'pending'}
                        onClick={() => {
                          const newOdds = Math.round((ev.odds + 0.01) * 100) / 100;
                          updateEvent(index, { odds: Math.max(1.01, newOdds) });
                        }}
                        className="bg-blue-950 hover:bg-blue-900 border border-blue-800 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-xs w-5 h-6 rounded flex items-center justify-center cursor-pointer transition-all shrink-0"
                        title="Aumenta 0,01"
                      >
                        +
                      </button>
                    </div>

                    {/* Puntata Calcolata (SOLO cifra numerica) */}
                    <div className="font-mono text-center shrink-0 px-1">
                      {shouldShowStake ? (
                        <span className={`font-bold tabular-nums text-xs ${
                          isNext ? 'text-cyan-400 font-extrabold text-[13px]' : 'text-slate-200'
                        }`}>
                          €{formatStake(ev.calculatedStake)}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </div>

                    {/* Caselle Piccole V / P / X */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setEventStatus(index, 'won')}
                        className={`w-6 h-6 rounded text-[11px] font-bold transition-all flex items-center justify-center cursor-pointer shadow-sm ${
                          isWon
                            ? 'bg-emerald-600 text-white ring-1 ring-emerald-400'
                            : 'bg-slate-800 text-slate-400 hover:text-emerald-300'
                        }`}
                        title="Vinta (V)"
                      >
                        V
                      </button>
                      <button
                        type="button"
                        onClick={() => setEventStatus(index, 'lost')}
                        className={`w-6 h-6 rounded text-[11px] font-bold transition-all flex items-center justify-center cursor-pointer shadow-sm ${
                          isLost
                            ? 'bg-rose-600 text-white ring-1 ring-rose-400'
                            : 'bg-slate-800 text-slate-400 hover:text-rose-300'
                        }`}
                        title="Persa (P)"
                      >
                        P
                      </button>
                      <button
                        type="button"
                        onClick={() => setEventStatus(index, 'pending')}
                        className={`w-6 h-6 rounded text-[11px] font-bold transition-all flex items-center justify-center cursor-pointer ${
                          isPending
                            ? 'bg-slate-700 text-slate-300'
                            : 'text-slate-500 hover:text-slate-300 bg-slate-850'
                        }`}
                        title="Reset (X)"
                      >
                        X
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Tasti azione in fondo alla pagina: Copia TSV e Scarica PDF */}
        <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-end gap-3 pt-2 pb-6">
          <button
            type="button"
            onClick={handleCopyMasanielloTSV}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-slate-100 text-sm font-semibold rounded-xl shadow-lg shadow-slate-950/40 border border-slate-700 transition-all cursor-pointer"
            title="Copia dati partite in formato TSV negli appunti"
          >
            {copiedMasaTSV ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400">Copiato!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-slate-300" />
                <span>COPIA</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadPDF}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-500 active:scale-[0.98] text-white text-sm font-semibold rounded-xl shadow-lg shadow-red-950/40 border border-red-500/30 transition-all cursor-pointer"
            title={`Scarica scheda in formato PDF (${title || 'Masaniello'}.pdf)`}
          >
            <FileDown className="w-4 h-4" />
            <span>Scarica PDF</span>
          </button>
        </div>
      </main>
      ) : (
        /* Second Page: Elenco Partite */
        <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-5">
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentPage('masaniello')}
                  className="text-xs sm:text-sm bg-blue-600 hover:bg-blue-500 text-white font-medium px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer shrink-0"
                  title="Torna al Masaniello (Chiudi Elenco)"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Chiudi / Torna al Masaniello</span>
                </button>
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-blue-400" />
                    Elenco Partite
                  </h2>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Tasto "Elimina partite" a sinistra del riquadro blu */}
                <button
                  type="button"
                  onClick={openDeleteBeforeModal}
                  className="text-xs sm:text-sm bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 hover:text-white border border-rose-800/60 font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                  title="Elimina partite precedenti alla data e ora specificate"
                >
                  <Clock className="w-3.5 h-3.5 text-rose-400" />
                  <span>Elimina partite</span>
                </button>

                {/* Riquadro blu con Partite e Incolla Elenso */}
                <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setMatchesViewTab('table')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                      matchesViewTab === 'table' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Partite ({parsedMatches.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatchesViewTab('text')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                      matchesViewTab === 'text' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Modifica Elenco
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setMatchesListText('')}
                  className="text-xs sm:text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                  title="Azzera tutto il campo elenco partite"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Azzera</span>
                </button>
              </div>
            </div>

            {/* Legenda Colori Probabilità & Masaniello */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 text-xs flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="font-semibold text-slate-300">Legenda Colori Carattere:</span>
              <span className="flex items-center gap-1.5 font-medium text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span> &lt; 62%: Grigio
              </span>
              <span className="flex items-center gap-1.5 font-medium text-white">
                <span className="w-2.5 h-2.5 rounded-full bg-white"></span> 62% - 64% o non espressa: Bianco
              </span>
              <span className="flex items-center gap-1.5 font-medium text-yellow-400">
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400"></span> &gt; 64% - 66%: Giallo
              </span>
              <span className="flex items-center gap-1.5 font-medium text-sky-400">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400"></span> &gt; 66% - 68%: Azzurro
              </span>
              <span className="flex items-center gap-1.5 font-medium text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span> &gt; 68%: Verde
              </span>
              <span className="flex items-center gap-1.5 font-medium text-red-500 font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span> Squadra nel Masaniello: Rosso
              </span>
            </div>

            {matchesViewTab === 'table' && parsedMatches.length > 0 ? (
              <div className="space-y-3">
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-left text-xs sm:text-sm border-collapse min-w-[750px]">
                    <thead>
                      <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400 sticky top-0">
                        <th className="py-3 px-3 w-10 text-center">#</th>
                        <th className="py-3 px-3 w-24">Data</th>
                        <th className="py-3 px-3 w-20">Ora</th>
                        <th className="py-3 px-3 w-24">Probabilità</th>
                        <th className="py-3 px-3 w-24">Value Edge</th>
                        <th className="py-3 px-3">Partita</th>
                        <th className="py-3 px-3 w-20 text-center">Segno</th>
                        <th className="py-3 px-3 w-24 text-right">Quota Book</th>
                        <th className="py-3 px-3 w-40">Competizione</th>
                        <th className="py-3 px-3 w-28 text-center">Copia</th>
                        <th className="py-3 px-3 w-16 text-center">Elimina</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {parsedMatches.map((m) => {
                        const colorInfo = getMatchColorInfo(m, events);
                        return (
                          <tr
                            key={m.id}
                            className={`hover:bg-slate-800/40 transition-colors ${
                              colorInfo.isInMasaniello ? 'bg-red-950/20' : ''
                            }`}
                          >
                            <td className={`py-2.5 px-3 text-center font-mono font-medium text-xs ${colorInfo.textColorClass}`}>
                              {m.id}
                            </td>
                            <td className={`py-2.5 px-3 font-mono whitespace-nowrap text-xs ${colorInfo.textColorClass}`}>
                              {m.date || '--'}
                            </td>
                            <td className={`py-2.5 px-3 font-mono whitespace-nowrap text-xs ${colorInfo.textColorClass}`}>
                              {m.time || '--:--'}
                            </td>
                            <td className={`py-2.5 px-3 font-mono font-semibold whitespace-nowrap text-xs ${colorInfo.textColorClass}`}>
                              {m.probabilityRaw || (m.probability !== null ? `${m.probability.toFixed(1)}%` : '--')}
                            </td>
                            <td className={`py-2.5 px-3 font-mono whitespace-nowrap text-xs ${colorInfo.textColorClass}`}>
                              {m.valueEdge || '--'}
                            </td>
                            <td className={`py-2.5 px-3 font-medium text-xs sm:text-sm ${colorInfo.textColorClass}`}>
                              <span>{m.match}</span>
                            </td>
                            <td className={`py-2.5 px-3 text-center font-mono font-semibold text-xs ${colorInfo.textColorClass}`}>
                              {m.market ? (
                                <span className={`inline-block px-2 py-0.5 rounded border ${
                                  colorInfo.isInMasaniello
                                    ? 'bg-red-950/40 border-red-800/60 text-red-400'
                                    : 'bg-slate-800/80 border-slate-700 ' + colorInfo.textColorClass
                                }`}>
                                  {m.market}
                                </span>
                              ) : (
                                <span className="text-slate-600">-</span>
                              )}
                            </td>
                            <td className={`py-2.5 px-3 text-right font-mono font-bold text-xs sm:text-sm ${colorInfo.textColorClass}`}>
                              {m.odds.toFixed(2)}
                            </td>
                            <td className={`py-2.5 px-3 text-xs truncate max-w-[180px] ${colorInfo.textColorClass}`}>
                              {m.competition || '--'}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleCopyMatchTSV(m)}
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 hover:text-white shadow-sm transition-all cursor-pointer border border-slate-700"
                                title={`Copia dati di "${m.match}" in formato TSV`}
                              >
                                {copiedMatchId === m.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span className="text-emerald-400 font-bold">Copiato!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-slate-300" />
                                    <span>COPIA</span>
                                  </>
                                )}
                              </button>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {colorInfo.isInMasaniello ? (
                                <button
                                  type="button"
                                  disabled
                                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed opacity-40 transition-colors"
                                  title={`Partita già inserita nel Masaniello: impossibile eliminarla dall'elenco finché è presente nel gioco`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSingleMatch(m)}
                                  className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 hover:text-white border border-rose-800/40 transition-colors cursor-pointer"
                                  title={`Elimina "${m.match}" dall'elenco e dal database`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => setMatchesViewTab('text')}
                    className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>Modifica Elenco (TSV)</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <textarea
                  value={matchesListText}
                  onChange={(e) => setMatchesListText(e.target.value)}
                  placeholder={`17/10/2026\t18:00\tO2.5\t67.5%\tLille - Le Havre\tLigue 1 (Francia)\t1.75\t+4.2%\n17/10/2026\t20:45\t1\t65.0%\tInter - Roma\tSerie A (Italia)\t1.65\t+3.1%\n18/10/2026\t15:00\tU2.5\t63.0%\tMonza - Genoa\tSerie A (Italia)\t1.80\t+1.5%\n18/10/2026\t17:30\tO2.5\t69.2%\tBayern Monaco - Dortmund\tBundesliga (Germania)\t1.55\t+5.8%\n18/10/2026\t21:00\tO1.5\t60.5%\tReal Madrid - Barcellona\tLaLiga (Spagna)\t1.40\t-1.0%`}
                  rows={20}
                  className="w-full min-h-[480px] bg-slate-950/80 border border-slate-800 rounded-xl p-4 font-mono text-xs sm:text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-y leading-relaxed"
                  spellCheck={false}
                />
                {parsedMatches.length > 0 && (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => setMatchesViewTab('table')}
                      className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                    >
                      <ClipboardList className="w-4 h-4" />
                      <span>Visualizza Tabella Partite con Colori ({parsedMatches.length})</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-400 pt-2 gap-2 border-t border-slate-800/60">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>I dati inseriti rimangono memorizzati automaticamente nel browser e sincronizzati con il database.</span>
              </div>
              <button
                type="button"
                onClick={() => setCurrentPage('masaniello')}
                className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Torna al Masaniello</span>
              </button>
            </div>
          </section>
        </main>
      )}

      {/* Confirmation Modal for Reset */}
      {showSyncModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowSyncModal(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-blue-400" /> Carica Masaniello da codice
              </h3>
              <button type="button" onClick={() => setShowSyncModal(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Inserisci il codice mostrato sull'altro dispositivo (codice attuale: <span className="font-mono text-slate-200">{syncCode}</span>).
              Lo stato attuale verrà sostituito da quello salvato.
            </p>
            <form
              onSubmit={e => { e.preventDefault(); loadByCode(codeInput); }}
              className="flex gap-2"
            >
              <input
                autoFocus
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.toUpperCase())}
                placeholder="es. K7PX2M"
                maxLength={32}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono tracking-wider text-white focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={!codeInput.trim() || syncStatus === 'loading'}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer"
              >
                Carica
              </button>
            </form>
            {syncStatus === 'error' && syncError && <p className="text-xs text-rose-300">{syncError}</p>}
          </div>
        </div>
      )}

      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-3 text-rose-400">
              <RotateCcw className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">Nuovo Masaniello</h3>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              I parametri di calcolo e le giocate del Masaniello corrente verranno azzerati. Verrà generato un nuovo codice univoco per il database e il titolo si imposterà automaticamente con la data odierna.
            </p>
            <p className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 rounded-lg p-2.5">
              ✓ L'Elenco Partite (raw matches) non verrà cancellato, rimanendo pronto all'uso.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleFullReset}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                Sì, Crea Nuovo Masaniello
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Elenco Masanielli Salvati nel Database (Ordinamento Inverso: dal più recente al più vecchio) */}
      {showSessionsListModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6" onClick={() => setShowSessionsListModal(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between gap-3 bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowSessionsListModal(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors cursor-pointer shrink-0"
                  title="Chiudi / Torna al Masaniello"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Chiudi</span>
                </button>
                <div className="flex items-center gap-2">
                  <FolderArchive className="w-5 h-5 text-blue-400" />
                  <h3 className="text-sm sm:text-base font-bold text-white">Elenco Masanielli</h3>
                  <span className="text-[11px] font-medium text-slate-400 bg-slate-800 border border-slate-700 rounded px-2 py-0.5">
                    {sessionsList.length} salvati
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleOpenSessionsList}
                  disabled={loadingSessionsList}
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
                  title="Aggiorna elenco dal database"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingSessionsList ? 'animate-spin text-blue-400' : ''}`} />
                  <span className="hidden sm:inline">Aggiorna</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSessionsListModal(false)}
                  className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                  title="Chiudi"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Ricerca / Filtro */}
            <div className="px-4 sm:px-6 py-3 border-b border-slate-800/70 bg-slate-900/40 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={sessionSearchQuery}
                  onChange={(e) => setSessionSearchQuery(e.target.value)}
                  placeholder="Cerca per titolo o codice..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              {sessionSearchQuery && (
                <button
                  type="button"
                  onClick={() => setSessionSearchQuery('')}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Cancella
                </button>
              )}
            </div>

            {/* Lista sessioni ordinate dal più recente al più vecchio */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
              {loadingSessionsList ? (
                <div className="py-16 text-center space-y-3">
                  <Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto" />
                  <p className="text-xs text-slate-400">Interrogazione del database in corso…</p>
                </div>
              ) : sessionsListError ? (
                <div className="py-12 text-center space-y-3 text-rose-300 text-xs">
                  <p>{sessionsListError}</p>
                </div>
              ) : (
                (() => {
                  const query = sessionSearchQuery.trim().toLowerCase();
                  const filtered = sessionsList.filter(s => {
                    if (!query) return true;
                    const t = (s.title || s.state?.title || '').toLowerCase();
                    const c = (s.code || '').toLowerCase();
                    return t.includes(query) || c.includes(query);
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="py-16 text-center space-y-3">
                        <FolderArchive className="w-10 h-10 text-slate-600 mx-auto" />
                        <h4 className="text-sm font-semibold text-slate-300">Nessun Masaniello trovato</h4>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto">
                          {sessionSearchQuery ? 'Nessun risultato corrispondente al filtro di ricerca.' : 'Non ci sono ancora Masanielli salvati nel database.'}
                        </p>
                      </div>
                    );
                  }

                  return filtered.map((item) => {
                    const isActive = syncCode && item.code.toUpperCase() === syncCode.toUpperCase();
                    const sessionTitle = item.title || item.state?.title || 'Masaniello Senza Titolo';
                    const dateStr = item.updatedAt
                      ? new Date(item.updatedAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : '--';
                    const itemConf = item.state?.config;
                    const eventsCount = Array.isArray(item.state?.events) ? item.state.events.length : 0;
                    const playedEventsCount = Array.isArray(item.state?.events)
                      ? (item.state.events as any[]).filter(e => e.status === 'won' || e.status === 'lost').length
                      : 0;

                    return (
                      <div
                        key={item.code}
                        onClick={() => setConfirmSessionToLoad(item)}
                        className={`group border rounded-xl p-4 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          isActive
                            ? 'bg-blue-950/30 border-blue-600/50 hover:border-blue-500'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-950'
                        }`}
                      >
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sm text-white group-hover:text-blue-300 transition-colors truncate">
                              {sessionTitle}
                            </span>
                            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-blue-400">
                              {item.code}
                            </span>
                            {isActive && (
                              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60 flex items-center gap-1">
                                <Check className="w-3 h-3" /> Attivo
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                            <span className="flex items-center gap-1 text-slate-400">
                              <Clock className="w-3.5 h-3.5 text-slate-500" />
                              {dateStr}
                            </span>
                            {itemConf && (
                              <>
                                <span>•</span>
                                <span>Cassa: <strong className="text-slate-200 font-mono">€{itemConf.initialBankroll}</strong></span>
                                <span>•</span>
                                <span>Eventi: <strong className="text-slate-200 font-mono">{itemConf.expectedWins}/{itemConf.totalEvents}</strong></span>
                                <span>•</span>
                                <span>Q. <strong className="text-slate-200 font-mono">{itemConf.averageOdds}</strong></span>
                              </>
                            )}
                            {eventsCount > 0 && (
                              <>
                                <span>•</span>
                                <span>Giocate: <strong className="text-slate-300 font-mono">{playedEventsCount}/{eventsCount}</strong></span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0 pt-2 sm:pt-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmSessionToLoad(item);
                            }}
                            className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                          >
                            <span>Carica</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>
          </div>
        </div>
      )}

      {/* Popup di Conferma Caricamento Masaniello */}
      {confirmSessionToLoad && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setConfirmSessionToLoad(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 text-blue-400">
              <FolderArchive className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">Vuoi caricare questo Masaniello?</h3>
            </div>
            <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3.5 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Titolo:</span>
                <span className="font-semibold text-white truncate max-w-[220px]">
                  {confirmSessionToLoad.title || confirmSessionToLoad.state?.title || 'Senza Titolo'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Codice:</span>
                <span className="font-mono font-semibold text-blue-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                  {confirmSessionToLoad.code}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Data salvataggio:</span>
                <span className="text-slate-300">
                  {new Date(confirmSessionToLoad.updatedAt).toLocaleString('it-IT')}
                </span>
              </div>
              {confirmSessionToLoad.state?.config && (
                <div className="flex justify-between items-center pt-1 border-t border-slate-800/60">
                  <span className="text-slate-400">Parametri:</span>
                  <span className="text-slate-300 font-mono text-[11px]">
                    €{confirmSessionToLoad.state.config.initialBankroll} • {confirmSessionToLoad.state.config.expectedWins}/{confirmSessionToLoad.state.config.totalEvents} • Q.{confirmSessionToLoad.state.config.averageOdds}
                  </span>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Lo stato corrente del Masaniello verrà sostituito con i dati salvati di questa sessione. Vuoi procedere?
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmSessionToLoad(null)}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => {
                  applySession(confirmSessionToLoad);
                  setConfirmSessionToLoad(null);
                  setShowSessionsListModal(false);
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                Sì, Carica Masaniello
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup Modal: Seleziona Partita dall'Elenco Partite */}
      {importTargetIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header: Tasto di chiusura sulla sinistra in alto */}
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between gap-3 bg-slate-950/60">
              <button
                type="button"
                onClick={() => setImportTargetIndex(null)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors cursor-pointer shrink-0"
                title="Chiudi / Torna al Masaniello"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Chiudi / Torna</span>
              </button>
              <button
                type="button"
                onClick={() => setImportTargetIndex(null)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                title="Chiudi"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {parsedMatches.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                    <ClipboardList className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-semibold text-slate-200">Nessuna partita trovata nell'Elenco Partite</h4>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Il campo di testo nella pagina "Elenco Partite" è vuoto. Inserisci o incolla le partite nell'elenco per poterle selezionare.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setImportTargetIndex(null);
                      setCurrentPage('elenco_partite');
                    }}
                    className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
                  >
                    <ClipboardList className="w-4 h-4" />
                    <span>Vai a Elenco Partite</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Legenda Colori nel Popup */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5 text-[11px] flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <span className="font-semibold text-slate-300">Colori:</span>
                    <span className="flex items-center gap-1 font-medium text-slate-400">
                      <span className="w-2 h-2 rounded-full bg-slate-400"></span> &lt; 62% (Grigio)
                    </span>
                    <span className="flex items-center gap-1 font-medium text-white">
                      <span className="w-2 h-2 rounded-full bg-white"></span> 62%-64% / default (Bianco)
                    </span>
                    <span className="flex items-center gap-1 font-medium text-yellow-400">
                      <span className="w-2 h-2 rounded-full bg-yellow-400"></span> &gt; 64%-66% (Giallo)
                    </span>
                    <span className="flex items-center gap-1 font-medium text-sky-400">
                      <span className="w-2 h-2 rounded-full bg-sky-400"></span> &gt; 66%-68% (Azzurro)
                    </span>
                    <span className="flex items-center gap-1 font-medium text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span> &gt; 68% (Verde)
                    </span>
                    <span className="flex items-center gap-1 font-medium text-red-500 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-red-500"></span> Nel Masaniello (Rosso)
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="w-full text-left text-xs sm:text-sm border-collapse min-w-[700px]">
                      <thead>
                        <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400 sticky top-0">
                          <th className="py-3 px-3 w-12 text-center"></th>
                          <th className="py-3 px-3 w-24">Data</th>
                          <th className="py-3 px-3 w-20">Ora</th>
                          <th className="py-3 px-3 w-24">Probabilità</th>
                          <th className="py-3 px-3 w-24">Value Edge</th>
                          <th className="py-3 px-3">Partita</th>
                          <th className="py-3 px-3 w-20 text-center">Segno</th>
                          <th className="py-3 px-3 w-24 text-right">Quota Book</th>
                          <th className="py-3 px-3 w-36 hidden md:table-cell">Competizione</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-sans">
                        {parsedMatches.map((m) => {
                          const colorInfo = getMatchColorInfo(m, events);
                          return (
                            <tr
                              key={m.id}
                              className={`hover:bg-slate-800/40 transition-colors ${
                                colorInfo.isInMasaniello ? 'bg-red-950/20' : ''
                              }`}
                            >
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleSelectMatchForEvent(importTargetIndex, m)}
                                  className={`w-7 h-7 rounded flex items-center justify-center shadow-sm transition-all cursor-pointer mx-auto active:scale-95 text-white ${
                                    colorInfo.isInMasaniello
                                      ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/30 ring-1 ring-blue-400/40'
                                      : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30'
                                  }`}
                                  title={
                                    colorInfo.isInMasaniello
                                      ? `Squadra già presente nel Masaniello: clicca per inserire comunque in posizione #${importTargetIndex + 1}`
                                      : `Inserisci ${m.match} in posizione #${importTargetIndex + 1}`
                                  }
                                >
                                  <Plus className="w-4 h-4 stroke-[3]" />
                                </button>
                              </td>
                              <td className={`py-2.5 px-3 font-mono whitespace-nowrap text-xs ${colorInfo.textColorClass}`}>
                                {m.date || '--'}
                              </td>
                              <td className={`py-2.5 px-3 font-mono whitespace-nowrap text-xs ${colorInfo.textColorClass}`}>
                                {m.time || '--:--'}
                              </td>
                              <td className={`py-2.5 px-3 font-mono font-semibold whitespace-nowrap text-xs ${colorInfo.textColorClass}`}>
                                {m.probabilityRaw || (m.probability !== null ? `${m.probability.toFixed(1)}%` : '--')}
                              </td>
                              <td className={`py-2.5 px-3 font-mono whitespace-nowrap text-xs ${colorInfo.textColorClass}`}>
                                {m.valueEdge || '--'}
                              </td>
                              <td className={`py-2.5 px-3 font-medium text-xs sm:text-sm ${colorInfo.textColorClass}`}>
                                <span>{m.match}</span>
                                {colorInfo.isInMasaniello && (
                                  <span className="ml-2 inline-block text-[10px] font-bold uppercase tracking-wider text-red-400 bg-red-950/80 border border-red-800/60 px-1.5 py-0.5 rounded shadow-sm">
                                    Nel Masaniello
                                  </span>
                                )}
                              </td>
                              <td className={`py-2.5 px-3 text-center font-mono font-semibold text-xs ${colorInfo.textColorClass}`}>
                                {m.market ? (
                                  <span className={`inline-block px-2 py-0.5 rounded border ${
                                    colorInfo.isInMasaniello
                                      ? 'bg-red-950/40 border-red-800/60 text-red-400'
                                      : 'bg-slate-800/80 border-slate-700 ' + colorInfo.textColorClass
                                  }`}>
                                    {m.market}
                                  </span>
                                ) : (
                                  <span className="text-slate-600">-</span>
                                )}
                              </td>
                              <td className={`py-2.5 px-3 text-right font-mono font-bold text-xs sm:text-sm ${colorInfo.textColorClass}`}>
                                {m.odds.toFixed(2)}
                              </td>
                              <td className={`py-2.5 px-3 text-xs truncate max-w-[160px] hidden md:table-cell ${colorInfo.textColorClass}`}>
                                {m.competition || '--'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 sm:p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-mono">
                <span>{parsedMatches.length} partite totali disponibili nell'elenco</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setImportTargetIndex(null);
                    setCurrentPage('elenco_partite');
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 transition-colors cursor-pointer"
                >
                  Modifica Elenco Partite
                </button>
                <button
                  type="button"
                  onClick={() => setImportTargetIndex(null)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors cursor-pointer"
                >
                  Chiudi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modale Elimina Partite Prima di */}
      {showDeleteBeforeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center">
                  <Trash2 className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-base text-white">Elimina partite prima di</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteBeforeModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-300">
                Seleziona la data e l'ora limite. Verranno eliminate dall'elenco tutte le partite programmate prima di tale orario (compreso).
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Data
                  </label>
                  <input
                    type="date"
                    value={deleteBeforeDate}
                    onChange={(e) => setDeleteBeforeDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Ora
                  </label>
                  <input
                    type="time"
                    value={deleteBeforeTime}
                    onChange={(e) => setDeleteBeforeTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                  />
                </div>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs text-slate-400">
                Verranno eliminate tutte le partite prima di: <br />
                <span className="text-white font-mono font-semibold text-sm">
                  {formatDateShort(deleteBeforeDate)} alle {deleteBeforeTime} (comprese)
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowDeleteBeforeModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleExecuteDeleteBefore}
                className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 active:scale-95 text-white rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Elimina</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Configurazione Supabase */}
      {showSupabaseModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
          onClick={() => setShowSupabaseModal(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
                  <Settings className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-base text-white">Configurazione Supabase</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSupabaseModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                title="Chiudi"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form & Body */}
            <form onSubmit={handleSaveSupabaseConfig} className="flex flex-col">
              <div className="p-5 space-y-4">
                <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 leading-relaxed">
                  Le credenziali vengono salvate direttamente nel <strong className="text-white">localStorage</strong> del tuo browser per inizializzare il client Supabase e consentire l'accesso sicuro ai dati del tuo database.
                </div>

                {supabaseConfigError && (
                  <div className="bg-rose-950/60 border border-rose-800/80 text-rose-300 rounded-lg p-2.5 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{supabaseConfigError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    SUPABASE URL *
                  </label>
                  <input
                    type="text"
                    required
                    value={supabaseUrlInput}
                    onChange={(e) => {
                      setSupabaseUrlInput(e.target.value);
                      setSupabaseConfigError('');
                    }}
                    placeholder="https://xyzcompany.supabase.co"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none transition-colors"
                  />
                  <span className="block text-[11px] text-slate-500 mt-1">
                    Es. https://your-project.supabase.co
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    SUPABASE API KEY (PUBLISHABLE / ANON) *
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={supabaseKeyInput}
                    onChange={(e) => {
                      setSupabaseKeyInput(e.target.value);
                      setSupabaseConfigError('');
                    }}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6..."
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none transition-colors resize-y leading-relaxed"
                  />
                  <span className="block text-[11px] text-slate-500 mt-1">
                    Es. chiave anonima (anon / public) generata in Supabase console (Project Settings &gt; API).
                  </span>
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowSupabaseModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 active:scale-95 text-white rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Salva Configurazione</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
