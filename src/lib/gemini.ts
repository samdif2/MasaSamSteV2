import { GoogleGenAI } from "@google/genai";
import type { SingleMatchData } from "./api";

export const GEMINI_KEY_STORAGE = "masaniello_gemini_api_key";
let cachedServerKey: string | null = null;

/**
 * Valida che una stringa sia una chiave API valida (non vuota, non placeholder, non undefined)
 */
export function isValidApiKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (
    trimmed === "undefined" ||
    trimmed === "null" ||
    trimmed === '""' ||
    trimmed === "''" ||
    trimmed === "false"
  ) {
    return false;
  }
  if (
    trimmed.toLowerCase().includes("your_api_key") ||
    trimmed.toLowerCase().includes("inserisci_qui")
  ) {
    return false;
  }
  return trimmed.length >= 8;
}

/**
 * Recupera la chiave API salvata manualmente dall'utente nel browser (localStorage)
 */
export function getStoredCustomGeminiApiKey(): string {
  try {
    const val = localStorage.getItem(GEMINI_KEY_STORAGE)?.trim() || "";
    return isValidApiKey(val) ? val : "";
  } catch {
    return "";
  }
}

/**
 * Salva la chiave API personalizzata nel localStorage del browser
 */
export function saveCustomGeminiApiKey(key: string): void {
  try {
    const clean = key.trim();
    if (clean && isValidApiKey(clean)) {
      localStorage.setItem(GEMINI_KEY_STORAGE, clean);
      cachedServerKey = clean;
    } else {
      localStorage.removeItem(GEMINI_KEY_STORAGE);
      if (cachedServerKey === clean) {
        cachedServerKey = null;
      }
    }
  } catch { /* ignore */ }
}

/**
 * Recupera la chiave API di Gemini seguendo l'ordine di priorità:
 * 1. Da localStorage (chiave personalizzata inserita dall'utente nelle Impostazioni Prompt)
 * 2. Dalle variabili d'ambiente Vite lato client (import.meta.env.VITE_GEMINI_API_KEY)
 * 3. Dalla variabile d'ambiente process.env.GEMINI_API_KEY
 * 4. Dalla variabile d'ambiente import.meta.env.GEMINI_API_KEY
 * 5. Dalla cache della chiave server recuperata in precedenza
 * 6. Dall'endpoint server /api/gemini-config
 */
export async function getEffectiveGeminiApiKey(): Promise<string> {
  // 1. Chiave personalizzata salvata nel browser dall'utente
  const custom = getStoredCustomGeminiApiKey();
  if (isValidApiKey(custom)) {
    return custom;
  }

  // 2. Variabile d'ambiente Vite lato client
  try {
    const envKey = (import.meta.env?.VITE_GEMINI_API_KEY as string | undefined)?.trim();
    if (isValidApiKey(envKey)) {
      return envKey;
    }
  } catch { /* ignore */ }

  // 3. Variabile d'ambiente process.env.GEMINI_API_KEY
  try {
    // @ts-ignore
    const procKey = (typeof process !== "undefined" && process?.env?.GEMINI_API_KEY as string | undefined)?.trim();
    if (isValidApiKey(procKey)) {
      return procKey;
    }
  } catch { /* ignore */ }

  // 4. Variabile d'ambiente import.meta.env.GEMINI_API_KEY
  try {
    // @ts-ignore
    const metaProcKey = (import.meta.env?.GEMINI_API_KEY as string | undefined)?.trim();
    if (isValidApiKey(metaProcKey)) {
      return metaProcKey;
    }
  } catch { /* ignore */ }

  // 5. Cache della chiave server recuperata in precedenza
  if (isValidApiKey(cachedServerKey)) {
    return cachedServerKey;
  }

  // 6. Chiamata all'endpoint serverless (/api/gemini-config)
  try {
    const res = await fetch("/api/gemini-config");
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (isValidApiKey(data?.apiKey)) {
        const cleanKey = data.apiKey.trim();
        cachedServerKey = cleanKey;
        return cleanKey;
      }
    }
  } catch (err) {
    console.warn("Could not fetch gemini-config from server:", err);
  }

  return "";
}

/**
 * Esegue l'analisi massiva delle partite direttamente dal browser via @google/genai.
 * Questa chiamata diretta evita il Gateway Timeout 504 di Netlify.
 */
