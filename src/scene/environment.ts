// Ortam: gökyüzü gradyanı, üstel sis, zemindeki nefes halkası, süzülen partiküller.
// Gölge ve post-processing yok; toplam 3 draw call. Kamera ve sahne hiç hareket etmez.
import * as THREE from 'three';
import {
  COLORS,
  FOG_DENSITY,
  MOOD_LIGHT_COLOR,
  MOOD_TRANSITION_S,
  PARTICLE_AREA_HEIGHT_M,
  PARTICLE_AREA_RADIUS_M,
  PARTICLE_COUNT,
  PARTICLE_EDGE_FADE_RATIO,
  PARTICLE_MAX_RISE_DEG,
  PARTICLE_OPACITY,
  PARTICLE_SIZE_PX,
  PARTICLE_SPEED_BASE,
  PARTICLE_SPEED_BREATH,
  PARTICLE_SPEED_JITTER,
  PLATEAU_DARKEN,
  PREVIEW_EYE_HEIGHT_M,
  RETURN_BRIGHTEN,
  RING_FLOOR_OFFSET_M,
  RING_INNER_RADIUS_M,
  RING_OPACITY_MAX,
  RING_OPACITY_MIN,
  RING_OUTER_RADIUS_M,
  RING_SEGMENTS,
  SKY_GRADIENT_EXPONENT,
  SKY_HEIGHT_SEGMENTS,
  SKY_RADIUS_M,
  SKY_RENDER_ORDER,
  SKY_WIDTH_SEGMENTS,
} from '../config';
import type { PhaseSpan } from '../session/types';
import { createStage, ringCenter, type Stage } from './stage';

export interface Environment {
  setStage(stage: Stage): void;
  onPhaseStart(phase: PhaseSpan): void;
  update(sessionTimeMs: number, breath: number, sessionDeltaMs: number): void;
  reset(): void;
  dispose(): void;
}

export interface Mood {
  /** plateau koyulaşması, 0..1. */
  darkness: number;
  /** return aydınlanması, 0..1. */
  brightness: number;
}

const MOOD_MS = MOOD_TRANSITION_S * 1000;

/** 2D önizleme çerçevesi: orijinde, -Z'ye bakan, oturur göz yüksekliği, zemin y = 0. */
export function createPreviewStage(): Stage {
  return createStage(new THREE.Vector3(0, PREVIEW_EYE_HEIGHT_M, 0), new THREE.Quaternion(), 0);
}

function moodRamp(sessionTimeMs: number, startMs: number | null): number {
  if (startMs === null) return 0;
  return THREE.MathUtils.smoothstep(sessionTimeMs, startMs, startMs + MOOD_MS);
}

/**
 * Saf: ortam havası seans zamanının fonksiyonu (kare tabanlı yumuşatma yok).
 * darkness plateau başından itibaren 0→1 yükselir, return başından itibaren 1→0 iner;
 * brightness return başından itibaren 0→1 yükselir. Geçişler MOOD_TRANSITION_S, smoothstep.
 */
export function moodAt(
  sessionTimeMs: number,
  plateauStartMs: number | null,
  returnStartMs: number | null,
): Mood {
  const returned = moodRamp(sessionTimeMs, returnStartMs);
  return { darkness: moodRamp(sessionTimeMs, plateauStartMs) * (1 - returned), brightness: returned };
}

