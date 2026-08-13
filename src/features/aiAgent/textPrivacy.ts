/**
 * Provider-neutral, local-only text privacy for AI Agent tasks.
 *
 * The important boundary is a RECEIPT, not a one-shot regex replacement. A
 * task keeps one receipt through retries and restarts, so the same private
 * value always has the same opaque token and model context remains coherent.
 * Raw values remain in Alcove's local task checkpoint; provider requests see
 * only the transformed projection.
 *
 * This is intentionally text protection. It cannot erase letters that are
 * already baked into an image or a scanned PDF page.
 *
 * Design references:
 * - NIST SP 800-188 warns that masking direct identifiers alone is not proof
 *   of de-identification: https://doi.org/10.6028/NIST.SP.800-188
 * - Presidio's recognizer model combines patterns, context and validation;
 *   this local/offline implementation follows that layered shape without a
 *   network NER service: https://microsoft.github.io/presidio/analyzer/
 */
import type { PageDoc } from '../../data/types';
import type {
  AgentJsonValue,
  AgentTaskBrief,
} from './types';
import type {
  AgentProviderTurnRequest,
  ProviderContentPart,
  ProviderMessage,
} from './provider';

export const AGENT_TEXT_PRIVACY_RECEIPT_VERSION = 1 as const;

export type AgentPrivateTextKind =
  | 'email'
  | 'phone'
  | 'street_address'
  | 'ip_address'
  | 'network_address'
  | 'long_identifier'
  | 'date'
  | 'labelled_name'
  | 'username'
  | 'postal_code'
  | 'precise_location'
  | 'payment_card'
  | 'financial_account'
  | 'government_id'
  | 'credential_secret'
  | 'user_path';

export interface AgentPrivateTextEntry {
  readonly placeholder: string;
  readonly value: string;
  readonly kind: AgentPrivateTextKind;
  readonly createdAt: string;
}

