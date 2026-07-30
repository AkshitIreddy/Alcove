/**
 * src/features/templates/UserStickersSection.tsx — "your stickers" panel
 * section (roadmap item 27). Standalone so the Stickers & effects rail panel
 * (src/views/rail/StickersPanel.tsx, owned by group B this wave) can mount
 * it with one line:
 *
 *   import UserStickersSection from '../../features/templates/UserStickersSection';
 *   …
 *   <UserStickersSection />
 *
 * Shows the imported sticker grid (click inserts at the caret, exactly like
 * the built-ins) plus a dashed "+ import" tile driving the PNG/SVG picker.
 */
import { For, createSignal, onCleanup, type JSX } from 'solid-js';
import { activeEditor } from '../../editor/insert/activeEditor';
import {
  listUserStickers,
  onUserStickersChange,
  type UserStickerRecord,
} from '../../editor/nodes/stickers';
import { importUserStickers } from './userStickers';
import '../../styles/templates.css';

export default function UserStickersSection(): JSX.Element {
  const [stickers, setStickers] = createSignal<UserStickerRecord[]>(
    listUserStickers(),
  );
  onCleanup(onUserStickersChange(() => setStickers(listUserStickers())));

  const insert = (sticker: UserStickerRecord): void => {
    const editor = activeEditor();
    if (!editor) return;
    editor.chain().focus().insertSticker({ stickerId: sticker.id }).run();
  };

  return (
    <section
      class="nb-panel-section nb-panel-section-divided nb-user-stickers"
      data-user-stickers
    >
      <h3 class="nb-panel-section-title">your stickers</h3>
      <div class="nb-sticker-grid" role="group" aria-label="Your stickers">
        <For each={stickers()}>
          {(sticker) => (
            <button
              type="button"
              class="nb-sticker-button nb-user-sticker-button"
              aria-label={`${sticker.name} sticker`}
              data-tip={sticker.name}
              onClick={() => insert(sticker)}
            >
              <img
                class="nb-sticker-art nb-sticker-art-user"
                src={sticker.src}
                alt=""
                draggable={false}
              />
            </button>
          )}
        </For>
        <button
          type="button"
          class="nb-sticker-button nb-user-sticker-import"
          aria-label="Import sticker image"
          data-tip="import png / svg"
          onClick={() => void importUserStickers()}
        >
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M 16.2 8.4 C 15.9 13.2 16 17.9 15.8 23.4 M 8.6 16.1 C 13.4 15.6 18.3 15.7 23.2 15.9"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
      <p class="nb-panel-footnote">
        png or svg — use it in script as {'{sticker=user:name}'}
      </p>
    </section>
  );
}
