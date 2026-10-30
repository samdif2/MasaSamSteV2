import type { Config } from "@netlify/functions";
import { GoogleGenAI } from "@google/genai";
import { sql } from "../../db/index.js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json().catch(() => null);
    const matchData = body?.matchData;
    let customPrompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

    if (!matchData || typeof matchData !== "object") {
      return Response.json({ error: "Dati della partita mancanti o non validi" }, { status: 400 });
    }

    // Se non è stato passato il prompt nel body, leggilo dal database
    if (!customPrompt) {
      try {
        const rows = await sql`
          SELECT prompt
          FROM single_analysis_prompt_settings
          ORDER BY updated_at DESC, id DESC
          LIMIT 1;
        `;
        if (rows && rows.length > 0 && typeof rows[0].prompt === "string") {
          customPrompt = rows[0].prompt.trim();
        }
      } catch (dbErr) {
        console.warn("Could not load single analysis prompt from DB:", dbErr);
      }
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

    let fullPrompt = '';
    if (customPrompt) {
      fullPrompt = `${customPrompt}\n\n${matchInfoText}`;
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Chiave GEMINI_API_KEY non trovata nell'ambiente server." },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: fullPrompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const outputText = response.text || "";
    return Response.json({ output: outputText });
  } catch (err: any) {
    console.error("Error in analyze-single-match function:", err);
    return Response.json(
      { error: err?.message || "Errore durante l'analisi singola con Gemini AI" },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: "/api/analyze-single-match",
};
