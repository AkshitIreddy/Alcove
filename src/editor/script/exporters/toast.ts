/**
 * src/editor/script/exporters/toast.ts — tiny standalone toast for group D
 * flows (export, import, templates, stickers). Reuses the .nb-script-toast
 * hand-drawn styling from insert.css; self-mounting so the standalone
 * components need no host plumbing while rail wiring lands.
 */
import { LINGER_MS } from '../../../styles/motion';

let toastElement: HTMLDivElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Show a short transient message (bottom-center paper chip). */
export function notify(message: string, ms = LINGER_MS.toast): void {
  if (typeof document === 'undefined') return;
  if (toastElement === null || !toastElement.isConnected) {
    toastElement = document.createElement('div');
    toastElement.className = 'nb-script-toast nb-groupd-toast';
    toastElement.setAttribute('role', 'status');
    document.body.appendChild(toastElement);
  }
  toastElement.textContent = message;
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastElement?.remove();
    toastElement = null;
  }, ms);
}
