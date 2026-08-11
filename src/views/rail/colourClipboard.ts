/**
 * A reliable colour clipboard for the studios.
 *
 * The browser/system clipboard is useful because it lets a hex arrive from a
 * design tool, but it is permission-gated. The in-app value is therefore the
 * source of truth for copy in one picker and paste in another; system access
 * is a best-effort bridge in both directions.
 */
import { normaliseHex } from '../../art/customColour';

/** The small part of the browser clipboard this feature needs. */
export interface ColourTextClipboard {
  readText?(): Promise<string>;
  writeText?(text: string): Promise<void>;
}

let copiedColour: string | null = null;

function browserClipboard(): ColourTextClipboard | null {
  try {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return null;
    return navigator.clipboard;
  } catch {
    return null;
  }
}

/** Copy a canonical colour internally, with a best-effort system mirror. */
export async function copyColour(
  value: unknown,
  clipboard: ColourTextClipboard | null = browserClipboard(),
): Promise<string | null> {
  const hex = normaliseHex(value);
  if (hex === null) return null;
  copiedColour = hex;
  try {
    await clipboard?.writeText?.(hex);
  } catch {
    // The internal clipboard already makes cross-picker paste reliable.
  }
  return hex;
}

/**
 * Prefer a readable system hex (so colours copied outside Alcove can enter),
 * then fall back to Alcove's own last copied colour when permission is denied
 * or the operating-system clipboard contains unrelated text.
 */
export async function pasteColour(
  clipboard: ColourTextClipboard | null = browserClipboard(),
): Promise<string | null> {
  try {
    const external = clipboard?.readText === undefined
      ? null
      : normaliseHex(await clipboard.readText());
    if (external !== null) {
      copiedColour = external;
      return external;
    }
  } catch {
    // Permission failures are precisely why the internal fallback exists.
  }
  return copiedColour;
}
