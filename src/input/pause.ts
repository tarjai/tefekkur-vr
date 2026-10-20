// VR içindeki tek etkileşim: herhangi bir `select` (kontrolcü tetiği ya da el takibinde kıstırma) → duraklat/devam.
// Masaüstü/emülatör testinde Boşluk tuşu aynı işi görür.
import { PAUSE_KEY_CODES, PAUSE_TOGGLE_DEBOUNCE_MS } from '../config';

/** Dinleyicileri bağlar; dönen fonksiyon hepsini kaldırır. */
export function bindPauseInput(session: XRSession, onToggle: () => void, keyTarget: Window | null = window): () => void {
  let lastToggleMs = -Infinity;
  // İki elin aynı anda tetiklemesi ya da çift olay tek geçiş sayılır.
  const toggle = (timeStamp: number) => {
    if (timeStamp - lastToggleMs < PAUSE_TOGGLE_DEBOUNCE_MS) return;
    lastToggleMs = timeStamp;
    onToggle();
  };
  const onSelect = (event: XRInputSourceEvent) => toggle(event.timeStamp);
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat || !(PAUSE_KEY_CODES as readonly string[]).includes(event.code)) return;
    event.preventDefault();
    toggle(event.timeStamp);
  };

  session.addEventListener('select', onSelect);
  keyTarget?.addEventListener('keydown', onKey);
  return () => {
    session.removeEventListener('select', onSelect);
    keyTarget?.removeEventListener('keydown', onKey);
  };
}
