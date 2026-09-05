import { describe, expect, it } from 'vitest';
import {
  cellCount,
  DEFAULT_RULES,
  DEFAULT_SIZE,
  idx,
  stepCells,
  World,
  type Rules,
} from '../src/core/world.ts';
import { mulberry32, randomFill } from '../src/core/prng.ts';
import { parseExperiment, serializeExperiment } from '../src/core/serialization.ts';

const SIZE = DEFAULT_SIZE;

function emptyWorld(): World {
  return new World(SIZE);
}

function setCells(world: World, points: Array<[number, number, number]>): void {
  for (const [x, y, z] of points) world.set(x, y, z, 1);
}

function rulesOf(overrides: Partial<Rules>): Rules {
  return { ...DEFAULT_RULES, ...overrides };
}

/** Полное сравнение поля с ожиданием по списку живых клеток. */
function expectAlive(world: World, points: Array<[number, number, number]>): void {
  const expected = new World(SIZE);
  setCells(expected, points);
  expect(Array.from(world.cells)).toEqual(Array.from(expected.cells));
}

describe('Приёмка 1: три независимые «Жизни» при выключенной связи', () => {
  const rules = rulesOf({ coupling: false });

  it('блок 2 × 2 внутри слоя стабилен', () => {
    const world = emptyWorld();
    setCells(world, [[14, 14, 1], [15, 14, 1], [14, 15, 1], [15, 15, 1]]);
    world.step(rules);
    expectAlive(world, [[14, 14, 1], [15, 14, 1], [14, 15, 1], [15, 15, 1]]);
    world.step(rules);
    expectAlive(world, [[14, 14, 1], [15, 14, 1], [14, 15, 1], [15, 15, 1]]);
  });

  it('трёхклеточный блинкер возвращается через два шага', () => {
    const world = emptyWorld();
    setCells(world, [[9, 10, 0], [10, 10, 0], [11, 10, 0]]);
    world.step(rules);
    expectAlive(world, [[10, 9, 0], [10, 10, 0], [10, 11, 0]]);
    world.step(rules);
    expectAlive(world, [[9, 10, 0], [10, 10, 0], [11, 10, 0]]);
  });

  it('остальные слои остаются пустыми', () => {
    const world = emptyWorld();
    setCells(world, [
      [9, 10, 0], [10, 10, 0], [11, 10, 0], // блинкер, слой 0
      [14, 14, 1], [15, 14, 1], [14, 15, 1], [15, 15, 1], // блок, слой 1
    ]);
    for (let i = 0; i < 8; i++) world.step(rules);
    for (let y = 0; y < SIZE.height; y++) {
      for (let x = 0; x < SIZE.width; x++) {
        expect(world.get(x, y, 2)).toBe(0);
      }
    }
    // Слой 0 содержит только блинкер, слой 1 — только блок.
    const live = world.liveCounts();
    expect(live.total).toBe(7);
    expect(live.perLayer).toEqual([3, 4, 0]);
  });
});

describe('Приёмка 2: межслойное рождение', () => {
  const points: Array<[number, number, number]> = [[9, 10, 1], [11, 10, 1], [10, 10, 0]];

  it('клетка (10,10,1) рождается при включённой связи', () => {
    const world = emptyWorld();
    setCells(world, points);
    world.step(rulesOf({ coupling: true }));
    expect(world.get(10, 10, 1)).toBe(1);
  });

  it('клетка (10,10,1) остаётся мёртвой при отключённой связи', () => {
    const world = emptyWorld();
    setCells(world, points);
    world.step(rulesOf({ coupling: false }));
    expect(world.get(10, 10, 1)).toBe(0);
  });
});

