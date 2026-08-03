/**
 * src/sound/SoundCredits.tsx — the in-app credits for every shipped cue.
 *
 * One source in the set (the rain bed) is CC BY 4.0, and a CC BY licence is
 * only satisfied if the credit actually reaches a person. Nothing here is
 * hard-coded: the panel FETCHES `/sounds/CREDITS.json`, which
 * `scripts/gen-sounds.mjs` rewrites from the same table that drives the audio
 * on every build. Swap a source, rebuild, and the panel says so — there is no
 * second place to remember to edit, which is exactly how a credit goes stale.
 *
 * The manifest lists provenance per cue; a reader wants it per recording, so
 * this regroups: one entry per source, with the cues it became.
 */

import { For, Show, createResource, type JSX } from 'solid-js';
import { isTauri } from '../data/db';
import {
  groupCredits,
  shortLicence,
  summariseCues,
  type CreditGroup,
  type CreditsManifest,
} from './credits';

/* --------------------------------- view ------------------------------------ */

/** Open a URL in the system browser (Tauri) or a new tab (dev). */
function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri()) {
    void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url));
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

async function fetchCredits(): Promise<CreditsManifest> {
  const response = await fetch('/sounds/CREDITS.json');
  if (!response.ok) throw new Error(`credits ${response.status}`);
  return (await response.json()) as CreditsManifest;
}

function SourceLink(props: { href: string; children: JSX.Element }): JSX.Element {
  return (
    <button
      type="button"
      class="nbs-credit-link font-ui"
      onClick={() => openExternal(props.href)}
    >
      {props.children}
    </button>
  );
}

/**
 * The disclosure body for the settings sheet's "sound credits" row.
 *
 * Rendered inline rather than as a modal on purpose: it is reference material
 * someone reads next to the volume sliders, and a second focus-trapped layer
 * over a focus-trapped sheet is a trap for keyboard users.
 */
export default function SoundCredits(): JSX.Element {
  const [manifest] = createResource(fetchCredits);
  const groups = (): CreditGroup[] => groupCredits(manifest());
  const required = (): string[] => manifest()?.attributionsRequired ?? [];

  return (
    <div class="nbs-credits" aria-live="polite">
      <Show when={manifest.loading}>
        <p class="nbs-credit-note font-ui">reading the manifest…</p>
      </Show>
      <Show when={manifest.error}>
        <p class="nbs-credit-note font-ui">
          Couldn’t read <code>public/sounds/CREDITS.json</code>. Every cue’s
          provenance is in that file and in <code>docs/design/sound.md</code>.
        </p>
      </Show>

      <Show when={required().length > 0}>
        <div class="nbs-credit-required">
          <p class="nbs-credit-note font-ui">
            These credits ship with the app because their licence requires it:
          </p>
          <ul class="nbs-credit-oblig">
            <For each={required()}>{(line) => <li>{line}</li>}</For>
          </ul>
        </div>
      </Show>

      <ul class="nbs-credit-list">
        <For each={groups()}>
          {(group) => (
            <li class="nbs-credit">
              <span class="nbs-credit-title">{group.credit.title}</span>
              <span class="nbs-credit-by font-ui">by {group.credit.author}</span>
              <span
                class="nbs-credit-licence font-ui"
                data-tooltip={group.credit.licence}
                data-required={group.credit.attributionRequired ? 'true' : undefined}
              >
                {shortLicence(group.credit.licence)}
              </span>
              <span class="nbs-credit-cues font-ui">{summariseCues(group.cues)}</span>
              <span class="nbs-credit-links">
                <SourceLink href={group.credit.sourcePage}>source</SourceLink>
                <SourceLink href={group.credit.licenceUrl}>licence</SourceLink>
                <Show when={group.credit.originallyFrom}>
                  {(href) => <SourceLink href={href()}>original</SourceLink>}
                </Show>
              </span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
