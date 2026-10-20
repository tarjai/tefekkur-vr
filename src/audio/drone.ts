// Prosedürel pad. Grafik (set başına):
//   osc[i] (detune'lu) ──┐
//   plateauOsc → plateauGain ──┤→ lowpass filtre → voiceGain → engine.droneBus
//   lfo → lfoDepth → filtre.frequency (yavaş süpürme)
// Drone seanslar arası yeniden kullanılır. OscillatorNode yeniden başlatılamadığı için her start() yeni bir
// set kurar; stop() edilen set kendi kıs → durdur → 'ended' döngüsüyle sökülür. Setler birbirinden bağımsızdır:
// askıdaki bağlamda bekleyen eski durdurmalar yeni seti kesemez, start/stop art arda gelse de eski set sadece
// kendi kazancıyla söner (çapraz geçiş) ve düğüm sızmaz.
import {
  AUDIO_MIN_RAMP_S,
  AUDIO_STOP_TAIL_S,
  DRONE_BASE_HZ,
  DRONE_DETUNE_CENTS,
  DRONE_FILTER_HZ,
  DRONE_FILTER_Q,
  DRONE_GAIN,
  DRONE_LFO_DEPTH_HZ,
  DRONE_LFO_HZ,
  DRONE_OSC_TYPES,
  DRONE_PLATEAU_FADE_S,
  DRONE_PLATEAU_FREQ_RATIO,
  DRONE_PLATEAU_GAIN,
  DRONE_PLATEAU_OSC_TYPE,
} from '../config';
import { rampParam, type AudioEngine } from './engine';

export interface Drone {
  /** Seans başı: çalan set yoksa yenisini kurar, voiceGain 0 → DRONE_GAIN (≥ AUDIO_MIN_RAMP_S). Çalan set varsa etkisiz. */
  start(): void;
  /** plateau katmanını aç/kapa (idempotent). Çalan set yoksa durum saklanır, sonraki start() uygular. */
  setPlateau(on: boolean): void;
  /** Seans sonu: ≥ AUDIO_MIN_RAMP_S'de kıs, sonra osilatörleri durdur; düğümler 'ended'de ayrılır. plateau sıfırlanır. */
  stop(): void;
  /** Anında söküm (fade yok); idempotent. Sonrasında diğer çağrılar etkisiz. */
  dispose(): void;
}

/** Tek bir start() ile kurulan düğüm seti. */
interface VoiceSet {
  /** Ses osilatörleri + plateau osilatörü + LFO; hepsi aynı anda durdurulur. */
  readonly sources: readonly OscillatorNode[];
  /** Ayrılacak tüm düğümler (kaynaklar dahil). */
  readonly nodes: readonly AudioNode[];
  readonly voiceGain: GainNode;
  readonly plateauGain: GainNode;
  tornDown: boolean;
}

const VOICE_FADE_S = AUDIO_MIN_RAMP_S;
const PLATEAU_FADE_S = Math.max(DRONE_PLATEAU_FADE_S, AUDIO_MIN_RAMP_S);
/**
 * Katman aynı filtreye girer: filtre süpürmesiyle birlikte nefes alır, üst harmonikleri pad gibi yumuşar ve
 * start/stop fade'i tek voiceGain'de kalır (stop() ayrıca plateau rampası istemez). voiceGain'den (DRONE_GAIN)
 * geçtiği için girişte DRONE_GAIN'e bölünür: çıkışta ana osilatörlerle aynı ölçekte DRONE_PLATEAU_GAIN olur.
 */
const PLATEAU_INPUT_GAIN = DRONE_GAIN > 0 ? DRONE_PLATEAU_GAIN / DRONE_GAIN : 0;

