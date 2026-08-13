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
  return isTauri()
    ? invoke<AiCredentialStatus>('ai_credential_status')
    : UNCONFIGURED;
}

export async function saveAiCredential(
  apiKey: string,
  persistence: AiCredentialPersistence,
): Promise<AiCredentialStatus> {
  if (!isTauri()) {
    throw new Error('provider keys are available in the desktop app');
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
  // A plain Vite page has no Rust-owned HTTPS gateway or protected credential
  // store. Returning `{ valid:false }` here used to make localhost claim that
  // Cohere rejected a key even though no request had left the browser at all.
  // Fail explicitly; never move provider credentials into browser fetches just
  // to make development mode resemble the desktop security boundary.
  if (!isTauri()) {
    throw new Error(
      'Cohere keys can only be tested in the Alcove desktop app, not the localhost browser preview',
    );
  }
  const request = apiKey === undefined ? {} : { apiKey: normalizedKey(apiKey) };
  return invoke<AiCredentialTestResult>('ai_credential_test', { request });
}

export async function deleteAiCredential(): Promise<AiCredentialStatus> {
  return isTauri()
    ? invoke<AiCredentialStatus>('ai_credential_delete')
    : UNCONFIGURED;
}
