import type { Config } from "@netlify/functions";
import { sql } from "../../db/index.js";

// GET  /api/settings          -> all settings rows, newest first
// GET  /api/settings?latest=1 -> only the most recent row (or null)
// POST /api/settings          -> insert a new settings row
export default async (req: Request) => {
  try {
    if (req.method === "GET") {
      const latest = new URL(req.url).searchParams.has("latest");
      const rows = latest
        ? await sql`
            SELECT id, initial_bankroll as "initialBankroll", total_events_n as "totalEventsN", expected_events_k as "expectedEventsK", average_odds as "averageOdds", created_at as "createdAt"
            FROM masaniello_settings
            ORDER BY created_at DESC, id DESC
            LIMIT 1;
          `
        : await sql`
            SELECT id, initial_bankroll as "initialBankroll", total_events_n as "totalEventsN", expected_events_k as "expectedEventsK", average_odds as "averageOdds", created_at as "createdAt"
            FROM masaniello_settings
            ORDER BY created_at DESC, id DESC;
          `;
      return Response.json(latest ? rows[0] ?? null : rows);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      const initialBankroll = Number(body?.initial_bankroll);
      const totalEventsN = Number(body?.total_events_n);
      const expectedEventsK = Number(body?.expected_events_k);
      const averageOdds = Number(body?.average_odds);

      if (
        !(initialBankroll > 0) ||
        !Number.isInteger(totalEventsN) || totalEventsN < 1 ||
        !Number.isInteger(expectedEventsK) || expectedEventsK < 1 || expectedEventsK > totalEventsN ||
        !(averageOdds > 1)
      ) {
        return Response.json(
          { error: "Invalid settings: need initial_bankroll > 0, integers 1 <= expected_events_k <= total_events_n, average_odds > 1" },
          { status: 400 },
        );
      }

      const rows = await sql`
        INSERT INTO masaniello_settings (initial_bankroll, total_events_n, expected_events_k, average_odds, created_at)
        VALUES (${initialBankroll}, ${totalEventsN}, ${expectedEventsK}, ${averageOdds}, now())
        RETURNING id, initial_bankroll as "initialBankroll", total_events_n as "totalEventsN", expected_events_k as "expectedEventsK", average_odds as "averageOdds", created_at as "createdAt";
      `;
      return Response.json(rows[0], { status: 201 });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err: any) {
    console.error("Netlify function error in settings:", err);
    return Response.json(
      { error: `Database SQL error: ${err?.message || String(err)}` },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: "/api/settings",
};
