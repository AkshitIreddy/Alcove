import { describe, expect, it } from 'vitest';
import { readerIntentHint } from '../src/features/aiAgent/intent';
import { createInitialAgentState } from '../src/features/aiAgent/types';

const NOW = '2026-08-18T20:00:00.000Z';

function stateFor(goal: string) {
  return createInitialAgentState({
    identity: {
      taskId: 'task-question-intent',
      threadId: 'thread-question-intent',
      runId: 'run-question-intent',
      bookId: 'book-question-intent',
    },
    goal,
    now: NOW,
    userMessageId: 'reader-question-intent',
  });
}

describe('AI agent question-shaped follow-up intent', () => {
  it.each([
    'can you see images, tell me what you see in this picture',
    'does this look related to box packing',
    'would that explanation make sense to a beginner',
    'is the preview still waiting for me',
  ])('defaults an unpunctuated question to conversation: %s', (question) => {
    expect(readerIntentHint(stateFor(question))).toBe('conversation');
  });

  it('still gives an explicit notebook mutation precedence over question grammar', () => {
    expect(readerIntentHint(stateFor(
      'can you add this picture to my book',
    ))).toBe('notebook_change');
  });
});
