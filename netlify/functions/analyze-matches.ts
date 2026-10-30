import type { Config } from "@netlify/functions";
import { GoogleGenAI } from "@google/genai";
import { sql } from "../../db/index.js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json().catch(() => null);
    const matchesInput = typeof body?.matches === "string" ? body.matches.trim() : "";
    let promptMaster = typeof body?.prompt === "string" ? body.prompt.trim() : "";

    if (!matchesInput) {
      return Response.json({ error: "Nessun palinsesto partite fornito" }, { status: 400 });
    }

    // Se non è stato passato il prompt nel body, leggilo dal database
    if (!promptMaster) {
      try {
        const rows = await sql`
          SELECT prompt
          FROM analysis_prompt_settings
          ORDER BY updated_at DESC, id DESC
          LIMIT 1;
        `;
        if (rows && rows.length > 0 && rows[0].prompt) {
          promptMaster = rows[0].prompt;
        }
      } catch (dbErr) {
        console.warn("Could not load prompt from DB, using fallback:", dbErr);
      }
    }

    if (!promptMaster) {
      promptMaster = `Sei un esperto analista quantitativo di scommesse sportive sul calcio.
Analizza il seguente palinsesto di partite e relative quote (Under/Over 1.5, 2.5, 3.5).
Identifica le partite con il maggior valore atteso (Value Edge) e stima la reale probabilità statistica dell'esito consigliato.

FASE 1: Analisi statistica e comparazione quote bookmaker vs probabilità reale.
FASE 2: Selezione dei migliori pronostici (es. O1.5, O2.5, U2.5, U3.5, 1, X, 2).
FASE 3: Output finale. Restituisci ESCLUSIVAMENTE le selezioni filtrate nel seguente formato TSV rigoroso (campi separati ESCLUSIVAMENTE da carattere TAB reale, una riga per partita, NESSUN markdown, NESSUN commento):

Data [TAB] Ora inizio [TAB] Segno [TAB] Probabilità [TAB] Partita [TAB] Competizione (Nazione) [TAB] Quota Book [TAB] Value Edge`;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Chiave GEMINI_API_KEY non trovata nell'ambiente server." },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });
    const fullContent = `${promptMaster}\n\nPalinsesto Partite da analizzare:\n${matchesInput}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: fullContent,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const outputText = response.text || "";
    return Response.json({ output: outputText });
  } catch (err: any) {
    console.error("Error in analyze-matches function:", err);
    return Response.json(
      { error: err?.message || "Errore durante l'analisi con Gemini AI" },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: "/api/analyze-matches",
};
