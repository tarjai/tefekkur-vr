// Prosedürel çan: prompt belirirken tek vuruş. Vuruş başına grafik:
//   parçalı[i]: sinüs osc → zarf (0 → tepe yumuşak tokmak, sonra üstel sönüm) ──┐
//                                                                         ├→ HRTF PannerNode → engine.fxBus
// Son parçalı bitince vuruşun tüm düğümleri ayrılır (60 dk'lık seansta birikme olmaz).
import {
  AUDIO_MASTER_GAIN,
  AUDIO_STOP_TAIL_S,
  BELL_BASE_HZ,
  BELL_GAIN,
  BELL_MAX_DISTANCE_M,
  BELL_PARTIALS,
  BELL_REF_DISTANCE_M,
  BELL_ROLLOFF,
  BELL_SILENCE_GAIN,
  BELL_SOFT_ATTACK_S,
} from '../config';
import type { AudioEngine, Vec3 } from './engine';

export interface Bell {
  /** Sahne konumundan (dinleyiciyle aynı referans uzayı, m) tek vuruş. Sonlu olmayan konum yok sayılır. */
  ring(position: Vec3): void;
  /** Çalan tüm vuruşları anında durdurur ve ayırır; idempotent. Sonrasında ring() etkisiz. */
  dispose(): void;
}

interface BellPartial {
  readonly hz: number;
  /** Zarfın tepe kazancı. */
  readonly peak: number;
  /** Tepeden sessizliğe (BELL_SILENCE_GAIN × tepe) üstel sönüm süresi, sn. */
  readonly decayS: number;
}

interface Strike {
  readonly sources: OscillatorNode[];
  readonly nodes: AudioNode[];
  tornDown: boolean;
}

/** Tam ölçek (0 dBFS). */
const FULL_SCALE = 1;

/**
 * Kırpılma payı: tüm parçalılar aynı anda tepede ve panner kazancı 1 (≤ BELL_REF_DISTANCE_M) iken master çıkışı
 * Σgenlik × BELL_GAIN × AUDIO_MASTER_GAIN olur. Bu tam ölçeği aşarsa genlikler toplamla normalize edilir; aşmıyorsa
 * düzeye dokunulmaz (şu an 3.81 × 0.32 × 0.8 ≈ 0.975 → ölçek 1). Gerçek tepe toplamın ≈ %68'i ve çan 12 m'den
 * çalınır (inverse: 2 / (2 + 0.6 × 10) = 0.25), bu yüzden drone'a da pay kalır.
 */
const AMP_SUM = BELL_PARTIALS.reduce((sum, [, amp]) => sum + Math.max(0, amp), 0);
const WORST_CASE_OUT = AMP_SUM * BELL_GAIN * AUDIO_MASTER_GAIN;
const HEADROOM_SCALE = WORST_CASE_OUT > FULL_SCALE ? FULL_SCALE / WORST_CASE_OUT : 1;

/** Geçerli parçalılar (üstel rampa için tepe > 0 şart). */
const PARTIALS: readonly BellPartial[] = BELL_PARTIALS.map(([ratio, amp, decayS]) => ({
  hz: BELL_BASE_HZ * ratio,
  peak: amp * BELL_GAIN * HEADROOM_SCALE,
  decayS,
})).filter((p) => p.hz > 0 && p.peak > 0 && p.decayS > 0 && Number.isFinite(p.hz + p.peak + p.decayS));

function isFiniteVec(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

function createPanner(ctx: AudioContext, [x, y, z]: Vec3): PannerNode {
  const panner = new PannerNode(ctx, {
    panningModel: 'HRTF',
    distanceModel: 'inverse',
    refDistance: BELL_REF_DISTANCE_M,
    rolloffFactor: BELL_ROLLOFF,
    maxDistance: BELL_MAX_DISTANCE_M,
    // Konum baştan verilir: HRTF ilk karede başka yönden kaymaz.
    positionX: x,
    positionY: y,
    positionZ: z,
  });
  // positionX AudioParam'ı olmayan eski tarayıcılar seçenekleri yok sayar; eski API ile konumlanır.
  if ((panner.positionX as AudioParam | undefined) === undefined) panner.setPosition(x, y, z);
  return panner;
}

export function createBell(engine: AudioEngine): Bell {
  const live = new Set<Strike>();
  let disposed = false;

  function teardown(strike: Strike): void {
    if (strike.tornDown) return;
    strike.tornDown = true;
    for (const node of strike.nodes) node.disconnect();
    live.delete(strike);
  }

  return {
    ring(position) {
      if (disposed || PARTIALS.length === 0 || !isFiniteVec(position)) return;
      const ctx = engine.ctx;
      if (!ctx) return;
      // Bağlam askıdaysa (duraklatma) currentTime donmuştur; vuruş sürdürmeden sonra baştan çalar.
      const now = ctx.currentTime;
      const attackEnd = now + BELL_SOFT_ATTACK_S;

      const panner = createPanner(ctx, position);
      panner.connect(engine.fxBus);
      const strike: Strike = { sources: [], nodes: [panner], tornDown: false };

      let ended = 0;
      const onEnded = () => {
        ended += 1;
        if (ended >= strike.sources.length) teardown(strike);
      };

      for (const partial of PARTIALS) {
        const osc = new OscillatorNode(ctx, { type: 'sine', frequency: partial.hz });
        const envelope = new GainNode(ctx, { gain: 0 });
        const decayEnd = attackEnd + partial.decayS;
        // Yumuşak tokmak (tıkırtısız), sonra uzun üstel sönüm; sessizlik seviyesinde osilatör durur.
        envelope.gain.setValueAtTime(0, now);
        envelope.gain.linearRampToValueAtTime(partial.peak, attackEnd);
        envelope.gain.exponentialRampToValueAtTime(partial.peak * BELL_SILENCE_GAIN, decayEnd);
        osc.connect(envelope).connect(panner);
        osc.addEventListener('ended', onEnded, { once: true });
        osc.start(now);
        osc.stop(decayEnd + AUDIO_STOP_TAIL_S);
        strike.sources.push(osc);
        strike.nodes.push(osc, envelope);
      }
      live.add(strike);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const strike of [...live]) {
        for (const source of strike.sources) {
          try {
            source.stop();
          } catch {
            // Zaten durmuş kaynak: yapılacak bir şey yok.
          }
        }
        teardown(strike);
      }
      live.clear();
    },
  };
}