export async function analyzeMatchesDirect(
  matchesInput: string,
  promptMaster: string,
  signal?: AbortSignal
): Promise<string> {
  // Verifica preventiva della presenza della API Key
  const apiKey = await getEffectiveGeminiApiKey();
  if (!isValidApiKey(apiKey)) {
    throw new Error(
      "Inserisci una API Key di Google Gemini valida nelle Impostazioni."
    );
  }

  const prompt = promptMaster.trim() || `Sei un esperto analista quantitativo di scommesse sportive sul calcio.
Analizza il seguente palinsesto di partite e relative quote (Under/Over 1.5, 2.5, 3.5).
Identifica le partite con il maggior valore atteso (Value Edge) e stima la reale probabilità statistica dell'esito consigliato.

FASE 1: Analisi statistica e comparazione quote bookmaker vs probabilità reale.
FASE 2: Selezione dei migliori pronostici (es. O1.5, O2.5, U2.5, U3.5, 1, X, 2).
FASE 3: Output finale. Restituisci ESCLUSIVAMENTE le selezioni filtrate nel seguente formato TSV rigoroso (campi separati ESCLUSIVAMENTE da carattere TAB reale, una riga per partita, NESSUN markdown, NESSUN commento):

Data [TAB] Ora inizio [TAB] Segno [TAB] Probabilità [TAB] Partita [TAB] Competizione (Nazione) [TAB] Quota Book [TAB] Value Edge`;

  const fullContent = `${prompt}\n\nPalinsesto Partite da analizzare:\n${matchesInput.trim()}`;

  try {
    const ai = new GoogleGenAI({ apiKey });

    const generatePromise = ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: fullContent,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    let response;
    if (signal) {
      if (signal.aborted) {
        const abortErr = new Error("The user aborted a request.");
        abortErr.name = "AbortError";
        throw abortErr;
      }
      const abortPromise = new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            const abortErr = new Error("The user aborted a request.");
            abortErr.name = "AbortError";
            reject(abortErr);
          },
          { once: true }
        );
      });
      response = await Promise.race([generatePromise, abortPromise]);
    } else {
      response = await generatePromise;
    }

    const output = response.text || "";
    if (!output.trim()) {
      throw new Error("L'IA non ha restituito alcun testo o selezione. Verifica il palinsesto inserito.");
    }

    return output.trim();
  } catch (err: any) {
    const rawMsg = err?.message || "";
    if (
      rawMsg.includes("API key not valid") ||
      rawMsg.includes("API_KEY_INVALID") ||
      rawMsg.includes("pass a valid API key")
    ) {
      throw new Error("Inserisci una API Key di Google Gemini valida nelle Impostazioni.");
    }
    throw err;
  }
}

/**
 * Esegue l'analisi della singola partita direttamente dal browser via @google/genai.
 */
export async function analyzeSingleMatchDirect(
  matchData: SingleMatchData,
  customPrompt?: string,
  signal?: AbortSignal
): Promise<string> {
  // Verifica preventiva della presenza della API Key
  const apiKey = await getEffectiveGeminiApiKey();
  if (!isValidApiKey(apiKey)) {
    throw new Error(
      "Inserisci una API Key di Google Gemini valida nelle Impostazioni."
    );
  }

  const matchInfoText = `
Dati della Partita da analizzare:
- Partita: ${matchData.match || 'N/D'}
- Competizione (Nazione): ${matchData.competition || 'N/D'}
- Data: ${matchData.date || 'N/D'}
- Ora: ${matchData.time || 'N/D'}
- Segno Selezionato: ${matchData.market || 'N/D'}
- Probabilità Stimata: ${matchData.probabilityRaw || (matchData.probability ? matchData.probability + '%' : 'N/D')}
- Quota Book Iniziale: ${matchData.originalOdds ? Number(matchData.originalOdds).toFixed(2) : 'N/D'}
- Quota Aggiornata: ${matchData.updatedOdds ? Number(matchData.updatedOdds).toFixed(2) : 'N/D'}
- Value Edge: ${matchData.valueEdge || 'N/D'}
  `.trim();

  let fullPrompt = "";
  if (customPrompt && customPrompt.trim()) {
    fullPrompt = `${customPrompt.trim()}\n\n${matchInfoText}`;
  } else {
    fullPrompt = `Sei un analista sportivo e quantitativo professionista di scommesse calcistiche.
Esegui un'analisi dettagliata, approfondita e professionale in tempo reale per la singola partita indicata di seguito.
Utilizza la ricerca web per raccogliere gli ultimi dati disponibili (stato di forma, formazioni probabili, infortuni/squalifiche, precedenti testa a testa, statistiche gol fatti/subiti, trend Under/Over e motivazioni di classifica).

${matchInfoText}

Fornisci un report strutturato, chiaro ed elegante con le seguenti sezioni:
1. PANORAMICA DEL MATCH & CONTESTO DI CLASSIFICA
2. STATISTICHE RECENTI, FORMA E PRECEDENTI TESTA A TESTA (H2H)
3. NEWS DELL'ULTIM'ORA: INFORTUNI, SQUALIFICHE E PROBABILI FORMAZIONI
4. ANALISI DEL SEGNO SELEZIONATO (${matchData.market || 'Esito'}) E CONFRONTO QUOTA (Quota Aggiornata: ${matchData.updatedOdds ? Number(matchData.updatedOdds).toFixed(2) : 'N/D'})
5. VALUTAZIONE VALUE EDGE E VERDETTO FINALE
`;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const generatePromise = ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: fullPrompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    let response;
    if (signal) {
      if (signal.aborted) {
        const abortErr = new Error("The user aborted a request.");
        abortErr.name = "AbortError";
        throw abortErr;
      }
      const abortPromise = new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            const abortErr = new Error("The user aborted a request.");
            abortErr.name = "AbortError";
            reject(abortErr);
          },
          { once: true }
        );
      });
      response = await Promise.race([generatePromise, abortPromise]);
    } else {
      response = await generatePromise;
    }

    const output = response.text || "";
    if (!output.trim()) {
      throw new Error("L'IA non ha restituito alcun testo per la partita selezionata.");
    }

    return output.trim();
  } catch (err: any) {
    const rawMsg = err?.message || "";
    if (
      rawMsg.includes("API key not valid") ||
      rawMsg.includes("API_KEY_INVALID") ||
      rawMsg.includes("pass a valid API key")
    ) {
      throw new Error("Inserisci una API Key di Google Gemini valida nelle Impostazioni.");
    }
    throw err;
  }
}
