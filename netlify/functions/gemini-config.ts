import type { Config } from "@netlify/functions";

// Endpoint leggerissimo che restituisce la configurazione / chiave API al client in <10ms
// In questo modo la chiamata AI pesante viene eseguita direttamente dal browser,
// eliminando al 100% l'errore "Request failed: 504 (Gateway Timeout)" su Netlify Free.
export default async () => {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "").trim();
  return Response.json({ apiKey });
};

export const config: Config = {
  path: "/api/gemini-config",
};
