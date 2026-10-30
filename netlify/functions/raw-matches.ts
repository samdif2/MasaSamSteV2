import type { Config } from "@netlify/functions";
import { sql } from "../../db/index.js";

// GET  /api/raw-matches          -> all pasted lists, newest first
// GET  /api/raw-matches?latest=1 -> only the most recent paste (or null)
// POST /api/raw-matches          -> store a new pasted list { raw_text }
export default async (req: Request) => {
  try {
    if (req.method === "GET") {
      const latest = new URL(req.url).searchParams.has("latest");
      const rows = latest
        ? await sql`
            SELECT id, raw_text as "rawText", created_at as "createdAt"
            FROM raw_matches_list
            ORDER BY created_at DESC, id DESC
            LIMIT 1;
          `
        : await sql`
            SELECT id, raw_text as "rawText", created_at as "createdAt"
            FROM raw_matches_list
            ORDER BY created_at DESC, id DESC;
          `;
      return Response.json(latest ? rows[0] ?? null : rows);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (typeof body?.raw_text !== "string" || !body.raw_text.trim()) {
        return Response.json({ error: "raw_text must be a non-empty string" }, { status: 400 });
      }

      const rows = await sql`
        INSERT INTO raw_matches_list (raw_text, created_at)
        VALUES (${body.raw_text}, now())
        RETURNING id, raw_text as "rawText", created_at as "createdAt";
      `;
      return Response.json(rows[0], { status: 201 });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err: any) {
    console.error("Netlify function error in raw-matches:", err);
    return Response.json(
      { error: `Database SQL error: ${err?.message || String(err)}` },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: "/api/raw-matches",
};
