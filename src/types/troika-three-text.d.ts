// troika-three-text kendi TypeScript tiplerini içermiyor; projede kullanılan yüzey burada tanımlı.
declare module 'troika-three-text' {
  import type { Material, Mesh, BufferGeometry, Color } from 'three';

  export interface TextRenderInfo {
    /** [minX, minY, maxX, maxY] — yerleşimdeki tüm metin bloğunun sınırları (yerel birim). */
    blockBounds: [number, number, number, number];
    /** [minX, minY, maxX, maxY] — görünen gliflerin sınırları. */
    visibleBounds: [number, number, number, number];
    [key: string]: unknown;
  }

  export class Text extends Mesh<BufferGeometry, Material | Material[]> {
    text: string;
    font: string | null;
    fontSize: number;
    fontWeight: number | 'normal' | 'bold';
    lineHeight: number | 'normal';
    letterSpacing: number;
    maxWidth: number;
    textAlign: 'left' | 'right' | 'center' | 'justify';
    anchorX: number | 'left' | 'center' | 'right' | `${number}%`;
    anchorY: number | 'top' | 'top-baseline' | 'top-cap' | 'top-ex' | 'middle' | 'bottom-baseline' | 'bottom' | `${number}%`;
    overflowWrap: 'normal' | 'break-word';
    whiteSpace: 'normal' | 'nowrap';
    color: string | number | Color | null;
    fillOpacity: number;
    outlineWidth: number | string;
    outlineColor: string | number | Color;
    outlineOpacity: number;
    outlineBlur: number | string;
    depthOffset: number;
    sdfGlyphSize: number | null;
    gpuAccelerateSDF: boolean;
    material: Material;
    readonly textRenderInfo: TextRenderInfo | null;
    sync(callback?: () => void): void;
    dispose(): void;
  }

  export function preloadFont(
    options: { font?: string | null; characters?: string | string[]; sdfGlyphSize?: number },
    /** troika bunu koşulsuz çağırır: zorunlu. */
    callback: () => void,
  ): void;

  export function configureTextBuilder(config: {
    defaultFontURL?: string;
    sdfGlyphSize?: number;
    sdfMargin?: number;
    textureWidth?: number;
    useWorker?: boolean;
  }): void;
}
