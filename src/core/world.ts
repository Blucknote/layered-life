/**
 * Чистое ядро симуляции: состояние, соседство, шаг.
 * Не зависит от DOM и Three.js.
 *
 * Формула индекса: index = x + width * (y + height * z).
 * x меняется быстрее всего, затем y, затем z (этаж).
 */

export interface WorldSize {
  width: number;
  height: number;
  depth: number;
}

export const DEFAULT_SIZE: WorldSize = { width: 32, height: 32, depth: 3 };

export function cellCount(size: WorldSize): number {
  return size.width * size.height * size.depth;
}

export function idx(size: WorldSize, x: number, y: number, z: number): number {
  return x + size.width * (y + size.height * z);
}

/** B/S — наборы чисел живых соседей 0..10, при которых клетка рождается/выживает. */
export interface Rules {
  birth: number[];
  survive: number[];
  /** Межслойная связь: учитывать (x,y,z-1) и (x,y,z+1). */
  coupling: boolean;
}

export const DEFAULT_RULES: Rules = { birth: [3], survive: [2, 3], coupling: true };

export const MIN_NEIGHBOR_COUNT = 0;
export const MAX_NEIGHBOR_COUNT = 10;

function maskOf(values: number[]): Uint8Array {
  const mask = new Uint8Array(MAX_NEIGHBOR_COUNT + 1);
  for (const v of values) {
    if (v >= MIN_NEIGHBOR_COUNT && v <= MAX_NEIGHBOR_COUNT) mask[v] = 1;
  }
  return mask;
}

/**
 * Синхронный переход: всё следующее поколение вычисляется по неизменному
 * input; результат пишется в output (другой буфер). input не мутирует.
 */
export function stepCells(
  size: WorldSize,
  rules: Rules,
  input: Uint8Array,
  output: Uint8Array,
): void {
  const { width, height, depth } = size;
  const birth = maskOf(rules.birth);
  const survive = maskOf(rules.survive);

  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const here = idx(size, x, y, z);
        let n = 0;

        // 8 внутрислойных соседей; за границами поля — пустота (0), без зацикливания.
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            n += input[idx(size, xx, yy, z)];
          }
        }

        // Межслойные соседи: только вертикально (x,y,z±1). Диагонали других
        // слоёв не считаются; слои 0 и 2 напрямую не соединены.
        if (rules.coupling) {
          if (z > 0) n += input[idx(size, x, y, z - 1)];
          if (z < depth - 1) n += input[idx(size, x, y, z + 1)];
        }

        output[here] = input[here] === 1 ? survive[n] : birth[n];
      }
    }
  }
}

export interface LiveCounts {
  total: number;
  perLayer: number[];
}

export class World {
  readonly size: WorldSize;
  /** Клетки текущего поколения: 0/1. */
  cells: Uint8Array;
  generation = 0;
  private scratch: Uint8Array;

  constructor(size: WorldSize, cells?: Uint8Array) {
    const n = cellCount(size);
    if (cells && cells.length !== n) {
      throw new RangeError(`cells.length=${cells.length}, ожидалось ${n}`);
    }
    this.size = { ...size };
    this.cells = cells ? Uint8Array.from(cells) : new Uint8Array(n);
    this.scratch = new Uint8Array(n);
  }

  get(x: number, y: number, z: number): number {
    return this.cells[idx(this.size, x, y, z)];
  }

  set(x: number, y: number, z: number, value: 0 | 1): void {
    this.cells[idx(this.size, x, y, z)] = value;
  }

  /** Живые соседи клетки (x,y,z) по текущим правилам связи. Собственная клетка не считается. */
  neighborCount(x: number, y: number, z: number, coupling: boolean): number {
    const { width, height, depth } = this.size;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
        n += this.cells[idx(this.size, xx, yy, z)];
      }
    }
    if (coupling) {
      if (z > 0) n += this.cells[idx(this.size, x, y, z - 1)];
      if (z < depth - 1) n += this.cells[idx(this.size, x, y, z + 1)];
    }
    return n;
  }

  /** Один синхронный шаг; использует два буфера, increment поколения. */
  step(rules: Rules): void {
    stepCells(this.size, rules, this.cells, this.scratch);
    const t = this.cells;
    this.cells = this.scratch;
    this.scratch = t;
    this.generation += 1;
  }

  setCells(source: Uint8Array): void {
    if (source.length !== this.cells.length) {
      throw new RangeError(`source.length=${source.length}, ожидалось ${this.cells.length}`);
    }
    this.cells.set(source);
  }

  clear(): void {
    this.cells.fill(0);
    this.generation = 0;
  }

  cloneCells(): Uint8Array {
    return Uint8Array.from(this.cells);
  }

  liveCounts(): LiveCounts {
    const { width, height, depth } = this.size;
    const perLayer = new Array<number>(depth).fill(0);
    let total = 0;
    const stride = width * height;
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] === 1) {
        total += 1;
        perLayer[Math.floor(i / stride)] += 1;
      }
    }
    return { total, perLayer };
  }
}
