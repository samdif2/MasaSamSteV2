import 'dotenv/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import { GoogleGenAI } from '@google/genai';

function apiDevPlugin(): Plugin {
  const sessionsMap = new Map<string, any>();
  const settingsList: any[] = [];
  const rawMatchesList: any[] = [];
  let currentAnalysisPrompt: any = null;
  let currentSingleAnalysisPrompt: any = { prompt: '', updatedAt: new Date().toISOString() };

  return {
    name: 'api-dev-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost:3000');
        const pathname = url.pathname;

        let body = '';
        req.on('data', (chunk: any) => { body += chunk; });
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');

          // /api/gemini-config
          if (pathname === '/api/gemini-config') {
            const apiKey = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '').trim();
            res.statusCode = 200;
            return res.end(JSON.stringify({ apiKey }));
          }

          // /api/analysis-prompt
          if (pathname === '/api/analysis-prompt') {
            if (req.method === 'GET') {
              res.statusCode = 200;
              return res.end(JSON.stringify(currentAnalysisPrompt));
            }
            if (req.method === 'POST') {
              try {
                const parsed = JSON.parse(body);
                currentAnalysisPrompt = {
                  prompt: parsed.prompt,
                  updatedAt: new Date().toISOString(),
                };
                res.statusCode = 201;
                return res.end(JSON.stringify(currentAnalysisPrompt));
              } catch {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Invalid body' }));
              }
            }
          }

          // /api/analyze-matches
          if (pathname === '/api/analyze-matches' && req.method === 'POST') {
            try {
              const parsed = JSON.parse(body);
              const matchesInput = typeof parsed?.matches === 'string' ? parsed.matches.trim() : '';
              let promptMaster = typeof parsed?.prompt === 'string' ? parsed.prompt.trim() : '';

              if (!matchesInput) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Nessun palinsesto partite fornito' }));
              }

              if (!promptMaster && currentAnalysisPrompt?.prompt) {
                promptMaster = currentAnalysisPrompt.prompt;
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
                res.statusCode = 500;
                return res.end(JSON.stringify({ error: "Chiave GEMINI_API_KEY non trovata nell'ambiente server." }));
              }

              const ai = new GoogleGenAI({ apiKey });
              const fullContent = `${promptMaster}\n\nPalinsesto Partite da analizzare:\n${matchesInput}`;

              const response = await ai.models.generateContent({
                model: 'gemini-3.8-flash',
                contents: fullContent,
                config: {
                  tools: [{ googleSearch: {} }],
                },
              });

              const outputText = response.text || '';
              res.statusCode = 200;
              return res.end(JSON.stringify({ output: outputText }));
            } catch (err: any) {
              console.error('Error in analyze-matches dev endpoint:', err);
              res.statusCode = 500;
              return res.end(JSON.stringify({ error: err?.message || "Errore durante l'analisi con Gemini AI" }));
            }
          }

          // /api/single-analysis-prompt
          if (pathname === '/api/single-analysis-prompt') {
            if (req.method === 'GET') {
              res.statusCode = 200;
              return res.end(JSON.stringify(currentSingleAnalysisPrompt ?? { prompt: '', updatedAt: new Date().toISOString() }));
            }
            if (req.method === 'POST') {
              try {
                const parsed = JSON.parse(body);
                currentSingleAnalysisPrompt = {
                  prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
                  updatedAt: new Date().toISOString(),
                };
                res.statusCode = 201;
                return res.end(JSON.stringify(currentSingleAnalysisPrompt));
              } catch {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Invalid body' }));
              }
            }
          }

          // /api/analyze-single-match
          if (pathname === '/api/analyze-single-match' && req.method === 'POST') {
            try {
              const parsed = JSON.parse(body);
              const matchData = parsed?.matchData;
              let customPrompt = typeof parsed?.prompt === 'string' ? parsed.prompt.trim() : '';

              if (!matchData) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Dati della partita mancanti' }));
              }

              if (!customPrompt && currentSingleAnalysisPrompt?.prompt) {
                customPrompt = currentSingleAnalysisPrompt.prompt.trim();
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
                res.statusCode = 500;
                return res.end(JSON.stringify({ error: "Chiave GEMINI_API_KEY non trovata nell'ambiente server." }));
              }

              const ai = new GoogleGenAI({ apiKey });
              const response = await ai.models.generateContent({
                model: 'gemini-3.8-flash',
                contents: fullPrompt,
                config: {
                  tools: [{ googleSearch: {} }],
                },
              });

              const outputText = response.text || '';
              res.statusCode = 200;
              return res.end(JSON.stringify({ output: outputText }));
            } catch (err: any) {
              console.error('Error in analyze-single-match dev endpoint:', err);
              res.statusCode = 500;
              return res.end(JSON.stringify({ error: err?.message || "Errore durante l'analisi singola con Gemini AI" }));
            }
          }

          // /api/sessions/list or /api/sessions/all
          if (pathname === '/api/sessions/list' || pathname === '/api/sessions/all') {
            if (req.method === 'GET') {
              const all = Array.from(sessionsMap.values()).sort(
                (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
              ).map((s: any) => ({
                ...s,
                title: typeof s.title === 'string' && s.title.trim()
                  ? s.title.trim()
                  : (typeof s.state?.title === 'string' && s.state.title.trim()
                    ? s.state.title.trim()
                    : 'Masa senza titolo')
              }));
              res.statusCode = 200;
              return res.end(JSON.stringify(all));
            }
          }

          // /api/sessions/latest
          if (pathname === '/api/sessions/latest') {
            if (req.method === 'GET') {
              const all = Array.from(sessionsMap.values()).sort(
                (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
              );
              const latest = all[0] ?? null;
              if (latest) {
                const title = typeof latest.title === 'string' && latest.title.trim()
                  ? latest.title.trim()
                  : (typeof latest.state?.title === 'string' && latest.state.title.trim()
                    ? latest.state.title.trim()
                    : 'Masa senza titolo');
                res.statusCode = 200;
                return res.end(JSON.stringify({ ...latest, title }));
              }
              res.statusCode = 200;
              return res.end(JSON.stringify(null));
            }
          }

          // /api/sessions/:code
          const sessionMatch = pathname.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)$/);
          if (sessionMatch) {
            const code = sessionMatch[1].toUpperCase();
            if (req.method === 'GET') {
              const s = sessionsMap.get(code);
              if (!s) {
                res.statusCode = 404;
                return res.end(JSON.stringify({ error: 'Code not found' }));
              }
              res.statusCode = 200;
              return res.end(JSON.stringify(s));
            }
            if (req.method === 'PUT') {
              try {
                const parsed = JSON.parse(body);
                const title = parsed.title || parsed.state?.title || null;
                const session = {
                  code,
                  title,
                  state: parsed.state,
                  updatedAt: new Date().toISOString(),
                };
                sessionsMap.set(code, session);
                res.statusCode = 200;
                return res.end(JSON.stringify(session));
              } catch {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Invalid JSON' }));
              }
            }
          }

          // /api/settings
          if (pathname === '/api/settings') {
            if (req.method === 'GET') {
              const latest = url.searchParams.has('latest');
              res.statusCode = 200;
              return res.end(JSON.stringify(latest ? (settingsList[settingsList.length - 1] ?? null) : settingsList));
            }
            if (req.method === 'POST') {
              try {
                const parsed = JSON.parse(body);
                const item = { ...parsed, id: settingsList.length + 1, createdAt: new Date().toISOString() };
                settingsList.push(item);
                res.statusCode = 201;
                return res.end(JSON.stringify(item));
              } catch {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Invalid body' }));
              }
            }
          }

          // /api/raw-matches
          if (pathname === '/api/raw-matches') {
            if (req.method === 'GET') {
              const latest = url.searchParams.has('latest');
              res.statusCode = 200;
              return res.end(JSON.stringify(latest ? (rawMatchesList[rawMatchesList.length - 1] ?? null) : rawMatchesList));
            }
            if (req.method === 'POST') {
              try {
                const parsed = JSON.parse(body);
                const item = { id: rawMatchesList.length + 1, rawText: parsed.raw_text, createdAt: new Date().toISOString() };
                rawMatchesList.push(item);
                res.statusCode = 201;
                return res.end(JSON.stringify(item));
              } catch {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Invalid body' }));
              }
            }
          }

          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'Not found' }));
        });
      });
    },
  };
}

export default defineConfig(() => {
  const geminiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
  return {
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey),
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(geminiKey),
    },
    plugins: [react(), tailwindcss(), apiDevPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