// ---------- Gökyüzü ----------

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Bakış yönünün y bileşenine göre alt → ufuk → üst; ardından hava (koyulaş / aydınlan).
const SKY_FRAGMENT = /* glsl */ `
#include <common>
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uLight;
uniform float uDim;
uniform float uLightMix;
uniform float uExponent;
varying vec3 vDir;
#include <dithering_pars_fragment>
void main() {
  float h = normalize(vDir).y;
  vec3 col = h >= 0.0
    ? mix(uHorizon, uTop, pow(max(h, 0.0), uExponent))
    : mix(uHorizon, uBottom, pow(max(-h, 0.0), uExponent));
  col = mix(col * uDim, uLight, uLightMix);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

interface Sky {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  dim: THREE.IUniform<number>;
  lightMix: THREE.IUniform<number>;
}

function createSky(lightColor: THREE.Color): Sky {
  const dim: THREE.IUniform<number> = { value: 1 };
  const lightMix: THREE.IUniform<number> = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(COLORS.skyTop) },
      uHorizon: { value: new THREE.Color(COLORS.skyHorizon) },
      uBottom: { value: new THREE.Color(COLORS.skyBottom) },
      uLight: { value: lightColor },
      uDim: dim,
      uLightMix: lightMix,
      uExponent: { value: SKY_GRADIENT_EXPONENT },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false, // sis gökyüzünü tamamen yutmasın
    dithering: true, // koyu gradyanda bantlanmayı azaltır
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS_M, SKY_WIDTH_SEGMENTS, SKY_HEIGHT_SEGMENTS),
    material,
  );
  mesh.renderOrder = SKY_RENDER_ORDER;
  mesh.frustumCulled = false;
  return { mesh, dim, lightMix };
}

// ---------- Halka ----------

function createRing(): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.RingGeometry(RING_INNER_RADIUS_M, RING_OUTER_RADIUS_M, RING_SEGMENTS);
  geometry.rotateX(-Math.PI / 2); // XY düzleminden zemine: yüz yukarı bakar
  const material = new THREE.MeshBasicMaterial({
    color: COLORS.ring,
    transparent: true,
    opacity: RING_OPACITY_MIN,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false, // toplamalı karışımda sis rengi eklenmesin
  });
  return new THREE.Mesh(geometry, material);
}

// ---------- Partiküller ----------

// Hareket tamamen vertex shader'da: konum = taban + yön × uDrift, hacim içinde sarılır.
// Yatayda [-R, R]² karesinde sarılır; silindir dışı ve hacmin alt/üst kenarı yumuşakça söner.
const PARTICLE_VERTEX = /* glsl */ `
attribute vec3 aVelocity;
uniform float uDrift;
uniform float uRadius;
uniform float uHeight;
uniform float uEdge;
uniform float uSize;
varying float vFade;
#include <fog_pars_vertex>
void main() {
  vec3 p = position + aVelocity * uDrift;
  p.xz = mod(p.xz + uRadius, 2.0 * uRadius) - uRadius;
  p.y = mod(p.y, uHeight);
  float edgeR = uRadius * uEdge;
  float edgeH = uHeight * uEdge;
  vFade = (1.0 - smoothstep(uRadius - edgeR, uRadius, length(p.xz)))
    * smoothstep(0.0, edgeH, p.y)
    * (1.0 - smoothstep(uHeight - edgeH, uHeight, p.y));
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uSize;
  #include <fog_vertex>
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

interface Particles {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  drift: THREE.IUniform<number>;
}

function createParticleGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const velocities = new Float32Array(PARTICLE_COUNT * 3);
  const maxRise = THREE.MathUtils.degToRad(PARTICLE_MAX_RISE_DEG);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const o = i * 3;
    // Sarma karesinde düzgün dağılım: zamanla yoğunluk değişmez.
    positions[o] = THREE.MathUtils.randFloatSpread(2 * PARTICLE_AREA_RADIUS_M);
    positions[o + 1] = THREE.MathUtils.randFloat(0, PARTICLE_AREA_HEIGHT_M);
    positions[o + 2] = THREE.MathUtils.randFloatSpread(2 * PARTICLE_AREA_RADIUS_M);
    // Kendi yönü: çoğunlukla yatay, hafif yukarı; hızı 1 ± JITTER.
    const azimuth = THREE.MathUtils.randFloat(0, 2 * Math.PI);
    const rise = THREE.MathUtils.randFloat(0, maxRise);
    const speed = 1 + THREE.MathUtils.randFloatSpread(2 * PARTICLE_SPEED_JITTER);
    velocities[o] = Math.cos(rise) * Math.cos(azimuth) * speed;
    velocities[o + 1] = Math.sin(rise) * speed;
    velocities[o + 2] = Math.cos(rise) * Math.sin(azimuth) * speed;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
  return geometry;
}

