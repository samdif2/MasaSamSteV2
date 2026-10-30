import type { Config, Context } from "@netlify/functions";
import { sql } from "../../db/index.js";

// GET /api/sessions/latest -> most recently saved session (or null)
// GET /api/sessions/list   -> all sessions ordered from newest to oldest
// GET /api/sessions/:code  -> session for a sync code (404 if missing)
// PUT /api/sessions/:code  -> create or overwrite the session state and title
const CODE_RE = /^[A-Za-z0-9_-]{3,32}$/;
const MAX_STATE_BYTES = 1_000_000;

let schemaInitialized = false;
async function ensureTableSchema() {
  if (schemaInitialized) return;
  try {
    // Esegue query di inizializzazione sicura con tagged template literal: sql`ALTER TABLE ...`
    await sql`ALTER TABLE IF EXISTS masaniello_sessions ADD COLUMN IF NOT EXISTS title TEXT;`;
  } catch (err) {
    console.warn("Could not alter masaniello_sessions (continuing anyway):", err);
  }
  try {
    await sql`ALTER TABLE IF EXISTS masaniellos ADD COLUMN IF NOT EXISTS title TEXT;`;
  } catch {
    // ignore
  }
  schemaInitialized = true;
}

export default async (req: Request, context: Context) => {
  try {
    await ensureTableSchema();
    const code = context.params.code;

    // GET /api/sessions/list or /api/sessions/all
    if (req.method === "GET" && (code === "list" || code === "all")) {
      let rows: any[] = [];
      try {
        // Query tagged template per recuperare tutti i Masanielli dal più recente al più vecchio
        rows = await sql`
          SELECT code, title, state, updated_at as "updatedAt"
          FROM masaniello_sessions
          ORDER BY updated_at DESC;
        `;
      } catch (selectErr) {
        console.warn("Primary select failed, attempting fallback query without title:", selectErr);
        try {
          rows = await sql`
            SELECT code, state, updated_at as "updatedAt"
            FROM masaniello_sessions
            ORDER BY updated_at DESC;
          `;
        } catch (rawErr: any) {
          return Response.json(
            { error: `Database SQL error selecting sessions: ${rawErr?.message || String(rawErr)}` },
            { status: 500 }
          );
        }
      }

      // Se title è nullo o vuoto, restituisce valore di fallback "Masa senza titolo"
      const sanitized = rows.map((r: any) => {
        const rawState = typeof r.state === "string" ? JSON.parse(r.state) : r.state;
        const rawTitle = typeof r.title === "string" && r.title.trim()
          ? r.title.trim()
          : (typeof rawState?.title === "string" && rawState.title.trim()
            ? rawState.title.trim()
            : "Masa senza titolo");

        return {
          code: r.code,
          title: rawTitle,
          state: rawState,
          updatedAt: r.updatedAt || r.updated_at || new Date().toISOString(),
        };
      });

      return Response.json(sanitized);
    }

    // GET /api/sessions/latest
    if (req.method === "GET" && code === "latest") {
      let rows: any[] = [];
      try {
        rows = await sql`
          SELECT code, title, state, updated_at as "updatedAt"
          FROM masaniello_sessions
          ORDER BY updated_at DESC
          LIMIT 1;
        `;
      } catch (err) {
        try {
          rows = await sql`
            SELECT code, state, updated_at as "updatedAt"
            FROM masaniello_sessions
            ORDER BY updated_at DESC
            LIMIT 1;
          `;
        } catch (rawErr: any) {
          return Response.json(
            { error: `Database SQL error selecting latest session: ${rawErr?.message || String(rawErr)}` },
            { status: 500 }
          );
        }
      }

      if (!rows || rows.length === 0) return Response.json(null);
      const r = rows[0];
      const rawState = typeof r.state === "string" ? JSON.parse(r.state) : r.state;
      const rawTitle = typeof r.title === "string" && r.title.trim()
        ? r.title.trim()
        : (typeof rawState?.title === "string" && rawState.title.trim()
          ? rawState.title.trim()
          : "Masa senza titolo");

      return Response.json({
        code: r.code,
        title: rawTitle,
        state: rawState,
        updatedAt: r.updatedAt || r.updated_at,
      });
    }

    if (!code || !CODE_RE.test(code)) {
      return Response.json({ error: "Invalid code: use 3-32 letters, digits, - or _" }, { status: 400 });
    }
    const normalized = code.toUpperCase();

    // GET /api/sessions/:code (lettura del codice tramite tagged template sql`...`)
    if (req.method === "GET") {
      let rows: any[] = [];
      try {
        rows = await sql`
          SELECT code, title, state, updated_at as "updatedAt"
          FROM masaniello_sessions
          WHERE UPPER(code) = ${normalized};
        `;
      } catch (err) {
        try {
          rows = await sql`
            SELECT code, state, updated_at as "updatedAt"
            FROM masaniello_sessions
            WHERE UPPER(code) = ${normalized};
          `;
        } catch (rawErr: any) {
          return Response.json(
            { error: `Database SQL error getting session: ${rawErr?.message || String(rawErr)}` },
            { status: 500 }
          );
        }
      }

      if (!rows || rows.length === 0) return Response.json({ error: "Code not found" }, { status: 404 });
      const r = rows[0];
      const rawState = typeof r.state === "string" ? JSON.parse(r.state) : r.state;
      const rawTitle = typeof r.title === "string" && r.title.trim()
        ? r.title.trim()
        : (typeof rawState?.title === "string" && rawState.title.trim()
          ? rawState.title.trim()
          : "Masa senza titolo");

      return Response.json({
        code: r.code,
        title: rawTitle,
        state: rawState,
        updatedAt: r.updatedAt || r.updated_at,
      });
    }

    // PUT /api/sessions/:code (salvataggio della sessione tramite tagged template sql`...`)
    if (req.method === "PUT") {
      const text = await req.text();
      if (text.length > MAX_STATE_BYTES) return Response.json({ error: "State too large" }, { status: 413 });
      let body: any;
      try {
        body = JSON.parse(text);
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      const state = body?.state;
      if (!state || typeof state !== "object" || !state.config || !Array.isArray(state.events)) {
        return Response.json({ error: "state must include config and events" }, { status: 400 });
      }

      const titleVal = typeof body?.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 255)
        : (typeof state?.title === "string" && state.title.trim()
          ? state.title.trim().slice(0, 255)
          : "Masa senza titolo");

      state.title = titleVal;
      const stateJson = JSON.stringify(state);

      let rows: any[] = [];
      try {
        // Tagged template UPSERT con gestione del campo title e state
        rows = await sql`
          INSERT INTO masaniello_sessions (code, title, state, updated_at)
          VALUES (${normalized}, ${titleVal}, ${stateJson}::jsonb, now())
          ON CONFLICT (code) DO UPDATE
          SET title = EXCLUDED.title,
              state = EXCLUDED.state,
              updated_at = now()
          RETURNING code, title, state, updated_at as "updatedAt";
        `;
      } catch (insertErr) {
        console.warn("Primary upsert with title failed, attempting fallback upsert without title column:", insertErr);
        try {
          rows = await sql`
            INSERT INTO masaniello_sessions (code, state, updated_at)
            VALUES (${normalized}, ${stateJson}::jsonb, now())
            ON CONFLICT (code) DO UPDATE
            SET state = EXCLUDED.state,
                updated_at = now()
            RETURNING code, state, updated_at as "updatedAt";
          `;
        } catch (dbErr: any) {
          return Response.json(
            { error: `Database SQL error saving session: ${dbErr?.message || String(dbErr)}` },
            { status: 500 }
          );
        }
      }

      const r = rows[0];
      const savedState = typeof r.state === "string" ? JSON.parse(r.state) : r.state;

      return Response.json({
        code: r.code,
        title: r.title || titleVal,
        state: savedState,
        updatedAt: r.updatedAt || r.updated_at || new Date().toISOString(),
      });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (fatalError: any) {
    console.error("Unhandled Netlify function error in sessions:", fatalError);
    return Response.json(
      {
        error: `Database SQL error: ${fatalError?.message || String(fatalError)}`,
        details: String(fatalError),
      },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: "/api/sessions/:code",
};
