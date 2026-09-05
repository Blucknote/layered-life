/**
 * Экспорт/импорт эксперимента в JSON.
 *
 * Формат (formatVersion = 1):
 * {
 *   "formatVersion": 1,
 *   "width": 32, "height": 32, "depth": 3,
 *   "generation": 12,
 *   "rules": { "birth": [3], "survive": [2, 3], "coupling": true },
 *   "speed": 5,          // поколений/с, целое 1..30
 *   "seed": 42,          // целое 0..4294967295 (uint32)
 *   "density": 15,       // проценты, целое 0..100
 *   "cells": [0,1,...],  // текущее поле, длина width*height*depth
 *   "start": [0,1,...]   // сохранённое стартовое поле, тот же формат
 * }
 *
 * Порядок координат массива: плоский массив, индекс = x + width * (y + height * z);
 * x меняется быстрее всего, затем y, затем z. Значения клеток: 0 или 1.
 */

import { cellCount, DEFAULT_SIZE, type Rules, type WorldSize } from './world.ts';

export const FORMAT_VERSION = 1;
export const MAX_IMPORT_BYTES = 1024 * 1024; // 1 МБ

export interface ExperimentState {
  size: WorldSize;
  generation: number;
  rules: Rules;
  speed: number;
  seed: number;
  density: number;
  cells: Uint8Array;
  start: Uint8Array;
}

export function serializeExperiment(state: ExperimentState): string {
  const payload = {
    formatVersion: FORMAT_VERSION,
    width: state.size.width,
    height: state.size.height,
    depth: state.size.depth,
    generation: state.generation,
    rules: {
      birth: [...state.rules.birth].sort((a, b) => a - b),
      survive: [...state.rules.survive].sort((a, b) => a - b),
      coupling: state.rules.coupling,
    },
    speed: state.speed,
    seed: state.seed,
    density: state.density,
    cells: Array.from(state.cells),
    start: Array.from(state.start),
  };
  return JSON.stringify(payload);
}

class ImportError extends Error {}

function fail(message: string): never {
  throw new ImportError(message);
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('Корень JSON должен быть объектом.');
  }
  return value as Record<string, unknown>;
}

function asInteger(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(`Поле «${name}» должно быть целым числом.`);
  }
  if (value < min || value > max) {
    fail(`Поле «${name}» должно быть в диапазоне ${min}..${max}, получено ${value}.`);
  }
  return value;
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') fail(`Поле «${name}» должно быть true/false.`);
  return value;
}

function asCells(value: unknown, name: string, expected: number): Uint8Array {
  if (!Array.isArray(value)) fail(`Поле «${name}» должно быть массивом чисел.`);
  if (value.length !== expected) {
    fail(`Поле «${name}» должно содержать ровно ${expected} значений, получено ${value.length}.`);
  }
  const cells = new Uint8Array(expected);
  for (let i = 0; i < expected; i++) {
    const v = value[i];
    if (v !== 0 && v !== 1) {
      fail(`Поле «${name}»: значение №${i} равно ${JSON.stringify(v)}, допускаются только 0 и 1.`);
    }
    cells[i] = v;
  }
  return cells;
}

function asNeighborSet(value: unknown, name: string): number[] {
  if (!Array.isArray(value)) fail(`Правило «${name}» должно быть массивом чисел 0..10.`);
  const seen = new Set<number>();
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10) {
      fail(`Правило «${name}»: допустимы только целые числа 0..10, получено ${JSON.stringify(v)}.`);
    }
    if (seen.has(v)) fail(`Правило «${name}»: значение ${v} повторяется.`);
    seen.add(v);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Разбор и полная проверка JSON эксперимента.
 * Бросает Error с человекочитаемым сообщением при любой некорректности;
 * текущий мир при этом не меняется (вызывающий применяет результат только
 * при успешном разборе).
 */
export function parseExperiment(text: string): ExperimentState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('Файл не является корректным JSON.');
  }
  const obj = asObject(raw);

  const version = obj['formatVersion'];
  if (version !== FORMAT_VERSION) {
    fail(
      `Неподдерживаемая версия формата: ${JSON.stringify(version)}, ожидается ${FORMAT_VERSION}.`,
    );
  }

  // MVP фиксирует размер поля; другие размеры отклоняются явно.
  const width = asInteger(obj['width'], 'width', 0, 4096);
  const height = asInteger(obj['height'], 'height', 0, 4096);
  const depth = asInteger(obj['depth'], 'depth', 0, 64);
  if (width !== DEFAULT_SIZE.width || height !== DEFAULT_SIZE.height || depth !== DEFAULT_SIZE.depth) {
    fail(
      `MVP поддерживает только размер поля ${DEFAULT_SIZE.width} × ${DEFAULT_SIZE.height} × ${DEFAULT_SIZE.depth}, ` +
        `получено ${width} × ${height} × ${depth}.`,
    );
  }
  const size = { ...DEFAULT_SIZE };
  const expected = cellCount(size);

  const rulesObj = asObject(obj['rules'] ?? fail('Отсутствует объект «rules».'));
  const rules: Rules = {
    birth: asNeighborSet(rulesObj['birth'] ?? fail('Отсутствует правило «birth».'), 'birth'),
    survive: asNeighborSet(rulesObj['survive'] ?? fail('Отсутствует правило «survive».'), 'survive'),
    coupling: asBoolean(rulesObj['coupling'] ?? fail('Отсутствует поле «rules.coupling».'), 'rules.coupling'),
  };

  return {
    size,
    generation: asInteger(obj['generation'] ?? fail('Отсутствует поле «generation».'), 'generation', 0, Number.MAX_SAFE_INTEGER),
    rules,
    speed: asInteger(obj['speed'] ?? fail('Отсутствует поле «speed».'), 'speed', 1, 30),
    seed: asInteger(obj['seed'] ?? fail('Отсутствует поле «seed».'), 'seed', 0, 4294967295),
    density: asInteger(obj['density'] ?? fail('Отсутствует поле «density».'), 'density', 0, 100),
    cells: asCells(obj['cells'] ?? fail('Отсутствует поле «cells».'), 'cells', expected),
    start: asCells(obj['start'] ?? fail('Отсутствует поле «start».'), 'start', expected),
  };
}
