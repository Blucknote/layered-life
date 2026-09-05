/**
 * Слой приложения: связывает ядро симуляции, Three.js-рендер и DOM-панель.
 * Ядро (src/core) не знает ни о DOM, ни о Three.js.
 */

import { DEFAULT_RULES, DEFAULT_SIZE, World, type Rules } from './core/world.ts';
import { randomFill } from './core/prng.ts';
import {
  MAX_IMPORT_BYTES,
  parseExperiment,
  serializeExperiment,
  type ExperimentState,
} from './core/serialization.ts';
import { LAYER_COLORS, LifeRenderer, webglAvailable } from './render/renderer.ts';

const SEED_MIN = 0;
const SEED_MAX = 4294967295;
const MAX_CATCHUP_STEPS = 5;
const DEFAULT_SEED = 42;
const DEFAULT_DENSITY = 15;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Нет элемента #${id}`);
  return el as T;
}

const canvas = byId<HTMLCanvasElement>('scene');

if (!webglAvailable()) {
  byId<HTMLDivElement>('webgl-error').hidden = false;
  canvas.style.display = 'none';
} else {
  startApp();
}

function startApp(): void {
  // --- Состояние приложения -------------------------------------------------
  const world = new World(DEFAULT_SIZE, randomFill(DEFAULT_SIZE, DEFAULT_SEED, DEFAULT_DENSITY));
  let savedStart = world.cloneCells(); // начальная демонстрационная конфигурация — сохранённый старт
  let running = false;
  let speed = 5;
  let seed = DEFAULT_SEED;
  let density = DEFAULT_DENSITY;
  let activeLayer = 1;
  let tool: 'camera' | 'add' | 'remove' = 'camera';
  const rules: Rules = {
    birth: [...DEFAULT_RULES.birth],
    survive: [...DEFAULT_RULES.survive],
    coupling: true,
  };

  const renderer = new LifeRenderer(canvas, DEFAULT_SIZE, 2.5);
  renderer.update(world);

  // --- Элементы панели ------------------------------------------------------
  const toggleRunBtn = byId<HTMLButtonElement>('toggle-run');
  const stepBtn = byId<HTMLButtonElement>('step');
  const speedInput = byId<HTMLInputElement>('speed');
  const speedValue = byId<HTMLOutputElement>('speed-value');
  const genValue = byId<HTMLElement>('gen-value');
  const liveTotal = byId<HTMLElement>('live-total');
  const liveLayers = byId<HTMLElement>('live-layers');
  const densityInput = byId<HTMLInputElement>('density');
  const seedInput = byId<HTMLInputElement>('seed');
  const randomBtn = byId<HTMLButtonElement>('random');
  const clearBtn = byId<HTMLButtonElement>('clear');
  const birthToggles = byId<HTMLDivElement>('birth-toggles');
  const surviveToggles = byId<HTMLDivElement>('survive-toggles');
  const couplingInput = byId<HTMLInputElement>('coupling');
  const resetRulesBtn = byId<HTMLButtonElement>('reset-rules');
  const rememberStartBtn = byId<HTMLButtonElement>('remember-start');
  const restoreStartBtn = byId<HTMLButtonElement>('restore-start');
  const gapInput = byId<HTMLInputElement>('gap');
  const gapValue = byId<HTMLOutputElement>('gap-value');
  const resetCameraBtn = byId<HTMLButtonElement>('reset-camera');
  const exportBtn = byId<HTMLButtonElement>('export');
  const importInput = byId<HTMLInputElement>('import');
  const statusEl = byId<HTMLDivElement>('status');
  const layerRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="layer"]')];
  const toolRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="tool"]')];
  const visibilityInputs = [0, 1, 2].map((z) => byId<HTMLInputElement>(`vis-${z}`));

  // Чипы легенды в цвет слоёв сцены.
  for (const chip of document.querySelectorAll<HTMLElement>('.chip[data-layer]')) {
    const z = Number(chip.dataset['layer']);
    chip.style.background = `#${LAYER_COLORS[z].toString(16).padStart(6, '0')}`;
  }

  function setStatus(message: string, isError = false): void {
    statusEl.textContent = message;
    statusEl.classList.toggle('error', isError);
  }

  // --- Переключатели B/S 0..10 ----------------------------------------------
  function buildToggleRow(container: HTMLElement, checked: number[]): void {
    for (let n = 0; n <= 10; n++) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = String(n);
      input.checked = checked.includes(n);
      label.appendChild(input);
      label.appendChild(document.createTextNode(String(n)));
      container.appendChild(label);
    }
  }

  function readToggleRow(container: HTMLElement): number[] {
    return [...container.querySelectorAll<HTMLInputElement>('input:checked')].map(
      (input) => Number(input.value),
    );
  }

  function syncToggleRow(container: HTMLElement, values: number[]): void {
    for (const input of container.querySelectorAll<HTMLInputElement>('input')) {
      input.checked = values.includes(Number(input.value));
    }
  }

  buildToggleRow(birthToggles, rules.birth);
  buildToggleRow(surviveToggles, rules.survive);

  // --- Отображение состояния --------------------------------------------------
  function refreshStats(): void {
    const { total, perLayer } = world.liveCounts();
    genValue.textContent = String(world.generation);
    liveTotal.textContent = String(total);
    liveLayers.textContent = `по этажам: ${perLayer
      .map((count, z) => `${z + 1}: ${count}`)
      .join(' · ')}`;
  }

  function refreshRunButton(): void {
    toggleRunBtn.textContent = running ? 'Пауза' : 'Старт';
  }

  function setRunning(value: boolean): void {
    running = value;
    refreshRunButton();
  }

  function applyWorldChange(): void {
    renderer.update(world);
    refreshStats();
  }

  // --- Управление симуляцией ---------------------------------------------------
  toggleRunBtn.addEventListener('click', () => setRunning(!running));

  stepBtn.addEventListener('click', () => {
    setRunning(false);
    world.step(rules);
    applyWorldChange();
  });

  speedInput.addEventListener('input', () => {
    speed = clampInt(speedInput.value, 1, 30, 5);
    speedInput.value = String(speed);
    speedValue.textContent = String(speed);
  });

  // --- Редактирование ----------------------------------------------------------
  function selectLayer(z: number): void {
    activeLayer = z;
    layerRadios.forEach((radio) => (radio.checked = Number(radio.value) === z));
    if (!visibilityInputs[z].checked) {
      visibilityInputs[z].checked = true; // при выборе скрытого слоя сделать его видимым
      renderer.setLayerVisible(z, true);
    }
    renderer.setActiveLayer(z);
    renderer.setHover(null, z);
  }

  for (const radio of layerRadios) {
    radio.addEventListener('change', () => {
      if (radio.checked) selectLayer(Number(radio.value));
    });
  }

  function selectTool(next: 'camera' | 'add' | 'remove'): void {
    tool = next;
    toolRadios.forEach((radio) => (radio.checked = radio.value === next));
    renderer.setEditRotationEnabled(next === 'camera');
    if (next === 'camera') renderer.setHover(null, activeLayer);
  }

  for (const radio of toolRadios) {
    radio.addEventListener('change', () => {
      if (radio.checked) selectTool(radio.value as 'camera' | 'add' | 'remove');
    });
  }

  canvas.addEventListener('pointermove', (event) => {
    if (tool === 'camera') return;
    renderer.setHover(renderer.pick(event.clientX, event.clientY, activeLayer), activeLayer);
  });

  canvas.addEventListener('pointerleave', () => renderer.setHover(null, activeLayer));

  canvas.addEventListener('pointerdown', (event) => {
    if (tool === 'camera' || event.button !== 0) return;
    const hit = renderer.pick(event.clientX, event.clientY, activeLayer);
    if (!hit) return; // за пределами поля действие игнорируется
    setRunning(false); // начало редактирования ставит симуляцию на паузу
    world.set(hit.x, hit.y, activeLayer, tool === 'add' ? 1 : 0);
    applyWorldChange();
  });

  randomBtn.addEventListener('click', () => {
    density = clampInt(densityInput.value, 0, 100, DEFAULT_DENSITY);
    seed = clampInt(seedInput.value, SEED_MIN, SEED_MAX, DEFAULT_SEED);
    densityInput.value = String(density);
    seedInput.value = String(seed);
    world.setCells(randomFill(DEFAULT_SIZE, seed, density));
    world.generation = 0;
    savedStart = world.cloneCells();
    setRunning(false);
    applyWorldChange();
    setStatus(`Случайное заполнение: seed=${seed}, плотность=${density}%. Старт обновлён.`);
  });

  clearBtn.addEventListener('click', () => {
    world.clear();
    savedStart = world.cloneCells();
    setRunning(false);
    applyWorldChange();
    setStatus('Все слои очищены. Старт обновлён.');
  });

  // --- Правила ------------------------------------------------------------------
  birthToggles.addEventListener('change', () => {
    rules.birth = readToggleRow(birthToggles);
    setRunning(false);
    setStatus(`Правило B = {${rules.birth.join(', ')}}. Пауза; поле и поколение сохранены.`);
  });

  surviveToggles.addEventListener('change', () => {
    rules.survive = readToggleRow(surviveToggles);
    setRunning(false);
    setStatus(`Правило S = {${rules.survive.join(', ')}}. Пауза; поле и поколение сохранены.`);
  });

  couplingInput.addEventListener('change', () => {
    rules.coupling = couplingInput.checked;
    setRunning(false);
    setStatus(
      rules.coupling
        ? 'Межслойная связь включена. Пауза; поле и поколение сохранены.'
        : 'Межслойная связь выключена: три независимых слоя. Пауза; поле и поколение сохранены.',
    );
  });

  resetRulesBtn.addEventListener('click', () => {
    rules.birth = [...DEFAULT_RULES.birth];
    rules.survive = [...DEFAULT_RULES.survive];
    syncToggleRow(birthToggles, rules.birth);
    syncToggleRow(surviveToggles, rules.survive);
    setRunning(false);
    setStatus('Правила сброшены к B={3}, S={2,3}. Пауза; поле и поколение сохранены.');
  });

  // --- Старт ---------------------------------------------------------------------
  rememberStartBtn.addEventListener('click', () => {
    savedStart = world.cloneCells();
    world.generation = 0;
    refreshStats();
    setStatus('Текущее поле запомнено как старт; поколение сброшено.');
  });

  restoreStartBtn.addEventListener('click', () => {
    world.setCells(savedStart);
    world.generation = 0;
    applyWorldChange();
    setStatus('Старт восстановлен; текущие B/S и связь сохранены.');
  });

  // --- Вид -------------------------------------------------------------------------
  visibilityInputs.forEach((input, z) => {
    input.addEventListener('change', () => renderer.setLayerVisible(z, input.checked));
  });

  gapInput.addEventListener('input', () => {
    const gap = clampFloat(gapInput.value, 1, 6, 2.5);
    gapInput.value = String(gap);
    gapValue.textContent = gap.toFixed(1);
    renderer.setGap(gap); // только визуальное раздвижение
  });

  resetCameraBtn.addEventListener('click', () => renderer.resetView());

  // --- Экспорт / импорт --------------------------------------------------------------
  function currentState(): ExperimentState {
    return {
      size: DEFAULT_SIZE,
      generation: world.generation,
      rules: { birth: [...rules.birth], survive: [...rules.survive], coupling: rules.coupling },
      speed,
      seed,
      density,
      cells: world.cloneCells(),
      start: Uint8Array.from(savedStart),
    };
  }

  function syncUiFromState(state: ExperimentState): void {
    speed = state.speed;
    speedInput.value = String(state.speed);
    speedValue.textContent = String(state.speed);
    seed = state.seed;
    seedInput.value = String(state.seed);
    density = state.density;
    densityInput.value = String(state.density);
    rules.birth = [...state.rules.birth];
    rules.survive = [...state.rules.survive];
    rules.coupling = state.rules.coupling;
    syncToggleRow(birthToggles, rules.birth);
    syncToggleRow(surviveToggles, rules.survive);
    couplingInput.checked = rules.coupling;
    applyWorldChange();
  }

  exportBtn.addEventListener('click', () => {
    const blob = new Blob([serializeExperiment(currentState())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'layered-life.json';
    link.click();
    URL.revokeObjectURL(url);
    setStatus('Эксперимент выгружен в layered-life.json.');
  });

  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setStatus(`Импорт отклонён: файл ${(file.size / 1024 / 1024).toFixed(2)} МБ превышает 1 МБ.`, true);
      return;
    }
    void file
      .text()
      .then((text) => {
        let parsed: ExperimentState;
        try {
          parsed = parseExperiment(text);
        } catch (error) {
          setStatus(`Импорт отклонён: ${error instanceof Error ? error.message : String(error)}`, true);
          return;
        }
        world.setCells(parsed.cells);
        world.generation = parsed.generation;
        savedStart = Uint8Array.from(parsed.start);
        setRunning(false);
        syncUiFromState(parsed);
        setStatus('Эксперимент импортирован. Симуляция на паузе.');
      })
      .catch((error: unknown) => {
        setStatus(`Импорт не выполнен: ${error instanceof Error ? error.message : String(error)}`, true);
      });
  });

  // --- Горячие клавиши ---------------------------------------------------------------
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)
    ) {
      return; // не перехватывать клавиши при вводе в поля формы
    }
    if (event.code === 'Space') {
      event.preventDefault();
      setRunning(!running);
    } else if (event.code === 'KeyN') {
      setRunning(false);
      world.step(rules);
      applyWorldChange();
    } else if (event.code === 'Digit1') {
      selectLayer(0);
    } else if (event.code === 'Digit2') {
      selectLayer(1);
    } else if (event.code === 'Digit3') {
      selectLayer(2);
    }
  });

  // --- Цикл: скорость симуляции отделена от FPS накопителем времени --------------------
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setRunning(false);
  });

  let lastFrame = performance.now();
  let accumulator = 0;

  function frame(now: number): void {
    requestAnimationFrame(frame);
    // Clamp: при возврате со скрытой вкладки накопившееся время не доигрывается.
    const elapsedSeconds = Math.min(now - lastFrame, 250) / 1000;
    lastFrame = now;

    if (running) {
      accumulator += elapsedSeconds;
      const interval = 1 / speed;
      let steps = 0;
      while (accumulator >= interval && steps < MAX_CATCHUP_STEPS) {
        world.step(rules);
        accumulator -= interval;
        steps++;
      }
      if (accumulator > interval * MAX_CATCHUP_STEPS) accumulator = 0;
      if (steps > 0) applyWorldChange();
    }

    renderer.render(); // камера работает и на паузе
  }

  setRunning(false);
  selectLayer(1);
  selectTool('camera');
  refreshStats();
  requestAnimationFrame(frame);
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const value = Math.trunc(Number(raw));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clampFloat(raw: string, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