export function createDrone(engine: AudioEngine): Drone {
  /** Çalan (stop edilmemiş) set; en fazla bir tane. */
  let current: VoiceSet | null = null;
  /** stop() edilmiş, kaynaklarının bitmesini bekleyen setler. */
  const fading = new Set<VoiceSet>();
  let plateau = false;
  let disposed = false;

  function teardown(set: VoiceSet): void {
    if (set.tornDown) return;
    set.tornDown = true;
    for (const node of set.nodes) node.disconnect();
    fading.delete(set);
  }

  function createSet(ctx: AudioContext, bus: AudioNode, now: number): VoiceSet {
    const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: DRONE_FILTER_HZ, Q: DRONE_FILTER_Q });
    const voiceGain = new GainNode(ctx, { gain: 0 });
    filter.connect(voiceGain).connect(bus);

    const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: DRONE_LFO_HZ });
    const lfoDepth = new GainNode(ctx, { gain: DRONE_LFO_DEPTH_HZ });
    lfo.connect(lfoDepth).connect(filter.frequency);

    const voices = DRONE_OSC_TYPES.map(
      (type, i) => new OscillatorNode(ctx, { type, frequency: DRONE_BASE_HZ, detune: DRONE_DETUNE_CENTS[i] ?? 0 }),
    );
    for (const osc of voices) osc.connect(filter);

    const plateauOsc = new OscillatorNode(ctx, {
      type: DRONE_PLATEAU_OSC_TYPE,
      frequency: DRONE_BASE_HZ * DRONE_PLATEAU_FREQ_RATIO,
    });
    const plateauGain = new GainNode(ctx, { gain: 0 });
    plateauOsc.connect(plateauGain).connect(filter);

    const sources = [...voices, plateauOsc, lfo];
    const set: VoiceSet = {
      sources,
      nodes: [...sources, lfoDepth, plateauGain, filter, voiceGain],
      voiceGain,
      plateauGain,
      tornDown: false,
    };

    // Son kaynak bitince set sökülür (hepsi aynı anda durdurulur; sayaç sıradan bağımsız).
    let ended = 0;
    const onEnded = () => {
      ended += 1;
      if (ended >= sources.length) teardown(set);
    };
    for (const source of sources) {
      source.addEventListener('ended', onEnded, { once: true });
      source.start(now);
    }

    rampParam(voiceGain.gain, DRONE_GAIN, now, VOICE_FADE_S);
    if (plateau) rampParam(plateauGain.gain, PLATEAU_INPUT_GAIN, now, PLATEAU_FADE_S);
    return set;
  }

  return {
    start() {
      if (disposed || current) return;
      const ctx = engine.ctx;
      if (!ctx) return;
      // Askıdaysa currentTime donmuştur; başlangıç ve rampa sürdürmeden sonra oradan işler.
      current = createSet(ctx, engine.droneBus, ctx.currentTime);
    },

    setPlateau(on) {
      if (disposed || on === plateau) return;
      plateau = on;
      const ctx = engine.ctx;
      if (!current || !ctx) return;
      rampParam(current.plateauGain.gain, on ? PLATEAU_INPUT_GAIN : 0, ctx.currentTime, PLATEAU_FADE_S);
    },

    stop() {
      const ctx = engine.ctx;
      if (disposed || !current || !ctx) return;
      const set = current;
      current = null;
      // Sonraki seans plateau'suz başlar (seans sonunda phaseStart gelmez).
      plateau = false;
      fading.add(set);
      const now = ctx.currentTime;
      rampParam(set.voiceGain.gain, 0, now, VOICE_FADE_S);
      // Askıdaysa bu zamanlar sürdürmeden sonra işler; yalnız bu setin kaynaklarını etkiler.
      const stopAt = now + VOICE_FADE_S + AUDIO_STOP_TAIL_S;
      for (const source of set.sources) source.stop(stopAt);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      const sets = current ? [current, ...fading] : [...fading];
      current = null;
      for (const set of sets) {
        for (const source of set.sources) {
          try {
            source.stop();
          } catch {
            // Zaten durmuş kaynak: yapılacak bir şey yok.
          }
        }
        teardown(set);
      }
      fading.clear();
    },
  };
}