export interface AgentTextPrivacyReceipt {
  readonly version: typeof AGENT_TEXT_PRIVACY_RECEIPT_VERSION;
  readonly enabled: true;
  /** Random/task-derived opaque namespace; carries no category information. */
  readonly namespace: string;
  readonly entries: readonly AgentPrivateTextEntry[];
  readonly textOnly: true;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentTextTransformResult<T> {
  readonly value: T;
  readonly receipt: AgentTextPrivacyReceipt;
}

interface Candidate {
  readonly start: number;
  readonly end: number;
  readonly value: string;
  readonly kind: AgentPrivateTextKind;
  readonly priority: number;
}

const PLACEHOLDER_OPEN = '⟦';
const PLACEHOLDER_CLOSE = '⟧';

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/giu;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;
const IPV6 = /(?<![0-9a-f:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![0-9a-f:])/giu;
const ISO_DATE = /\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b/gu;
const NUMERIC_DATE = /\b(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:19|20)\d{2}\b/gu;
const MONTH_DATE = /\b(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?(?:,\s*|\s+)(?:19|20)\d{2}|(?:0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:19|20)\d{2})\b/giu;
const STREET_ADDRESS = /\b\d{1,6}[A-Za-z]?[ \t]+(?:[\p{L}0-9.'’\-]+[ \t]+){1,7}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Parkway|Pkwy|Terrace|Place|Square|Highway|Hwy)\b(?:[ \t]*,[ \t]*(?:Apt|Apartment|Unit|Suite|#)[ \t]*[A-Za-z0-9-]+)?/giu;
const ADDRESS_LABEL = /\b(?:home[ _-]?address|mailing[ _-]?address|postal[ _-]?address|residence|address)[ \t]*[:=][ \t]*["']?([^\r\n]{4,160})/giu;
const PHONE = /(?:\+?\d{1,3}[ \t.-]?)?(?:\(?\d{2,4}\)?[ \t.-]?){1,3}\d{3,4}(?:[ \t]*(?:x|ext\.?|extension)[ \t]*\d{1,6})?/giu;
const LONG_MIXED_IDENTIFIER = /\b(?=[A-Za-z0-9_-]{12,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{12,}\b/gu;
const LONG_NUMERIC_IDENTIFIER = /\b\d{12,24}\b/gu;
const LABELLED_NAME = /\b(?:full[ \t]+name|name|client|student|patient|employee|customer|contact|recipient)[ \t]*(?:name)?[ \t]*[:=\-][ \t]*["']?([\p{Lu}][\p{L}'’\-]+(?:[ \t]+[\p{Lu}][\p{L}'’\-]+){0,4})/giu;
const CONTEXTUAL_NAME = /\b(?:dear|attention|attn\.?|signed[ \t]+by|prepared[ \t]+for|care[ \t]+of|c\/o)[ \t:,-]+(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Mx\.?)?[ \t]*([\p{Lu}][\p{L}'’\-]+(?:[ \t]+[\p{Lu}][\p{L}'’\-]+){0,4})/gu;
const MAC_ADDRESS = /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/giu;
const PAYMENT_CARD = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/gu;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ \t]?[A-Z0-9]){11,30}\b/giu;
const SSN = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/gu;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const BEARER_TOKEN = /\bBearer[ \t]+([A-Za-z0-9._~+/=-]{8,})/giu;
const PROVIDER_TOKEN = /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/gu;
const PEM_PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{16,}?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu;
const USER_HOME_PATH = /(?:\b[A-Z]:\\Users\\|\/(?:Users|home)\/)([^\\/\s]+)(?=[\\/])/giu;

const SECRET_LABEL = /\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|auth(?:orization)?[ _-]?token|client[ _-]?secret|private[ _-]?key|password|passwd|secret|bearer)[ \t]*[:=][ \t]*["']?([^\s"'`,;]{6,})/giu;
const SECRET_PHRASE_LABEL = /\b(?:password|passwd|passphrase|secret)[ \t]*[:=][ \t]*(?:"([^"\r\n]{4,256})"|'([^'\r\n]{4,256})'|([^\r\n,;]{6,256}))/giu;
const SENSITIVE_QUERY = /(?:[?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth|authorization|password|passwd|secret)=)([^&#\s]+)/giu;
const USERNAME_LABEL = /\b(?:user[ _-]?name|login|handle|screen[ _-]?name)[ \t]*[:=][ \t]*["']?(@?[\p{L}0-9._-]{2,64})/giu;
const POSTAL_LABEL = /\b(?:postal[ _-]?code|post[ _-]?code|zip(?:[ _-]?code)?)[ \t]*[:=][ \t]*["']?([A-Z0-9][A-Z0-9 -]{2,11})/giu;
const PRECISE_LOCATION_LABEL = /\b(?:gps|coordinates?|lat(?:itude)?[ \t]*[,&/][ \t]*lon(?:gitude)?)[ \t]*[:=]?[ \t]*(-?(?:[0-8]?\d(?:\.\d{3,})?|90(?:\.0+)?)[ \t]*[,;/][ \t]*-?(?:(?:1[0-7]\d|[0-9]?\d)(?:\.\d{3,})?|180(?:\.0+)?))/giu;
const GOVERNMENT_ID_LABEL = /\b(?:social[ _-]?security(?:[ _-]?number)?|ssn|tax[ _-]?(?:id|number)|national[ _-]?(?:id|number)|passport(?:[ _-]?(?:id|number))?|driver(?:'s)?[ _-]?licen[cs]e(?:[ _-]?(?:id|number))?|aadhaar|pan)[ \t]*[:=#-][ \t]*["']?([A-Z0-9][A-Z0-9 -]{4,31})/giu;
const ACCOUNT_ID_LABEL = /\b(?:bank[ _-]?account|account[ _-]?(?:id|number|no\.?|#)|routing[ _-]?(?:number|no\.?|#)|sort[ _-]?code|medical[ _-]?(?:record|id)|patient[ _-]?id|policy[ _-]?(?:id|number))[ \t]*[:=#-][ \t]*["']?([A-Z0-9][A-Z0-9 ./-]{4,39})/giu;

function opaqueNamespace(value: string): string {
  const folded = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (folded.slice(-10) || 'LOCALTEXT').padEnd(10, 'X');
}

export function createAgentTextPrivacyReceipt(input: {
  readonly namespace: string;
  readonly now: string;
}): AgentTextPrivacyReceipt {
  return {
    version: AGENT_TEXT_PRIVACY_RECEIPT_VERSION,
    enabled: true,
    namespace: opaqueNamespace(input.namespace),
    entries: [],
    textOnly: true,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function isAgentTextPrivacyReceipt(
  value: unknown,
): value is AgentTextPrivacyReceipt {
  if (value === null || typeof value !== 'object') return false;
  const receipt = value as Partial<AgentTextPrivacyReceipt>;
  return receipt.version === AGENT_TEXT_PRIVACY_RECEIPT_VERSION &&
    receipt.enabled === true &&
    receipt.textOnly === true &&
    typeof receipt.namespace === 'string' &&
    /^[A-Z0-9]{10}$/u.test(receipt.namespace) &&
    typeof receipt.createdAt === 'string' &&
    typeof receipt.updatedAt === 'string' &&
    Array.isArray(receipt.entries) &&
    receipt.entries.every((entry, index) => {
      if (
        entry === null ||
        typeof entry !== 'object' ||
        typeof entry.placeholder !== 'string' ||
        typeof entry.value !== 'string' ||
        entry.value === '' ||
        typeof entry.kind !== 'string' ||
        !PRIVATE_TEXT_KINDS.has(entry.kind as AgentPrivateTextKind) ||
        typeof entry.createdAt !== 'string'
      ) return false;
      const expected = `${PLACEHOLDER_OPEN}ALCOVE_PRIVATE_${entry.kind.toUpperCase()}_${receipt.namespace}_${String(index + 1).padStart(4, '0')}${PLACEHOLDER_CLOSE}`;
      return entry.placeholder === expected;
    }) &&
    new Set(receipt.entries.map((entry) => entry.placeholder)).size === receipt.entries.length &&
    new Set(receipt.entries.map((entry) => entry.value)).size === receipt.entries.length;
}

export function assertAgentTextPrivacyReceipt(
  receipt: AgentTextPrivacyReceipt | undefined,
): void {
  if (receipt !== undefined && !isAgentTextPrivacyReceipt(receipt)) {
    throw new Error(
      'the local private-text receipt is invalid; Alcove blocked restoration and provider transport',
    );
  }
}

const PRIVATE_TEXT_KINDS: ReadonlySet<AgentPrivateTextKind> = new Set([
  'email', 'phone', 'street_address', 'ip_address', 'network_address',
  'long_identifier', 'date', 'labelled_name', 'username', 'postal_code',
  'precise_location', 'payment_card', 'financial_account', 'government_id',
  'credential_secret', 'user_path',
]);

function collectMatches(
  source: string,
  pattern: RegExp,
  kind: AgentPrivateTextKind,
  priority: number,
  accept: (value: string) => boolean = () => true,
): Candidate[] {
  pattern.lastIndex = 0;
  const out: Candidate[] = [];
  for (const match of source.matchAll(pattern)) {
    const value = match[0];
    const start = match.index;
    if (value === undefined || start === undefined || !accept(value)) continue;
    out.push({ start, end: start + value.length, value, kind, priority });
  }
  return out;
}

function validIpv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const numeric = Number(part);
    return numeric >= 0 && numeric <= 255;
  });
}

function validIpv6(value: string): boolean {
  // Bare `::` is ambiguous with Notebook Script leaf directives (`::page`,
  // `::let`, …) and carries no useful privacy signal on its own.
  if (value === '::') return false;
  if (!value.includes(':') || !/^[0-9a-f:]+$/iu.test(value)) return false;
  if ((value.match(/::/gu) ?? []).length > 1) return false;
  const compressed = value.includes('::');
  const parts = compressed
    ? value.split('::').flatMap((side) => side === '' ? [] : side.split(':'))
    : value.split(':');
  if (parts.some((part) => part === '' || !/^[0-9a-f]{1,4}$/iu.test(part))) return false;
  return compressed ? parts.length < 8 : parts.length === 8;
}

function validPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  // Long uninterrupted numbers are handled as identifiers. Requiring phone
  // punctuation/context here avoids masking ordinary quantities and years.
  return /[+()\s.-]/.test(value) && !/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(value);
}

function labelledNames(source: string): Candidate[] {
  LABELLED_NAME.lastIndex = 0;
  const out: Candidate[] = [];
  for (const match of source.matchAll(LABELLED_NAME)) {
    const full = match[0];
    const value = match[1];
    const fullStart = match.index;
    if (full === undefined || value === undefined || fullStart === undefined) continue;
    const lineStart = source.lastIndexOf('\n', fullStart - 1) + 1;
    if (source.slice(lineStart, fullStart).trimStart().startsWith('::')) continue;
    const relative = full.lastIndexOf(value);
    const start = fullStart + relative;
    out.push({
      start,
      end: start + value.length,
      value,
      kind: 'labelled_name',
      priority: 110,
    });
  }
  return out;
}

function capturedMatches(
  source: string,
  pattern: RegExp,
  kind: AgentPrivateTextKind,
  priority: number,
  accept: (value: string) => boolean = () => true,
): Candidate[] {
  pattern.lastIndex = 0;
  const out: Candidate[] = [];
  for (const match of source.matchAll(pattern)) {
    const full = match[0];
    const value = match[1];
    const fullStart = match.index;
    if (full === undefined || value === undefined || fullStart === undefined || !accept(value)) {
      continue;
    }
    const relative = full.lastIndexOf(value);
    if (relative < 0) continue;
    out.push({
      start: fullStart + relative,
      end: fullStart + relative + value.length,
      value,
      kind,
      priority,
    });
  }
  return out;
}

function capturedAlternativeMatches(
  source: string,
  pattern: RegExp,
  kind: AgentPrivateTextKind,
  priority: number,
): Candidate[] {
  pattern.lastIndex = 0;
  const out: Candidate[] = [];
  for (const match of source.matchAll(pattern)) {
    const full = match[0];
    const rawValue = match.slice(1).find((candidate) => candidate !== undefined);
    const value = rawValue?.trim();
    const fullStart = match.index;
    if (full === undefined || value === undefined || value === '' || fullStart === undefined) continue;
    const relative = full.lastIndexOf(value);
    if (relative < 0) continue;
    out.push({
      start: fullStart + relative,
      end: fullStart + relative + value.length,
      value,
      kind,
      priority,
    });
  }
  return out;
}

function validPaymentCard(value: string): boolean {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/u.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function validIban(value: string): boolean {
  const compact = value.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const expanded = /[A-Z]/u.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function contextualNames(source: string): Candidate[] {
  return capturedMatches(source, CONTEXTUAL_NAME, 'labelled_name', 109);
}

function placeholderRanges(source: string): readonly { start: number; end: number }[] {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(PLACEHOLDER_OPEN, cursor);
    if (start < 0) break;
    const close = source.indexOf(PLACEHOLDER_CLOSE, start + 1);
    if (close < 0) break;
    ranges.push({ start, end: close + PLACEHOLDER_CLOSE.length });
    cursor = close + PLACEHOLDER_CLOSE.length;
  }
  return ranges;
}

function overlaps(
  candidate: Pick<Candidate, 'start' | 'end'>,
  ranges: readonly { readonly start: number; readonly end: number }[],
): boolean {
  return ranges.some((range) => candidate.start < range.end && candidate.end > range.start);
}

export function detectPrivateText(source: string): readonly Candidate[] {
  const candidates: Candidate[] = [
    ...collectMatches(source, PEM_PRIVATE_KEY, 'credential_secret', 165),
    ...collectMatches(source, JWT, 'credential_secret', 160),
    ...capturedMatches(source, BEARER_TOKEN, 'credential_secret', 160),
    ...collectMatches(source, PROVIDER_TOKEN, 'credential_secret', 160),
    ...capturedAlternativeMatches(source, SECRET_PHRASE_LABEL, 'credential_secret', 159),
    ...capturedMatches(source, SECRET_LABEL, 'credential_secret', 158),
    ...capturedMatches(source, SENSITIVE_QUERY, 'credential_secret', 157),
    ...collectMatches(source, PAYMENT_CARD, 'payment_card', 154, validPaymentCard),
    ...collectMatches(source, IBAN, 'financial_account', 152, validIban),
    ...collectMatches(source, SSN, 'government_id', 150),
    ...capturedMatches(source, GOVERNMENT_ID_LABEL, 'government_id', 148),
    ...capturedMatches(source, ACCOUNT_ID_LABEL, 'financial_account', 146),
    ...collectMatches(source, EMAIL, 'email', 120),
    ...collectMatches(source, UUID, 'long_identifier', 118),
    ...collectMatches(source, IPV4, 'ip_address', 116, validIpv4),
    ...collectMatches(source, IPV6, 'ip_address', 116, validIpv6),
    ...collectMatches(source, MAC_ADDRESS, 'network_address', 115),
    ...collectMatches(source, STREET_ADDRESS, 'street_address', 114),
    ...capturedMatches(source, ADDRESS_LABEL, 'street_address', 113),
    ...labelledNames(source),
    ...contextualNames(source),
    ...capturedMatches(source, PRECISE_LOCATION_LABEL, 'precise_location', 108),
    ...capturedMatches(source, USERNAME_LABEL, 'username', 107),
    ...capturedMatches(source, POSTAL_LABEL, 'postal_code', 106),
    ...capturedMatches(source, USER_HOME_PATH, 'user_path', 106),
    ...collectMatches(source, MONTH_DATE, 'date', 105),
    ...collectMatches(source, ISO_DATE, 'date', 104),
    ...collectMatches(source, NUMERIC_DATE, 'date', 103),
    ...collectMatches(source, PHONE, 'phone', 90, validPhone),
    ...collectMatches(source, LONG_MIXED_IDENTIFIER, 'long_identifier', 80),
    ...collectMatches(source, LONG_NUMERIC_IDENTIFIER, 'long_identifier', 75),
  ];
  const protectedRanges = placeholderRanges(source);
  const accepted: Candidate[] = [];
  for (const candidate of candidates
    .filter((item) => item.value.trim() !== '' && !overlaps(item, protectedRanges))
    .sort((left, right) =>
      left.start - right.start ||
      right.priority - left.priority ||
      (right.end - right.start) - (left.end - left.start),
    )) {
    if (overlaps(candidate, accepted)) continue;
    accepted.push(candidate);
  }
  return accepted.sort((left, right) => left.start - right.start);
}

function nextPlaceholder(
  receipt: AgentTextPrivacyReceipt,
  offset: number,
  kind: AgentPrivateTextKind,
): string {
  const type = kind.toUpperCase();
  return `${PLACEHOLDER_OPEN}ALCOVE_PRIVATE_${type}_${receipt.namespace}_${String(offset + 1).padStart(4, '0')}${PLACEHOLDER_CLOSE}`;
}

function replaceLiteral(source: string, value: string, replacement: string): string {
  if (value === '' || !source.includes(value)) return source;
  return source.split(value).join(replacement);
}

/** Mask one text value and extend the immutable task receipt as needed. */
export function obfuscatePrivateText(
  source: string,
  receipt: AgentTextPrivacyReceipt,
  now = receipt.updatedAt,
): AgentTextTransformResult<string> {
  let value = source;
  const entries = receipt.entries.map((entry) => ({ ...entry }));
  // Reuse existing mappings first, longest value first so overlapping values
  // can never turn a previous placeholder into a new semantic fragment.
  for (const entry of [...entries].sort((a, b) => b.value.length - a.value.length)) {
    value = replaceLiteral(value, entry.value, entry.placeholder);
  }
  const candidates = detectPrivateText(value);
  let cursor = 0;
  let transformed = '';
  let added = false;
  for (const candidate of candidates) {
    transformed += value.slice(cursor, candidate.start);
    const existing = entries.find((entry) => entry.value === candidate.value);
    const entry = existing ?? {
      placeholder: nextPlaceholder(receipt, entries.length, candidate.kind),
      value: candidate.value,
      kind: candidate.kind,
      createdAt: now,
    };
    if (existing === undefined) {
      entries.push(entry);
      added = true;
    }
    transformed += entry.placeholder;
    cursor = candidate.end;
  }
  transformed += value.slice(cursor);
  return {
    value: transformed,
    receipt: added
      ? { ...receipt, entries, updatedAt: now }
      : receipt,
  };
}

/** Restore only exact receipt-owned placeholders; unknown lookalikes remain. */
export function restorePrivateText(
  source: string,
  receipt: AgentTextPrivacyReceipt | undefined,
): string {
  if (receipt === undefined) return source;
  let value = source;
  for (const entry of [...receipt.entries].sort(
    (a, b) => b.placeholder.length - a.placeholder.length,
  )) {
    value = replaceLiteral(value, entry.placeholder, entry.value);
  }
  return value;
}

/**
 * A model must preserve this task's opaque tokens exactly. If it edits one,
 * local restoration cannot know which private value was intended; showing or
 * applying that token would silently corrupt the reader's text.
 */
export function hasUnresolvedPrivatePlaceholder(
  source: string,
  receipt: AgentTextPrivacyReceipt | undefined,
): boolean {
  if (receipt === undefined) return false;
  const ownedShape = new RegExp(
    `${PLACEHOLDER_OPEN}ALCOVE_PRIVATE_[A-Z_]+_${receipt.namespace}_[0-9]{4}${PLACEHOLDER_CLOSE}`,
    'gu',
  );
  const known = new Set(receipt.entries.map((entry) => entry.placeholder));
  if ([...source.matchAll(ownedShape)].some((match) => !known.has(match[0] ?? ''))) return true;
  // Catch a same-task token whose brackets, category or ordinal were edited.
  // Foreign namespaces stay literal by design; this receipt has no authority
  // to interpret another task's token.
  const ownedFragment = new RegExp(
    `ALCOVE_PRIVATE_[^\\s${PLACEHOLDER_CLOSE}]{0,96}_${receipt.namespace}_[^\\s${PLACEHOLDER_CLOSE}]{0,32}`,
    'gu',
  );
  return [...source.matchAll(ownedFragment)].some((match) =>
    !known.has(match[0] ?? '') &&
    ![...known].some((placeholder) => placeholder.includes(match[0] ?? '')),
  );
}

export function assertPrivatePlaceholdersRestorable(
  source: string,
  receipt: AgentTextPrivacyReceipt | undefined,
): void {
  if (hasUnresolvedPrivatePlaceholder(source, receipt)) {
    throw new Error(
      'a private-text placeholder was changed; preserve Alcove placeholders verbatim and try again',
    );
  }
}

/**
 * Structural/capability fields must remain byte-stable. Match camel-case
 * identity suffixes case-sensitively: a case-insensitive `.*Ids?` also matches
 * ordinary prose keys such as `avoid`, `grid` and `valid`.
 */
const PROTECTED_JSON_KEY = /^(?:id|ids|[A-Za-z][A-Za-z0-9]*(?:Id|Ids|Hash|Hashes|Digest|Digests|Revision|Revisions)|anchor|locator|figure|kind|type|role|status|code|effect|request|ordinal|pageNumber|start|end|from|to|position|width|height|mediaType|mimeType|url|src|asset|assetRelPath|createdAt|updatedAt|checkedAt|capturedAt|exposedAt)$/;
const PRIVATE_NAME_JSON_KEY = /^(?:fullName|personName|clientName|studentName|patientName|employeeName|customerName|contactName|recipientName|client|student|patient|employee|customer|recipient)$/i;
const PRIVATE_SINGLE_NAME_JSON_KEY = /^(?:firstName|givenName|middleName|lastName|familyName|surname)$/i;
const PRIVATE_SCALAR_JSON_KEY = /^(?:email|emailAddress|phone|phoneNumber|mobile|mobileNumber|street|streetAddress|address|addressLine[1-9]?|city|town|county|state|province|postalCode|postcode|zip|zipCode|username|userName|login|handle|dateOfBirth|birthDate|dob|ssn|socialSecurityNumber|nationalId|taxId|passport|passportNumber|driverLicense|driverLicence|accountNumber|bankAccount|iban|routingNumber|sortCode|medicalRecord|patientId|policyNumber|apiKey|accessToken|refreshToken|authToken|authorization|clientSecret|password|passwd|secret)$/i;
const SENSITIVE_URL_JSON_KEY = /^(?:url|src|href|uri)$/i;

function obfuscateForcedScalar(
  source: string,
  receipt: AgentTextPrivacyReceipt,
  now: string,
  kind: AgentPrivateTextKind,
): AgentTextTransformResult<string> {
  const trimmed = source.trim();
  if (trimmed === '' || trimmed.length > 4096) return obfuscatePrivateText(source, receipt, now);
  const existing = receipt.entries.find((entry) => entry.value === trimmed);
  const entry = existing ?? {
    placeholder: nextPlaceholder(receipt, receipt.entries.length, kind),
    value: trimmed,
    kind,
    createdAt: now,
  };
  return {
    value: source.replace(trimmed, entry.placeholder),
    receipt: existing === undefined
      ? { ...receipt, entries: [...receipt.entries, entry], updatedAt: now }
      : receipt,
  };
}

function obfuscateForcedName(
  source: string,
  receipt: AgentTextPrivacyReceipt,
  now: string,
): AgentTextTransformResult<string> {
  const trimmed = source.trim();
  if (!/^[\p{L}'’\-]+(?:\s+[\p{L}'’\-]+){1,4}$/u.test(trimmed)) {
    return obfuscatePrivateText(source, receipt, now);
  }
  const existing = receipt.entries.find((entry) => entry.value === trimmed);
  const entry = existing ?? {
    placeholder: nextPlaceholder(receipt, receipt.entries.length, 'labelled_name'),
    value: trimmed,
    kind: 'labelled_name' as const,
    createdAt: now,
  };
  return {
    value: source.replace(trimmed, entry.placeholder),
    receipt: existing === undefined
      ? { ...receipt, entries: [...receipt.entries, entry], updatedAt: now }
      : receipt,
  };
}

function transformJson(
  input: AgentJsonValue,
  receipt: AgentTextPrivacyReceipt,
  now: string,
): AgentTextTransformResult<AgentJsonValue> {
  if (typeof input === 'string') {
    const transformed = obfuscatePrivateText(input, receipt, now);
    return { value: transformed.value, receipt: transformed.receipt };
  }
  if (input === null || typeof input !== 'object') return { value: input, receipt };
  if (Array.isArray(input)) {
    let current = receipt;
    const value: AgentJsonValue[] = [];
    for (const item of input) {
      const transformed = transformJson(item, current, now);
      current = transformed.receipt;
      value.push(transformed.value);
    }
    return { value, receipt: current };
  }
  let current = receipt;
  const value: Record<string, AgentJsonValue> = {};
  for (const [key, child] of Object.entries(input)) {
    if (PRIVATE_SCALAR_JSON_KEY.test(key) && typeof child === 'string') {
      const transformed = obfuscateForcedScalar(
        child,
        current,
        now,
        /(?:token|key|secret|password|passwd|authorization)/iu.test(key)
          ? 'credential_secret'
          : /(?:account|iban|routing|sort|record|policy)/iu.test(key)
            ? 'financial_account'
            : /(?:ssn|national|tax|passport|license|licence)/iu.test(key)
              ? 'government_id'
              : /(?:user|login|handle)/iu.test(key)
                ? 'username'
                : /(?:zip|postal|postcode)/iu.test(key)
                  ? 'postal_code'
                  : 'long_identifier',
      );
      current = transformed.receipt;
      value[key] = transformed.value;
      continue;
    }
    if (PRIVATE_SINGLE_NAME_JSON_KEY.test(key) && typeof child === 'string') {
      const transformed = obfuscateForcedScalar(child, current, now, 'labelled_name');
      current = transformed.receipt;
      value[key] = transformed.value;
      continue;
    }
    // Capability URLs remain structurally usable unless they carry a known
    // credential-shaped query value. Only that value is replaced.
    if (SENSITIVE_URL_JSON_KEY.test(key) && typeof child === 'string') {
      const transformed = obfuscatePrivateText(child, current, now);
      current = transformed.receipt;
      value[key] = transformed.value;
      continue;
    }
    if (PROTECTED_JSON_KEY.test(key)) {
      value[key] = child;
      continue;
    }
    if (PRIVATE_NAME_JSON_KEY.test(key) && typeof child === 'string') {
      const transformed = obfuscateForcedName(child, current, now);
      current = transformed.receipt;
      value[key] = transformed.value;
      continue;
    }
    const transformed = transformJson(child, current, now);
    current = transformed.receipt;
    value[key] = transformed.value;
  }
  return { value, receipt: current };
}

export function obfuscatePrivateJson(
  input: AgentJsonValue,
  receipt: AgentTextPrivacyReceipt,
  now = receipt.updatedAt,
): AgentTextTransformResult<AgentJsonValue> {
  return transformJson(input, receipt, now);
}

export function restorePrivateJson(
  input: AgentJsonValue,
  receipt: AgentTextPrivacyReceipt | undefined,
): AgentJsonValue {
  if (receipt === undefined || input === null || typeof input !== 'object') {
    return typeof input === 'string' ? restorePrivateText(input, receipt) : input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => restorePrivateJson(item, receipt));
  }
  const value: Record<string, AgentJsonValue> = {};
  for (const [key, child] of Object.entries(input)) {
    value[key] = PROTECTED_JSON_KEY.test(key) && !SENSITIVE_URL_JSON_KEY.test(key)
      ? child
      : restorePrivateJson(child, receipt);
  }
  return value;
}

function transformPart(
  part: ProviderContentPart,
  receipt: AgentTextPrivacyReceipt,
  now: string,
): AgentTextTransformResult<ProviderContentPart> {
  if (part.type === 'image_ref') return { value: part, receipt };
  const transformed = obfuscatePrivateText(part.text, receipt, now);
  return {
    value: part.type === 'source_excerpt'
      ? { ...part, text: transformed.value }
      : { type: 'text', text: transformed.value },
    receipt: transformed.receipt,
  };
}

function transformToolText(
  text: string,
  receipt: AgentTextPrivacyReceipt,
  now: string,
): AgentTextTransformResult<string> {
  try {
    const parsed = JSON.parse(text) as AgentJsonValue;
    const transformed = obfuscatePrivateJson(parsed, receipt, now);
    return { value: JSON.stringify(transformed.value), receipt: transformed.receipt };
  } catch {
    // A tool result should always be JSON. Fail private when an older/custom
    // adapter emitted text: masking the readable body is safer than replaying
    // it raw, even though it cannot carry trusted structured anchors.
    return obfuscatePrivateText(text, receipt, now);
  }
}

export function obfuscateProviderMessages(
  messages: readonly ProviderMessage[],
  receipt: AgentTextPrivacyReceipt,
  now = receipt.updatedAt,
): AgentTextTransformResult<readonly ProviderMessage[]> {
  let current = receipt;
  const value: ProviderMessage[] = [];
  for (const message of messages) {
    const content: ProviderContentPart[] = [];
    for (const part of message.content) {
      const transformed = message.role === 'tool' && part.type === 'text'
        ? (() => {
            const result = transformToolText(part.text, current, now);
            return {
              value: { type: 'text' as const, text: result.value },
              receipt: result.receipt,
            };
          })()
        : transformPart(part, current, now);
      current = transformed.receipt;
      content.push(transformed.value);
    }
    let toolPlan = message.toolPlan;
    if (toolPlan !== undefined) {
      const transformed = obfuscatePrivateText(toolPlan, current, now);
      current = transformed.receipt;
      toolPlan = transformed.value;
    }
    const toolCalls = message.toolCalls?.map((call) => {
      const transformed = obfuscatePrivateJson(call.arguments, current, now);
      current = transformed.receipt;
      return { ...call, arguments: transformed.value };
    });
    value.push({
      ...message,
      content,
      ...(toolPlan === undefined ? {} : { toolPlan }),
      ...(toolCalls === undefined ? {} : { toolCalls }),
    });
  }
  return { value, receipt: current };
}

export function obfuscateTaskBrief(
  task: AgentTaskBrief,
  receipt: AgentTextPrivacyReceipt,
  now = receipt.updatedAt,
): AgentTextTransformResult<AgentTaskBrief> {
  let current = receipt;
  const text = (source: string | undefined): string | undefined => {
    if (source === undefined) return undefined;
    const transformed = obfuscatePrivateText(source, current, now);
    current = transformed.receipt;
    return transformed.value;
  };
  return {
    value: {
      ...task,
      goal: text(task.goal)!,
      desiredOutcome: text(task.desiredOutcome),
      audience: text(task.audience),
      depth: text(task.depth),
      length: text(task.length),
      creativeDirection: text(task.creativeDirection),
      assumptions: task.assumptions.map((item) => text(item)!),
    },
    receipt: current,
  };
}

/**
 * Prepare a provider request without touching request/tool identity, schema,
 * source anchors, image references or capability metadata.
 */
export function obfuscateProviderRequest(
  request: AgentProviderTurnRequest,
  receipt: AgentTextPrivacyReceipt,
  now = receipt.updatedAt,
): AgentTextTransformResult<AgentProviderTurnRequest> {
  // The graph builds this prompt from an already-masked task brief and
  // deterministic state. Leaving it intact is what preserves serialized
  // page/source identities and hashes in the compact state contract.
  const messages = obfuscateProviderMessages(request.messages, receipt, now);
  return {
    value: { ...request, messages: messages.value },
    receipt: messages.receipt,
  };
}

/** Deeply transform rendered target-page text while preserving node identity. */
export function obfuscatePageDocument(
  document: PageDoc,
  receipt: AgentTextPrivacyReceipt,
  now = receipt.updatedAt,
): AgentTextTransformResult<PageDoc> {
  const transformed = obfuscatePrivateJson(
    document as unknown as AgentJsonValue,
    receipt,
    now,
  );
  return {
    value: transformed.value as unknown as PageDoc,
    receipt: transformed.receipt,
  };
}

export function textPrivacySystemInstruction(
  receipt: AgentTextPrivacyReceipt | undefined,
): string {
  if (receipt === undefined) return '';
  return [
    'PRIVACY PLACEHOLDERS ARE ACTIVE FOR THIS TASK.',
    `Typed opaque tokens shaped like ${PLACEHOLDER_OPEN}ALCOVE_PRIVATE_EMAIL_${receipt.namespace}_0001${PLACEHOLDER_CLOSE} replace private text locally before provider transport.`,
    'Treat each token as an exact meaningful value. Preserve it verbatim in answers, Notebook Script, captions, diagrams, tables, tool arguments and revisions; never expand, rename, guess, translate, split or reformat it.',
    'Alcove restores the values locally only after your masked draft-image review. Image/PDF pixels are not covered by this text-only transform.',
  ].join(' ');
}

/**
 * Chunk-safe local restorer for future live prose rendering. It delays at most
 * one placeholder length so a token split across provider deltas cannot flash
 * or leak as a half-restored value.
 */
export class AgentPrivateTextStreamRestorer {
  private buffer = '';
  private readonly maxPlaceholderLength: number;

  constructor(private readonly receipt: AgentTextPrivacyReceipt | undefined) {
    this.maxPlaceholderLength = Math.max(
      0,
      ...(receipt?.entries.map((entry) => entry.placeholder.length) ?? []),
    );
  }

  push(chunk: string): string {
    this.buffer += chunk;
    if (this.receipt === undefined || this.maxPlaceholderLength === 0) {
      const ready = this.buffer;
      this.buffer = '';
      return ready;
    }
    let ready = '';
    while (this.buffer !== '') {
      const open = this.buffer.indexOf(PLACEHOLDER_OPEN);
      if (open < 0) {
        ready += this.buffer;
        this.buffer = '';
        break;
      }
      ready += this.buffer.slice(0, open);
      this.buffer = this.buffer.slice(open);
      const close = this.buffer.indexOf(PLACEHOLDER_CLOSE, 1);
      if (close < 0) {
        // A malformed lookalike must not hold an unbounded provider stream.
        // Real receipt-owned tokens can never exceed this task-specific cap.
        if (this.buffer.length > this.maxPlaceholderLength) {
          ready += this.buffer.slice(0, 1);
          this.buffer = this.buffer.slice(1);
          continue;
        }
        break;
      }
      const token = this.buffer.slice(0, close + PLACEHOLDER_CLOSE.length);
      ready += restorePrivateText(token, this.receipt);
      this.buffer = this.buffer.slice(close + PLACEHOLDER_CLOSE.length);
    }
    return ready;
  }

  flush(): string {
    const ready = restorePrivateText(this.buffer, this.receipt);
    this.buffer = '';
    return ready;
  }
}