describe('Приёмка 3: соседство', () => {
  it('собственная клетка не считается соседом', () => {
    // Если бы клетка считала себя, у неё было бы n=1 и S={1} её бы сохранил.
    const world = emptyWorld();
    world.set(10, 10, 1, 1);
    world.step(rulesOf({ birth: [], survive: [1] }));
    expect(world.get(10, 10, 1)).toBe(0);
  });

  it('вертикальные межслойные соседи считаются', () => {
    const world = emptyWorld();
    world.set(10, 10, 0, 1);
    world.step(rulesOf({ birth: [1], survive: [] }));
    expect(world.get(10, 10, 1)).toBe(1);
  });

  it('диагонали других слоёв не считаются', () => {
    // Четыре диагональных сосежи слоя 0 не дают клетке (10,10,1) n=4.
    const world = emptyWorld();
    setCells(world, [[9, 9, 0], [11, 11, 0], [9, 11, 0], [11, 9, 0]]);
    world.step(rulesOf({ birth: [4], survive: [] }));
    expect(world.get(10, 10, 1)).toBe(0);
  });

  it('границы поля не зациклены по x', () => {
    // При зацикливании (0,0,0) и (31,0,0) были бы соседями и выжили бы при S={1}.
    const world = emptyWorld();
    setCells(world, [[0, 0, 0], [31, 0, 0]]);
    world.step(rulesOf({ birth: [], survive: [1] }));
    expect(world.get(0, 0, 0)).toBe(0);
    expect(world.get(31, 0, 0)).toBe(0);
  });

  it('слои 0 и 2 не соединены напрямую и нет зацикливания по z', () => {
    const world = emptyWorld();
    setCells(world, [[10, 10, 0], [10, 10, 2]]);
    world.step(rulesOf({ coupling: true, birth: [], survive: [1] }));
    expect(world.get(10, 10, 0)).toBe(0);
    expect(world.get(10, 10, 2)).toBe(0);
  });

  it('максимум соседей: 10 у среднего слоя, 9 у крайних; на границах поля меньше', () => {
    const world = emptyWorld();
    for (let z = 0; z < SIZE.depth; z++) {
      for (let y = 0; y < SIZE.height; y++) {
        for (let x = 0; x < SIZE.width; x++) world.set(x, y, z, 1);
      }
    }
    // Максимумы при включённой связи.
    expect(world.neighborCount(10, 10, 1, true)).toBe(10);
    expect(world.neighborCount(10, 10, 0, true)).toBe(9);
    // Угол поля: 3 внутрислойных; у среднего слоя ещё 2 вертикальных, у крайнего 1.
    expect(world.neighborCount(0, 0, 1, true)).toBe(5);
    expect(world.neighborCount(0, 0, 0, true)).toBe(4);
    // Без связи: только внутрислойные.
    expect(world.neighborCount(10, 10, 1, false)).toBe(8);
    expect(world.neighborCount(0, 0, 1, false)).toBe(3);
  });
});

describe('Приёмка 4: синхронное обновление без мутации входа', () => {
  it('шаг не пишет в буфер входа и результат совпадает с синхронным расчётом', () => {
    const world = emptyWorld();
    setCells(world, [[9, 10, 0], [10, 10, 0], [11, 10, 0]]);
    const input = world.cells;
    const snapshot = Uint8Array.from(input);

    world.step(DEFAULT_RULES);

    // Тот же буфер-объект по-прежнему хранит прежнее поколение (два буфера).
    expect(Array.from(input)).toEqual(Array.from(snapshot));
    // Результат — независимый расчёт по снимку: ожидаемый вертикальный блинкер.
    const scratch = new Uint8Array(cellCount(SIZE));
    stepCells(SIZE, DEFAULT_RULES, snapshot, scratch);
    expect(Array.from(world.cells)).toEqual(Array.from(scratch));
    expectAlive(world, [[10, 9, 0], [10, 10, 0], [10, 11, 0]]);
    expect(world.generation).toBe(1);
  });
});

