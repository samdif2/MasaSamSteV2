import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL_STORAGE_KEY = 'supabase_url';
export const SUPABASE_KEY_STORAGE_KEY = 'supabase_key';

let cachedClient: SupabaseClient | null = null;
let lastUsedUrl = '';
let lastUsedKey = '';

export interface SupabaseCredentials {
  url: string;
  key: string;
}

/**
 * Legge dinamicamente le credenziali di Supabase dal localStorage del browser.
 */
export function getSupabaseConfig(): SupabaseCredentials {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { url: '', key: '' };
    }
    const url = (localStorage.getItem(SUPABASE_URL_STORAGE_KEY) || '').trim();
    const key = (localStorage.getItem(SUPABASE_KEY_STORAGE_KEY) || '').trim();
    return { url, key };
  } catch {
    return { url: '', key: '' };
  }
}

/**
 * Verifica se Supabase è configurato con URL e chiave validi nel localStorage.
 */
export function isSupabaseConfigured(): boolean {
  const { url, key } = getSupabaseConfig();
  return Boolean(url && key);
}

/**
 * Inizializza o reinizializza il client Supabase in base alle credenziali fornite o salvate.
 * Se mancano o sono non valide, non crasha ma restituisce null.
 */
export function initSupabaseClient(customUrl?: string, customKey?: string): SupabaseClient | null {
  const config = getSupabaseConfig();
  const url = customUrl !== undefined ? customUrl.trim() : config.url;
  const key = customKey !== undefined ? customKey.trim() : config.key;

  if (!url || !key) {
    cachedClient = null;
    lastUsedUrl = '';
    lastUsedKey = '';
    return null;
  }

  // Riutilizza l'istanza se i parametri non sono cambiati
  if (cachedClient && lastUsedUrl === url && lastUsedKey === key) {
    return cachedClient;
  }

  try {
    // Validazione base dell'URL per evitare errori fatali di parsing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      console.warn('[Supabase] URL non valido (manca https://):', url);
      cachedClient = null;
      return null;
    }

    cachedClient = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    lastUsedUrl = url;
    lastUsedKey = key;
    return cachedClient;
  } catch (err) {
    console.warn('[Supabase] Errore inizializzazione client:', err);
    cachedClient = null;
    lastUsedUrl = '';
    lastUsedKey = '';
    return null;
  }
}

/**
 * Salva la configurazione nel localStorage del browser e reinizializza il client.
 */
export function setSupabaseConfig(url: string, key: string): SupabaseClient | null {
  const cleanUrl = (url || '').trim();
  const cleanKey = (key || '').trim();

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (cleanUrl) {
        localStorage.setItem(SUPABASE_URL_STORAGE_KEY, cleanUrl);
      } else {
        localStorage.removeItem(SUPABASE_URL_STORAGE_KEY);
      }

      if (cleanKey) {
        localStorage.setItem(SUPABASE_KEY_STORAGE_KEY, cleanKey);
      } else {
        localStorage.removeItem(SUPABASE_KEY_STORAGE_KEY);
      }
    }
  } catch (err) {
    console.warn('[Supabase] Impossibile salvare in localStorage:', err);
  }

  return initSupabaseClient(cleanUrl, cleanKey);
}

/**
 * Rimuove le credenziali salvate nel localStorage e azzera il client.
 */
export function clearSupabaseConfig(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(SUPABASE_URL_STORAGE_KEY);
      localStorage.removeItem(SUPABASE_KEY_STORAGE_KEY);
    }
  } catch { /* ignore */ }
  cachedClient = null;
  lastUsedUrl = '';
  lastUsedKey = '';
}

/**
 * Restituisce il client Supabase attualmente inizializzato, o null se non configurato.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!cachedClient) {
    initSupabaseClient();
  }
  return cachedClient;
}

/**
 * Oggetto proxy per chiamate dirette tipo supabase.from(...).
 * Se il client non è configurato, logga un avviso e ritorna undefined senza far crashare l'app.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseClient();
    if (!client) {
      console.warn("[Supabase] Client non configurato. Configura Supabase tramite il pulsante ⚙️ nell'header.");
      return undefined;
    }
    const val = (client as any)[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  },
});

// Inizializzazione automatica al caricamento del modulo (sicura, restituisce null se non configurato)
if (typeof window !== 'undefined') {
  initSupabaseClient();
}

export default getSupabaseClient;

