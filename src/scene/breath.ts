// Nefes ritmi sinyali (0..1): halka parlaklığı, partikül hızı ve prompt ölçeği buna bağlı.
import { BREATH_PERIOD_S } from '../config';

const PERIOD_MS = BREATH_PERIOD_S * 1000;

/** Saf: t = 0 → 0 (nefes verilmiş), yarım periyot → 1 (nefes alınmış). Sinüs, periyot BREATH_PERIOD_S. */
export function breathAt(sessionTimeMs: number): number {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * sessionTimeMs) / PERIOD_MS);
}
