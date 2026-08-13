import type { AiAttachmentMetadata } from '../../data/aiGateway';

export const AGENT_PASTED_TEXT_THRESHOLD_CHARACTERS = 500;
export const AGENT_PASTED_TEXT_NAME = 'Pasted text.txt';

const EXTENSION_MEDIA_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  rtf: 'text/rtf', tex: 'text/x-tex',
  csv: 'text/csv', tsv: 'text/tab-separated-values',
  html: 'text/html', htm: 'text/html', css: 'text/css',
  json: 'application/json', jsonl: 'application/x-ndjson', ndjson: 'application/x-ndjson',
  ipynb: 'application/x-ipynb+json',
  // SVG is source text here, never a browser-rendered image. Treating an
  // untrusted SVG as a preview would weaken the no-execution/no-network source
  // boundary even though the native extractor itself only reads UTF-8 bytes.
  xml: 'application/xml', svg: 'application/xml',
  yaml: 'application/yaml', yml: 'application/yaml', toml: 'application/toml',
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  jsx: 'text/jsx', ts: 'text/typescript', mts: 'text/typescript', cts: 'text/typescript', tsx: 'text/tsx',
  py: 'text/x-python', rb: 'text/x-ruby', php: 'text/x-php',
  java: 'text/x-java-source', kt: 'text/x-kotlin', kts: 'text/x-kotlin',
  c: 'text/x-c', h: 'text/x-c', cc: 'text/x-c++', cpp: 'text/x-c++', cxx: 'text/x-c++', hpp: 'text/x-c++',
  cs: 'text/x-csharp', go: 'text/x-go', rs: 'text/x-rust', swift: 'text/x-swift',
  sh: 'text/x-shellscript', bash: 'text/x-shellscript', zsh: 'text/x-shellscript', fish: 'text/x-shellscript',
  ps1: 'text/x-powershell', bat: 'text/x-bat', cmd: 'text/x-bat',
  sql: 'application/sql', r: 'text/x-r', scala: 'text/x-scala', lua: 'text/x-lua',
  graphql: 'application/graphql', gql: 'application/graphql', proto: 'text/x-protobuf',
  vue: 'text/x-vue', svelte: 'text/x-svelte', astro: 'text/x-astro',
  ini: 'text/plain', cfg: 'text/plain', conf: 'text/plain', log: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export const AGENT_SOURCE_FILE_ACCEPT = [
  ...new Set(Object.keys(EXTENSION_MEDIA_TYPES).map((extension) => `.${extension}`)),
].join(',');

function extensionOf(name: string): string {
  return name.trim().toLowerCase().split('.').pop() ?? '';
}

export function agentSourceMediaType(file: Pick<File, 'name' | 'type'>): string | null {
  const extension = extensionOf(file.name);
  const extensionType = EXTENSION_MEDIA_TYPES[extension];
  if (extensionType !== undefined) return extensionType;
  if (file.name.includes('.') && extension !== '') return null;
  const supplied = file.type.trim().toLowerCase().split(';', 1)[0] ?? '';
  return Object.values(EXTENSION_MEDIA_TYPES).includes(supplied) ? supplied : null;
}

export function agentSourceAttachmentMediaType(
  file: Pick<File, 'name' | 'type'>,
  stored: Pick<AiAttachmentMetadata, 'kind' | 'mimeType'>,
): string {
  return stored.kind === 'text'
    ? agentSourceMediaType(file) ?? 'text/plain'
    : stored.mimeType;
}

export interface AgentComposerPaste {
  readonly kind: 'message' | 'attachment';
  readonly text: string;
  readonly name?: typeof AGENT_PASTED_TEXT_NAME;
  readonly mediaType?: 'text/plain';
  readonly bytes?: Uint8Array;
}

/** Large clipboard bodies become locally managed evidence, not giant turns. */
export function classifyAgentComposerPaste(text: string): AgentComposerPaste {
  if (text.length < AGENT_PASTED_TEXT_THRESHOLD_CHARACTERS) {
    return { kind: 'message', text };
  }
  return {
    kind: 'attachment',
    text: '',
    name: AGENT_PASTED_TEXT_NAME,
    mediaType: 'text/plain',
    bytes: new TextEncoder().encode(text),
  };
}

/** Browser convenience kept outside the core classifier for deterministic tests. */
export function pastedTextFile(text: string): File {
  const classified = classifyAgentComposerPaste(text);
  if (classified.kind !== 'attachment' || classified.bytes === undefined) {
    throw new Error('Pasted text is below the managed-attachment threshold');
  }
  return new File([classified.bytes], AGENT_PASTED_TEXT_NAME, {
    type: 'text/plain',
    lastModified: Date.now(),
  });
}
