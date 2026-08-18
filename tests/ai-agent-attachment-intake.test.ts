import { describe, expect, it } from 'vitest';
import {
  AGENT_PASTED_TEXT_NAME,
  AGENT_PASTED_TEXT_THRESHOLD_CHARACTERS,
  AGENT_SOURCE_FILE_ACCEPT,
  agentSourceAttachmentMediaType,
  agentSourceMediaType,
  classifyAgentComposerPaste,
  filesFromAgentComposerDrop,
  hasAgentComposerFileDrop,
} from '../src/features/aiAgent/attachmentIntake';

describe('AI Agent managed source intake', () => {
  it('allows common inert source/document formats by extension without trusting a MIME header', () => {
    for (const [name, expected] of [
      ['notes.md', 'text/markdown'],
      ['table.csv', 'text/csv'],
      ['table.tsv', 'text/tab-separated-values'],
      ['page.html', 'text/html'],
      ['data.json', 'application/json'],
      ['config.xml', 'application/xml'],
      ['diagram.svg', 'application/xml'],
      ['component.tsx', 'text/tsx'],
      ['analysis.py', 'text/x-python'],
      ['query.sql', 'application/sql'],
      ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['workbook.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ] as const) {
      expect(agentSourceMediaType({ name, type: 'application/octet-stream' })).toBe(expected);
    }
    expect(agentSourceMediaType({ name: 'macro.xlsm', type: '' })).toBeNull();
    expect(agentSourceMediaType({ name: 'program.exe', type: 'text/plain' })).toBeNull();
    expect(AGENT_SOURCE_FILE_ACCEPT).toContain('.docx');
    expect(AGENT_SOURCE_FILE_ACCEPT).toContain('.xlsx');
    expect(AGENT_SOURCE_FILE_ACCEPT).toContain('.pptx');
    expect(AGENT_SOURCE_FILE_ACCEPT).not.toContain('.xlsm');
    expect(agentSourceMediaType({ name: 'diagram.svg', type: 'image/svg+xml' }))
      .not.toBe('image/svg+xml');
  });

  it('preserves the source-language MIME after the native store safely classifies UTF-8 bytes', () => {
    expect(agentSourceAttachmentMediaType(
      { name: 'app.ts', type: '' },
      { kind: 'text', mimeType: 'text/plain' },
    )).toBe('text/typescript');
    expect(agentSourceAttachmentMediaType(
      { name: 'photo.png', type: 'image/png' },
      { kind: 'png', mimeType: 'image/png' },
    )).toBe('image/png');
  });

  it('turns only large clipboard bodies into a named byte-safe managed attachment', () => {
    const small = 'short pasted note';
    expect(classifyAgentComposerPaste(small)).toEqual({ kind: 'message', text: small });

    const boundaryMinusOne = 'a'.repeat(AGENT_PASTED_TEXT_THRESHOLD_CHARACTERS - 1);
    expect(classifyAgentComposerPaste(boundaryMinusOne)).toEqual({
      kind: 'message',
      text: boundaryMinusOne,
    });

    const large = 'a'.repeat(AGENT_PASTED_TEXT_THRESHOLD_CHARACTERS);
    expect(large).toHaveLength(500);
    const classified = classifyAgentComposerPaste(large);
    expect(classified).toMatchObject({
      kind: 'attachment',
      text: '',
      name: AGENT_PASTED_TEXT_NAME,
      mediaType: 'text/plain',
    });
    expect(new TextDecoder().decode(classified.bytes)).toBe(large);
  });

  it('recognizes and extracts file drags without accepting text-only drags', () => {
    const image = { name: 'packing.png', type: 'image/png' } as File;
    const notes = { name: 'week-6.md', type: 'text/markdown' } as File;
    const files = { 0: image, 1: notes, length: 2 } as unknown as FileList;

    expect(hasAgentComposerFileDrop({ types: ['text/plain', 'Files'] })).toBe(true);
    expect(hasAgentComposerFileDrop({ types: ['text/plain'] })).toBe(false);
    expect(hasAgentComposerFileDrop(null)).toBe(false);
    expect(filesFromAgentComposerDrop({ files })).toEqual([image, notes]);
    expect(filesFromAgentComposerDrop(null)).toEqual([]);
  });
});