describe('Приёмка 5: изменённые правила, seed, JSON', () => {
  it('B={0}: все мёртвые клетки рождаются при n=0', () => {
    const world = emptyWorld();
    world.step(rulesOf({ birth: [0], survive: [] }));
    expect(world.liveCounts().total).toBe(cellCount(SIZE));
  });

  it('S={0}: живая одиночная клетка выживает при n=0', () => {
    const world = emptyWorld();
    world.set(10, 10, 1, 1);
    world.step(rulesOf({ birth: [], survive: [0] }));
    expect(world.get(10, 10, 1)).toBe(1);
  });

  it('B={10}: рождение при ровно 10 соседях', () => {
    const world = emptyWorld();
    for (let y = 0; y < SIZE.height; y++) {
      for (let x = 0; x < SIZE.width; x++) {
        if (!(x === 10 && y === 10)) world.set(x, y, 1, 1);
      }
    }
    world.set(10, 10, 0, 1);
    world.set(10, 10, 2, 1);
    world.step(rulesOf({ birth: [10], survive: [] }));
    expect(world.liveCounts().total).toBe(1);
    expect(world.get(10, 10, 1)).toBe(1);
  });

  it('mulberry32 детерминирован и воспроизводим', () => {
    // Зафиксированные значения алгоритма (см. README).
    const a = mulberry32(42);
    expect(a()).toBeCloseTo(0.6011037519, 10);
    expect(a()).toBeCloseTo(0.448290559, 10);
    expect(mulberry32(0)()).toBeCloseTo(0.2664292087, 10);

    const first = randomFill(SIZE, 123, 40);
    const second = randomFill(SIZE, 123, 40);
    expect(Array.from(first)).toEqual(Array.from(second));

    const otherSeed = randomFill(SIZE, 124, 40);
    expect(Array.from(otherSeed)).not.toEqual(Array.from(first));

    expect(randomFill(SIZE, 7, 0).some((v) => v === 1)).toBe(false);
    expect(randomFill(SIZE, 7, 100).every((v) => v === 1)).toBe(true);
  });

  it('JSON проходит round-trip и сохраняет последующее поведение', () => {
    const world = new World(SIZE, randomFill(SIZE, 42, 15));
    const state = {
      size: world.size,
      generation: world.generation,
      rules: { ...DEFAULT_RULES },
      speed: 7,
      seed: 42,
      density: 15,
      cells: world.cloneCells(),
      start: world.cloneCells(),
    };
    const restored = parseExperiment(serializeExperiment(state));
    expect(Array.from(restored.cells)).toEqual(Array.from(state.cells));
    expect(Array.from(restored.start)).toEqual(Array.from(state.start));
    expect(restored.generation).toBe(0);
    expect(restored.rules).toEqual(DEFAULT_RULES);
    expect(restored.speed).toBe(7);

    // Одинаковые правила → одинаковое поведение после импорта.
    const a = new World(SIZE, state.cells);
    const b = new World(restored.size, restored.cells);
    for (let i = 0; i < 10; i++) {
      a.step(DEFAULT_RULES);
      b.step(restored.rules);
    }
    expect(Array.from(b.cells)).toEqual(Array.from(a.cells));
    expect(b.generation).toBe(a.generation);
  });

  const good = JSON.parse(
    serializeExperiment({
      size: SIZE,
      generation: 3,
      rules: { birth: [3], survive: [2, 3], coupling: true },
      speed: 5,
      seed: 42,
      density: 15,
      cells: new Uint8Array(cellCount(SIZE)),
      start: new Uint8Array(cellCount(SIZE)),
    }),
  );

  it.each([
    ['не JSON', 'это не json'],
    ['version не 1', { ...good, formatVersion: 2 }],
    ['неверный размер поля', { ...good, width: 16 }],
    ['cells короче', { ...good, cells: good.cells.slice(0, cellCount(SIZE) - 1) }],
    ['клетка не 0/1', { ...good, cells: [...good.cells.slice(0, -1), 2] }],
    ['B вне 0..10', { ...good, rules: { ...good.rules, birth: [11] } }],
    ['B с дубликатом', { ...good, rules: { ...good.rules, birth: [3, 3] } }],
    ['S не массив', { ...good, rules: { ...good.rules, survive: '23' } }],
    ['coupling не boolean', { ...good, rules: { ...good.rules, coupling: 'да' } }],
    ['speed вне 1..30', { ...good, speed: 31 }],
    ['seed отрицательный', { ...good, seed: -1 }],
    ['density вне 0..100', { ...good, density: 101 }],
    ['поколение не целое', { ...good, generation: 1.5 }],
    ['нет поля start', Object.fromEntries(Object.entries(good).filter(([k]) => k !== 'start'))],
  ])('отклоняется: %s', (_name, bad) => {
    expect(() => parseExperiment(JSON.stringify(bad))).toThrow(Error);
  });

  it('сообщения об ошибках человекочитаемые', () => {
    expect(() => parseExperiment('{')).toThrow(/JSON/);
    expect(() => parseExperiment(JSON.stringify({ ...good, speed: 31 }))).toThrow(/speed/);
  });
});