function createParticles(): Particles {
  const drift: THREE.IUniform<number> = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uDrift: drift,
      uRadius: { value: PARTICLE_AREA_RADIUS_M },
      uHeight: { value: PARTICLE_AREA_HEIGHT_M },
      uEdge: { value: PARTICLE_EDGE_FADE_RATIO },
      uSize: { value: PARTICLE_SIZE_PX },
      uColor: { value: new THREE.Color(COLORS.particles) },
      uOpacity: { value: PARTICLE_OPACITY },
    },
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const points = new THREE.Points(createParticleGeometry(), material);
  points.frustumCulled = false; // shader konumları kaydırır; sınır küresi geçersiz
  return { points, drift };
}

// ---------- Ortam ----------

export function createEnvironment(scene: THREE.Scene): Environment {
  const previewStage = createPreviewStage();
  const baseFogColor = new THREE.Color(COLORS.fog);
  const lightColor = new THREE.Color(MOOD_LIGHT_COLOR);

  const fog = new THREE.FogExp2(COLORS.fog, FOG_DENSITY);
  const background = baseFogColor.clone(); // gökyüzü yoksa yedek
  scene.fog = fog;
  scene.background = background;

  const sky = createSky(lightColor);
  const ring = createRing();
  const particles = createParticles();
  scene.add(sky.mesh, ring, particles.points);

  let plateauStartMs: number | null = null;
  let returnStartMs: number | null = null;

  function setStage(stage: Stage): void {
    sky.mesh.position.copy(stage.eye);
    ringCenter(stage, ring.position);
    ring.position.y += RING_FLOOR_OFFSET_M;
    particles.points.position.set(stage.eye.x, stage.floorY, stage.eye.z);
  }

  function applyMood(mood: Mood): void {
    const dim = 1 - PLATEAU_DARKEN * mood.darkness;
    const lightMix = RETURN_BRIGHTEN * mood.brightness;
    sky.dim.value = dim;
    sky.lightMix.value = lightMix;
    fog.color.copy(baseFogColor).multiplyScalar(dim).lerp(lightColor, lightMix);
    background.copy(fog.color);
  }

  function onPhaseStart(phase: PhaseSpan): void {
    switch (phase.name) {
      case 'arrival': // yeni seans: önceki havayı unut
        plateauStartMs = null;
        returnStartMs = null;
        break;
      case 'plateau':
        plateauStartMs = phase.startMs;
        break;
      case 'return':
        returnStartMs = phase.startMs;
        break;
      default:
        break;
    }
  }

  function update(sessionTimeMs: number, breath: number, sessionDeltaMs: number): void {
    applyMood(moodAt(sessionTimeMs, plateauStartMs, returnStartMs));
    ring.material.opacity = THREE.MathUtils.lerp(RING_OPACITY_MIN, RING_OPACITY_MAX, breath);
    // Hız nefesi izler; duraklatmada seans deltası 0 olduğundan partiküller donar.
    const speed = PARTICLE_SPEED_BASE + PARTICLE_SPEED_BREATH * breath;
    particles.drift.value += (Math.max(0, sessionDeltaMs) / 1000) * speed;
  }

  function reset(): void {
    plateauStartMs = null;
    returnStartMs = null;
    particles.drift.value = 0;
    ring.material.opacity = RING_OPACITY_MIN;
    applyMood({ darkness: 0, brightness: 0 });
    setStage(previewStage);
  }

  function dispose(): void {
    scene.remove(sky.mesh, ring, particles.points);
    sky.mesh.geometry.dispose();
    sky.mesh.material.dispose();
    ring.geometry.dispose();
    ring.material.dispose();
    particles.points.geometry.dispose();
    particles.points.material.dispose();
    if (scene.fog === fog) scene.fog = null;
    if (scene.background === background) scene.background = null;
  }

  setStage(previewStage);
  return { setStage, onPhaseStart, update, reset, dispose };
}
