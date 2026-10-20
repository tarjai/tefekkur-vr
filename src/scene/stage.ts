// Seans başında kullanıcının bakış yönüne göre bir kez sabitlenen sahne çerçevesi.
// Prompt yolu, halka ve çanın konumu buradan hesaplanır; baş hareketini takip etmez.
import * as THREE from 'three';
import { PROMPT_BELOW_EYE_DEG, RING_DISTANCE_M } from '../config';

export interface Stage {
  /** Seans başındaki göz konumu (dünya koordinatı). */
  readonly eye: THREE.Vector3;
  /** Yatay bakış yönü (birim vektör, y = 0). */
  readonly forward: THREE.Vector3;
  /** Zeminin y değeri. */
  readonly floorY: number;
  /** Gözden prompt yoluna doğru birim vektör: forward, PROMPT_BELOW_EYE_DEG aşağı eğik. */
  readonly promptDir: THREE.Vector3;
  /** Prompt metninin göze dönük sabit yönelimi (+Z göze bakar). */
  readonly promptQuaternion: THREE.Quaternion;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Baş konumu + yöneliminden sahne çerçevesi üretir. Yalnızca yaw kullanılır (pitch/roll yok sayılır). */
export function createStage(eye: THREE.Vector3, headQuaternion: THREE.Quaternion, floorY: number): Stage {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(headQuaternion);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();

  const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
  const promptDir = forward
    .clone()
    .applyAxisAngle(right, -THREE.MathUtils.degToRad(PROMPT_BELOW_EYE_DEG))
    .normalize();

  // Matrix4.lookAt(a, b, up): +Z ekseni b'den a'ya bakar → metin göze döner, yuvarlanma (roll) yok.
  const facing = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), promptDir, UP);
  const promptQuaternion = new THREE.Quaternion().setFromRotationMatrix(facing);

  return { eye: eye.clone(), forward, floorY, promptDir, promptQuaternion };
}

/** Gözden `distanceM` uzaklıkta, prompt yolu üzerindeki nokta. */
export function promptPosition(stage: Stage, distanceM: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(stage.promptDir).multiplyScalar(distanceM).add(stage.eye);
}

/** Zemindeki ışık halkasının merkezi: kullanıcının RING_DISTANCE_M önünde. */
export function ringCenter(stage: Stage, out = new THREE.Vector3()): THREE.Vector3 {
  out.copy(stage.forward).multiplyScalar(RING_DISTANCE_M).add(stage.eye);
  out.y = stage.floorY;
  return out;
}
