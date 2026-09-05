/**
 * Детерминированный PRNG mulberry32 (Tomasz Stawicki, 2015, public domain).
 *
 * Алгоритм (32-битное состояние s, seed приводится к uint32 через >>> 0):
 *
 *   next():
 *     s = (s + 0x6D2B79F5) >>> 0
 *     t = s
 *     t = imul(t ^ (t >>> 15), t | 1) >>> 0
 *     t = (t ^ (t + imul(t ^ (t >>> 7), t | 61))) >>> 0
 *     return ((t ^ (t >>> 14)) >>> 0) / 4294967296
 *
 * Math.random для воспроизводимого заполнения не используется.
 */

import { cellCount, idx, type WorldSize } from './world.ts';

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Случайное заполнение порядка cellCount(size) ячеек в порядке индекса
 * (x быстрее всего, затем y, затем z). density — целые проценты 0..100.
 * Клетка живая, если next() < density / 100.
 */
export function randomFill(
  size: WorldSize,
  seed: number,
  density: number,
): Uint8Array {
  const n = cellCount(size);
  const cells = new Uint8Array(n);
  const next = mulberry32(seed);
  const threshold = density / 100;
  const { width, height } = size;
  for (let z = 0; z < size.depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (next() < threshold) cells[idx(size, x, y, z)] = 1;
      }
    }
  }
  return cells;
}
