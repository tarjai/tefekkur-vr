// 2D ekranlar: deste/süre seçimi + "VR'a Gir", seans sonrası kapanış cevabı. Düz DOM, framework yok.
import { LOCALE, SAVED_NOTICE_MS, SESSION_DURATIONS_MIN, STORAGE_KEY_PREFS } from '../config';
import { STRINGS } from '../strings';
import type { DeckLoadError, LoadedDeck } from '../deck/loader';
import { browserStore } from '../log/sessionLog';

export type XrAvailability = 'checking' | 'supported' | 'unsupported';

export interface ScreensHandlers {
  onEnter(deck: LoadedDeck, durationMin: number): void;
  onExport(): void;
}

export interface ClosingOptions {
  question: string;
  early: boolean;
  onDone(answer: string | null): void;
}

export interface Screens {
  showStart(): void;
  showClosing(options: ClosingOptions): void;
  setXrAvailability(availability: XrAvailability): void;
  setBusy(busy: boolean): void;
  showError(message: string): void;
  setSessionsCount(count: number): void;
  setDevFlags(flags: readonly string[]): void;
  toast(message: string): void;
}

interface Prefs {
  deckId?: string;
  durationMin?: number;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} bulunamadı`);
  return node as T;
}

function readPrefs(): Prefs {
  try {
    const raw = browserStore()?.getItem(STORAGE_KEY_PREFS);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === 'object' && parsed !== null ? (parsed as Prefs) : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs: Prefs): void {
  try {
    browserStore()?.setItem(STORAGE_KEY_PREFS, JSON.stringify(prefs));
  } catch {
    // Tercih kaydı bir kolaylık; depolama yoksa sessizce geç.
  }
}

export function createScreens(
  decks: readonly LoadedDeck[],
  errors: readonly DeckLoadError[],
  defaultDurationMin: number,
  handlers: ScreensHandlers,
): Screens {
  const start = el<HTMLElement>('start-screen');
  const closing = el<HTMLElement>('closing-screen');
  const deckSelect = el<HTMLSelectElement>('deck-select');
  const deckMeta = el<HTMLParagraphElement>('deck-meta');
  const deckWarning = el<HTMLParagraphElement>('deck-warning');
  const deckErrors = el<HTMLUListElement>('deck-errors');
  const durationOptions = el<HTMLDivElement>('duration-options');
  const enterButton = el<HTMLButtonElement>('enter-vr');
  const xrStatus = el<HTMLParagraphElement>('xr-status');
  const sessionsCount = el<HTMLSpanElement>('sessions-count');
  const exportButton = el<HTMLButtonElement>('export');
  const devFlags = el<HTMLParagraphElement>('dev-flags');
  const closingNote = el<HTMLParagraphElement>('closing-note');
  const closingQuestion = el<HTMLLabelElement>('closing-question');
  const closingAnswer = el<HTMLTextAreaElement>('closing-answer');
  const closingSave = el<HTMLButtonElement>('closing-save');
  const closingSkip = el<HTMLButtonElement>('closing-skip');
  const toastEl = el<HTMLParagraphElement>('toast');

  // Statik metinler (hepsi strings.ts'den).
  document.title = STRINGS.appTitle;
  el('app-title').textContent = STRINGS.appTitle;
  el('app-subtitle').textContent = STRINGS.appSubtitle;
  el('deck-label').textContent = STRINGS.deckLabel;
  el('duration-label').textContent = STRINGS.durationLabel;
  enterButton.textContent = STRINGS.enterVr;
  exportButton.textContent = STRINGS.exportMarkdown;
  el('closing-title').textContent = STRINGS.closingTitle;
  closingAnswer.placeholder = STRINGS.closingPlaceholder;
  closingSave.textContent = STRINGS.save;
  closingSkip.textContent = STRINGS.skip;

  const prefs = readPrefs();
  let xrAvailability: XrAvailability = 'checking';
  let busy = false;
  let closingOptions: ClosingOptions | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // Desteler
  for (const { deck } of decks) {
    const option = document.createElement('option');
    option.value = deck.id;
    option.textContent = deck.title;
    deckSelect.append(option);
  }
  if (prefs.deckId && decks.some((d) => d.deck.id === prefs.deckId)) deckSelect.value = prefs.deckId;
  deckSelect.disabled = decks.length === 0;

  const allErrors = [...errors.map((e) => STRINGS.deckInvalid(e.file, e.message))];
  if (decks.length === 0) allErrors.unshift(STRINGS.noDecks);
  deckErrors.replaceChildren(
    ...allErrors.map((message) => {
      const li = document.createElement('li');
      li.textContent = message;
      return li;
    }),
  );
  deckErrors.hidden = allErrors.length === 0;

  const selectedDeck = () => decks.find((d) => d.deck.id === deckSelect.value) ?? null;

  // Süreler
  const initialDuration =
    prefs.durationMin && (SESSION_DURATIONS_MIN as readonly number[]).includes(prefs.durationMin)
      ? prefs.durationMin
      : defaultDurationMin;
  for (const minutes of SESSION_DURATIONS_MIN) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'duration';
    input.value = String(minutes);
    input.checked = minutes === initialDuration;
    const span = document.createElement('span');
    span.textContent = STRINGS.minutes(minutes);
    label.append(input, span);
    durationOptions.append(label);
  }
  const selectedDuration = () => {
    const checked = durationOptions.querySelector<HTMLInputElement>('input:checked');
    return checked ? Number(checked.value) : defaultDurationMin;
  };

  function renderDeckInfo() {
    const loaded = selectedDeck();
    deckMeta.textContent = loaded ? STRINGS.promptCount(loaded.deck.prompts.length) : '';
    deckWarning.hidden = !loaded?.localeMismatch;
    deckWarning.textContent = loaded?.localeMismatch ? STRINGS.localeMismatch(loaded.deck.locale, LOCALE) : '';
  }

  function renderEnter() {
    enterButton.disabled = busy || xrAvailability !== 'supported' || !selectedDeck();
    enterButton.textContent = busy ? STRINGS.starting : STRINGS.enterVr;
  }

  function setStatus(message: string, isError = false) {
    xrStatus.textContent = message;
    xrStatus.classList.toggle('error', isError);
  }

  deckSelect.addEventListener('change', () => {
    renderDeckInfo();
    renderEnter();
    writePrefs({ deckId: deckSelect.value, durationMin: selectedDuration() });
  });
  durationOptions.addEventListener('change', () => {
    writePrefs({ deckId: deckSelect.value, durationMin: selectedDuration() });
  });
  enterButton.addEventListener('click', () => {
    const loaded = selectedDeck();
    if (!loaded || enterButton.disabled) return;
    setStatus('');
    handlers.onEnter(loaded, selectedDuration());
  });
  exportButton.addEventListener('click', () => handlers.onExport());

  function finishClosing(answer: string | null) {
    const options = closingOptions;
    closingOptions = null;
    options?.onDone(answer);
  }
  closingSave.addEventListener('click', () => finishClosing(closingAnswer.value.trim()));
  closingSkip.addEventListener('click', () => finishClosing(null));

  renderDeckInfo();
  renderEnter();

  return {
    showStart() {
      closing.hidden = true;
      start.hidden = false;
      renderEnter();
    },
    showClosing(options) {
      closingOptions = options;
      closingQuestion.textContent = options.question;
      closingNote.textContent = STRINGS.closingEarly;
      closingNote.hidden = !options.early;
      closingAnswer.value = '';
      start.hidden = true;
      closing.hidden = false;
      closingAnswer.focus();
    },
    setXrAvailability(availability) {
      xrAvailability = availability;
      if (availability === 'checking') setStatus(STRINGS.xrChecking);
      else if (availability === 'unsupported') setStatus(STRINGS.xrUnsupported, true);
      else setStatus('');
      renderEnter();
    },
    setBusy(value) {
      busy = value;
      renderEnter();
    },
    showError(message) {
      setStatus(message, true);
    },
    setSessionsCount(count) {
      sessionsCount.textContent = STRINGS.sessionsCount(count);
      exportButton.disabled = count === 0;
    },
    setDevFlags(flags) {
      devFlags.textContent = flags.join(' · ');
      devFlags.hidden = flags.length === 0;
    },
    toast(message) {
      toastEl.textContent = message;
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastEl.hidden = true;
      }, SAVED_NOTICE_MS);
    },
  };
}
