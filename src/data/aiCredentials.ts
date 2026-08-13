/** Narrow WebView contract for the Rust-owned Cohere credential lifecycle. */
import { isTauri } from './db';

export type AiCredentialPersistence = 'session' | 'secure';

export interface AiCredentialStatus {
  readonly configured: boolean;
  readonly source: 'session' | 'secureStore' | null;
  readonly secureStoreAvailable: boolean;
  readonly persistent: boolean;
}

export interface AiCredentialTestResult {
  readonly valid: boolean;
}

const UNCONFIGURED: AiCredentialStatus = {
  configured: false,
  source: null,
  secureStoreAvailable: false,
  persistent: false,
};

// Deliberately ephemeral browser-development credential. It is never written
// to localStorage, IndexedDB, SQLite, logs or the URL, and a reload destroys
// this module instance. Production desktop calls never read this value.
let browserDevKey: string | null = null;

export function browserDevAiCredential(): string | null {
  return import.meta.env.DEV && !isTauri() ? browserDevKey : null;
}

function browserDevCredentialMode(): boolean {
  return import.meta.env.DEV && !isTauri();
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import('@tauri-apps/api/core');
  return api.invoke<T>(command, args);
}

function normalizedKey(value: string): string {
  const key = value.trim();
  // Cohere keys are opaque strings. Keep this exactly aligned with the Rust
  // boundary: accepting a shorter value here only delays the same rejection
  // until after the reader has crossed the protected IPC seam.
  // The upper bound prevents an
  // accidental pasted document from crossing the IPC/logging boundary.
  if (
    key.length < 16 ||
    key.length > 512 ||
    /\s/.test(key) ||
    /[^\x21-\x7e]/.test(key)
  ) {
    throw new Error('enter a valid Cohere API key');
  }
  return key;
}

export async function aiCredentialStatus(): Promise<AiCredentialStatus> {
  if (!browserDevCredentialMode()) {
    return isTauri() ? invoke<AiCredentialStatus>('ai_credential_status') : UNCONFIGURED;
  }
  return browserDevKey === null
    ? UNCONFIGURED
    : {
        configured: true,
        source: 'session',
        secureStoreAvailable: false,
        persistent: false,
      };
}

export async function saveAiCredential(
  apiKey: string,
  persistence: AiCredentialPersistence,
): Promise<AiCredentialStatus> {
  if (browserDevCredentialMode()) {
    browserDevKey = normalizedKey(apiKey);
    return {
      configured: true,
      source: 'session',
      secureStoreAvailable: false,
      persistent: false,
    };
  }
  // Keep the key in this call frame only. Callers clear their input as soon as
  // this promise starts; Rust never returns the value.
  return invoke<AiCredentialStatus>('ai_credential_save', {
    request: { apiKey: normalizedKey(apiKey), persistence },
  });
}

export async function testAiCredential(
  apiKey?: string,
): Promise<AiCredentialTestResult> {
  if (browserDevCredentialMode()) {
    const key = normalizedKey(apiKey ?? browserDevKey ?? '');
    const response = await fetch('https://api.cohere.com/v1/check-api-key', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
        'X-Client-Name': 'Alcove localhost',
      },
    });
    if (!response.ok) {
      if ([401, 403, 498].includes(response.status)) return { valid: false };
      throw new Error(`Cohere key test failed with HTTP ${response.status}`);
    }
    const body = await response.json() as { valid?: unknown };
    if (typeof body.valid !== 'boolean') {
      throw new Error('Cohere returned an invalid key-check response');
    }
    return { valid: body.valid };
  }
  const request = apiKey === undefined ? {} : { apiKey: normalizedKey(apiKey) };
  return invoke<AiCredentialTestResult>('ai_credential_test', { request });
}

export async function deleteAiCredential(): Promise<AiCredentialStatus> {
  if (!browserDevCredentialMode()) {
    return isTauri() ? invoke<AiCredentialStatus>('ai_credential_delete') : UNCONFIGURED;
  }
  browserDevKey = null;
  return UNCONFIGURED;
}
