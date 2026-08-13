import type { AgentState } from './types';

/**
 * Image slots are an explicit reader capability, never an aesthetic default.
 *
 * The model cannot grant itself this permission by deciding that a page would
 * look nicer with a picture. Only reader-authored conversation text is
 * inspected, and the latest unambiguous image directive wins. Native diagrams,
 * charts, stickers and decorative page furniture are deliberately absent from
 * this vocabulary because Alcove can render those without an external image.
 */
export interface ExplicitImageRequest {
  readonly requested: boolean;
  readonly messageId?: string;
  readonly evidence?: string;
}

const IMAGE_NOUN = String.raw`(?:images?|pictures?|photos?|photographs?|illustrations?|visuals?)`;
const SLOT_NOUN = String.raw`(?:(?:image|picture|photo|illustration)[ _-]?(?:slots?|holders?|placeholders?|cards?))`;
// Put the compound noun first so a negative phrase consumes “picture slots”
// as one directive instead of stopping early at “picture”.
const IMAGE_OR_SLOT = String.raw`(?:${SLOT_NOUN}|${IMAGE_NOUN})`;
const POSITIVE = new RegExp(
  String.raw`(?:\b(?:add|include|insert|create|generate|make|use|provide|prepare|leave|want|need|with|show|draw|give)(?:\s+me)?(?:\s+(?:some|many|more|another|additional|lots?\s+of|tons?\s+of|a|an|the))?\s+${IMAGE_NOUN}\b|\b(?:illustrate|visualize|visualise)\s+(?:this|that|these|the|my)\b|\b${SLOT_NOUN}\b|\b${IMAGE_NOUN}\s+(?:throughout|alongside|for\s+(?:each|the)|in\s+(?:the|my|these))\b)`,
  'giu',
);
const NEGATIVE = new RegExp(
  String.raw`(?:\b(?:no|without)\s+(?:any\s+|more\s+)?${IMAGE_OR_SLOT}\b|\b(?:do\s+not|don't|dont|never|stop|avoid|skip)\s+(?:add|include|insert|create|generate|make|use|provide|prepare|show|draw|give|want|need)(?:\s+me)?(?:\s+(?:any|all|more|some|the))?\s+${IMAGE_OR_SLOT}\b|\b(?:did\s+not|didn't|didnt)\s+(?:ask|request)\s+for(?:\s+any)?\s+${IMAGE_OR_SLOT}\b|\bremove\s+(?:all\s+|the\s+)?${IMAGE_OR_SLOT}\b|\bnot\s+${IMAGE_OR_SLOT}\b)`,
  'giu',
);

function lastDirective(text: string): {
  requested: boolean;
  index: number;
  end: number;
  evidence: string;
} | null {
  let last: {
    requested: boolean;
    index: number;
    end: number;
    evidence: string;
  } | null = null;
  POSITIVE.lastIndex = 0;
  for (const match of text.matchAll(POSITIVE)) {
    if (match.index === undefined) continue;
    const end = match.index + match[0].length;
    // Reusing pixels the reader already attached is a managed-asset request,
    // not permission to add a different external image or generation slot.
    // Keep scanning because the same message may separately ask for both.
    const before = text.slice(Math.max(0, match.index - 16), match.index);
    const after = text.slice(end, Math.min(text.length, end + 40));
    if (
      /\b(?:attached|uploaded|supplied|provided)\s*$/i.test(before) ||
      /^\s+(?:that\s+)?(?:i|we)\s+(?:attached|uploaded|supplied|provided)\b/i.test(after)
    ) {
      continue;
    }
    if (last !== null && end < last.end) continue;
    last = { requested: true, index: match.index, end, evidence: match[0] };
  }
  NEGATIVE.lastIndex = 0;
  for (const match of text.matchAll(NEGATIVE)) {
    if (match.index === undefined) continue;
    const end = match.index + match[0].length;
    // Compare the end position, not just the start. A negative directive such
    // as “do not add any picture slots” contains the positive noun “picture
    // slots”; the encompassing later-completing directive must win.
    if (last !== null && end < last.end) continue;
    last = { requested: false, index: match.index, end, evidence: match[0] };
  }
  return last;
}

export function explicitImageRequest(
  state: Pick<AgentState, 'conversation' | 'taskBrief'>,
): ExplicitImageRequest {
  let latest: ExplicitImageRequest = { requested: false };
  const userMessages = state.conversation.filter((message) => message.role === 'user');
  const messages: readonly { readonly id?: string; readonly text: string }[] =
    userMessages.length > 0 ? userMessages : [{ text: state.taskBrief.goal }];
  for (const message of messages) {
    const directive = lastDirective(message.text);
    if (directive === null) continue;
    latest = {
      requested: directive.requested,
      ...(message.id === undefined ? {} : { messageId: message.id }),
      evidence: directive.evidence,
    };
  }
  return latest;
}

export function assertPortableImagesRequested(
  state: Pick<AgentState, 'conversation' | 'taskBrief'>,
): void {
  if (!explicitImageRequest(state).requested) {
    throw new Error(
      'portable image slots and external image prompts require an explicit reader request for images, illustrations, pictures, photos, or picture slots',
    );
  }
}
