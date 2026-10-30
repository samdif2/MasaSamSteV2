import type { Config, Context } from "@netlify/functions";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { masanielloEvents } from "../../db/schema.js";

const STATUSES = ["Pending", "Won", "Lost"];

type EventInput = { match_name?: unknown; selection?: unknown; odds?: unknown; stake?: unknown; status?: unknown };

function parseEvent(input: EventInput) {
  const matchName = typeof input.match_name === "string" ? input.match_name.trim() : "";
  const selection = typeof input.selection === "string" ? input.selection.trim() : "";
  const odds = Number(input.odds);
  const stake = Number(input.stake);
  const status = input.status === undefined ? "Pending" : input.status;

  if (!matchName || !selection || !(odds > 1) || !(stake >= 0) || typeof status !== "string" || !STATUSES.includes(status)) {
    return null;
  }
  return { matchName, selection, odds, stake, status };
}

// GET    /api/events      -> all events, oldest first
// POST   /api/events      -> insert one event (object) or many (array)
// PATCH  /api/events/:id  -> update status / stake / odds of an event
// DELETE /api/events/:id  -> delete one event
export default async (req: Request, context: Context) => {
  try {
    const id = context.params.id ? Number(context.params.id) : undefined;

    if (req.method === "GET" && id === undefined) {
      const rows = await db.select().from(masanielloEvents).orderBy(asc(masanielloEvents.createdAt), asc(masanielloEvents.id));
      return Response.json(rows);
    }

    if (req.method === "POST" && id === undefined) {
      const body = await req.json().catch(() => null);
      const items: EventInput[] = Array.isArray(body) ? body : body ? [body] : [];
      const values = items.map(parseEvent);
      if (values.length === 0 || values.some((v) => v === null)) {
        return Response.json(
          { error: "Invalid event: need match_name, selection, odds > 1, stake >= 0, status in Pending|Won|Lost" },
          { status: 400 },
        );
      }
      const rows = await db.insert(masanielloEvents).values(values as NonNullable<ReturnType<typeof parseEvent>>[]).returning();
      return Response.json(Array.isArray(body) ? rows : rows[0], { status: 201 });
    }

    if (id !== undefined && !Number.isInteger(id)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }

    if (req.method === "PATCH" && id !== undefined) {
      const body = await req.json().catch(() => ({}));
      const updates: Partial<typeof masanielloEvents.$inferInsert> = {};
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return Response.json({ error: "Invalid status" }, { status: 400 });
        updates.status = body.status;
      }
      if (body.stake !== undefined) {
        if (!(Number(body.stake) >= 0)) return Response.json({ error: "Invalid stake" }, { status: 400 });
        updates.stake = Number(body.stake);
      }
      if (body.odds !== undefined) {
        if (!(Number(body.odds) > 1)) return Response.json({ error: "Invalid odds" }, { status: 400 });
        updates.odds = Number(body.odds);
      }
      if (Object.keys(updates).length === 0) return Response.json({ error: "Nothing to update" }, { status: 400 });

      const [row] = await db.update(masanielloEvents).set(updates).where(eq(masanielloEvents.id, id)).returning();
      return row ? Response.json(row) : Response.json({ error: "Not found" }, { status: 404 });
    }

    if (req.method === "DELETE" && id !== undefined) {
      const [row] = await db.delete(masanielloEvents).where(eq(masanielloEvents.id, id)).returning();
      return row ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err: any) {
    console.error("Netlify function error in events:", err);
    return Response.json(
      { error: `Database SQL error: ${err?.message || String(err)}` },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: ["/api/events", "/api/events/:id"],
};
