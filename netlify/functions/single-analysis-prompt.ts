import type { Config } from "@netlify/functions";
import { sql } from "../../db/index.js";

// GET  /api/single-analysis-prompt -> returns the latest single match prompt { prompt: string, updatedAt: string }
// POST /api/single-analysis-prompt -> saves a new single match prompt { prompt: string }
let schemaInitialized = false;
async function ensureSinglePromptSchema() {
  if (schemaInitialized) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS single_analysis_prompt_settings (
        id SERIAL PRIMARY KEY,
        prompt TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      );
    `;
    schemaInitialized = true;
  } catch (err) {
    console.warn("Could not ensure single_analysis_prompt_settings schema:", err);
  }
}

export default async (req: Request) => {
  try {
    await ensureSinglePromptSchema();

    if (req.method === "GET") {
      let rows: any[] = [];
      try {
        rows = await sql`
          SELECT prompt, updated_at as "updatedAt"
          FROM single_analysis_prompt_settings
          ORDER BY updated_at DESC, id DESC
          LIMIT 1;
        `;
      } catch (err: any) {
        console.warn("Error reading single_analysis_prompt_settings:", err);
      }
      return Response.json(rows[0] ?? { prompt: "", updatedAt: new Date().toISOString() });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (typeof body?.prompt !== "string") {
        return Response.json({ error: "prompt must be a string" }, { status: 400 });
      }

      const rows = await sql`
        INSERT INTO single_analysis_prompt_settings (prompt, updated_at)
        VALUES (${body.prompt}, now())
        RETURNING prompt, updated_at as "updatedAt";
      `;
      return Response.json(rows[0] ?? { prompt: body.prompt, updatedAt: new Date().toISOString() }, { status: 201 });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err: any) {
    console.error("Netlify function error in single-analysis-prompt:", err);
    return Response.json(
      { error: `Database SQL error: ${err?.message || String(err)}` },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: "/api/single-analysis-prompt",
};
