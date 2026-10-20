// Duraklatma katmanı: sahne PAUSE_DIM_OPACITY oranında kararır, okuma noktasının üstünde küçük durum metni.
// Seans saati duraklatmada donduğu için geçiş gerçek zamanla yapılır; tamamen sönünce nesneler gizlenir (draw call yok).
import * as THREE from 'three';
import { Text } from 'troika-three-text';
import {
  COLORS,
  PAUSE_DIM_FADE_S,
  PAUSE_DIM_HEIGHT_SEGMENTS,
  PAUSE_DIM_OPACITY,
  PAUSE_DIM_RADIUS_M,
  PAUSE_DIM_RENDER_ORDER,
  PAUSE_DIM_WIDTH_SEGMENTS,
  PAUSE_TEXT_ANGULAR_SIZE_DEG,
  PAUSE_TEXT_OFFSET_Y_M,
  PAUSE_TEXT_RENDER_ORDER,
  PROMPT_READ_DISTANCE_M,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_WIDTH_EM,
} from '../config';
import { STRINGS } from '../strings';
import { createPreviewStage } from './environment';
import { PROMPT_FONT_SIZE_M, easeInOut, fontSizeForAngle } from './promptView';
import { promptPosition, type Stage } from './stage';

export interface PauseOverlay {
  setStage(stage: Stage): void;
  setPaused(paused: boolean): void;
  update(realDeltaMs: number): void;
  readonly visible: boolean;
  dispose(): void;
}

const FADE_MS = PAUSE_DIM_FADE_S * 1000;

/** Kamera sahne grafiğinde olmalı (çağıran garanti eder); kararma küresi kameraya bağlanır. */
export function createPauseOverlay(scene: THREE.Scene, camera: THREE.Camera, fontUrl: string): PauseOverlay {
  // Kafaya bağlı düzgün kararma: kamerayı saran küçük küre, her şeyin üstüne çizilir.
  const dimGeometry = new THREE.SphereGeometry(
    PAUSE_DIM_RADIUS_M,
    PAUSE_DIM_WIDTH_SEGMENTS,
    PAUSE_DIM_HEIGHT_SEGMENTS,
  );
  const dimMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.pauseDim,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const dim = new THREE.Mesh(dimGeometry, dimMaterial);
  dim.renderOrder = PAUSE_DIM_RENDER_ORDER;
  dim.frustumCulled = false;
  dim.visible = false;
  camera.add(dim);

  // Durum metni dünyada sabit: okuma noktasının biraz üstünde, göze dönük.
  const fontSize = fontSizeForAngle(PROMPT_READ_DISTANCE_M, PAUSE_TEXT_ANGULAR_SIZE_DEG);
  const textMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.pauseText,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const text = new Text();
  text.text = `${STRINGS.paused}\n${STRINGS.pausedHint}`;
  text.font = fontUrl;
  text.fontSize = fontSize;
  text.maxWidth = PROMPT_FONT_SIZE_M * TEXT_MAX_WIDTH_EM; // prompt satırlarıyla aynı genişlik
  text.lineHeight = TEXT_LINE_HEIGHT;
  text.textAlign = 'center';
  text.anchorX = 'center';
  text.anchorY = 'middle';
  text.color = COLORS.pauseText;
  text.material = textMaterial;
  text.fillOpacity = 0;
  text.renderOrder = PAUSE_TEXT_RENDER_ORDER;
  text.visible = false;
  scene.add(text);
  text.sync(); // ilk duraklatmada gecikme olmasın

  let paused = false;
  /** 0 = tamamen sönük, 1 = tamamen görünür (doğrusal; görünüme ease ile yansır). */
  let level = 0;

  function place(stage: Stage): void {
    promptPosition(stage, PROMPT_READ_DISTANCE_M, text.position);
    text.position.y += PAUSE_TEXT_OFFSET_Y_M;
    text.quaternion.copy(stage.promptQuaternion);
  }

  function apply(): void {
    const shown = level > 0;
    dim.visible = shown;
    text.visible = shown;
    const eased = easeInOut(level);
    dimMaterial.opacity = PAUSE_DIM_OPACITY * eased;
    text.fillOpacity = eased;
  }

  function update(realDeltaMs: number): void {
    const target = paused ? 1 : 0;
    if (level === target) return;
    const step = FADE_MS > 0 ? Math.max(0, realDeltaMs) / FADE_MS : 1;
    level = target > level ? Math.min(target, level + step) : Math.max(target, level - step);
    apply();
  }

  function dispose(): void {
    camera.remove(dim);
    scene.remove(text);
    dimGeometry.dispose();
    dimMaterial.dispose();
    text.dispose();
    textMaterial.dispose();
  }

  place(createPreviewStage());

  return {
    setStage: place,
    setPaused(next: boolean): void {
      paused = next;
    },
    update,
    get visible(): boolean {
      return level > 0;
    },
    dispose,
  };
}
