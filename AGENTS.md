# Guidance for coding agents

Инструкции для агентов (Claude/Codex/Copilot/локальные LLM), которые вносят
изменения в этот репозиторий.

## Команды

```bash
npm ci          # установка по lock-файлу
npm test        # unit-тесты ядра (vitest, environment: node — без браузера)
npm run build   # tsc --noEmit + vite build (строгая проверка типов)
npm run dev     # http://localhost:5173
```

Проверка готовности изменения = `npm test` и `npm run build` зелёные.
UI-проверки делаются вручную в браузере; браузерной автоматизации в CI нет.

## Архитектура (не нарушать границы)

```text
src/core/world.ts          ядро: состояние, соседство, step. Без DOM и Three.js.
src/core/prng.ts           mulberry32 + randomFill (детерминированность!)
src/core/serialization.ts  JSON formatVersion=1 + валидация импорта
src/render/renderer.ts     Three.js: InstancedMesh на слой, камера, hover
src/main.ts                вся связка DOM ↔ ядро ↔ рендер
tests/simulation.test.ts   приёмочные тесты ядра (см. layered-life-spec.md §9)
```

- Ядро (`src/core`) не импортирует DOM и Three.js — это инвариант, тесты
  гоняются в node-среде.
- Формула индекса поля: `x + width * (y + height * z)`, состояние `Uint8Array`.
- Соседство: 8 внутрислойных + (при связи) строго вертикальные `(x,y,z±1)`;
  без wrap; слои 0 и 2 не соседствуют; максимум соседей 10 (средний слой).
- Шаг — синхронный, два буфера; входной массив не мутируется.

## Стабилизирующие контракты (ломать нельзя без причины)

- `mulberry32` и порядок обхода ячеек в `randomFill` зафиксированы тестами:
  смена алгоритма молча ломает воспроизводимость старых seed — если меняете,
  поднимите `formatVersion` и обновите зафиксированные значения в тестах.
- JSON-формат: `formatVersion`, размеры 32×32×3, длины массивов 3072,
  значения 0/1, B/S ⊂ 0..10, speed 1..30, seed 0..2^32−1, импорт ≤ 1 МБ.
  Несовместимое изменение формата — только с повышением `formatVersion` и
  проверкой старых файлов.
- GitHub Pages полагается на `base: './'` в `vite.config.ts` — абсолютные
  пути сломают живую страницу.

## Стиль

- TypeScript strict, комментарии на русском там, где они объясняют «почему».
- Не добавлять зависимости без нужды; симуляция остаётся на CPU (WebGL —
  только отрисовка).
- Тесты: каждый защищает поведение/инвариант, а не реализацию.

## Автоподдержка репозитория

- CI: `.github/workflows/ci.yml` (push/PR, Node 20 и 22).
- Живая страница: `.github/workflows/pages.yml` — автодеплой `dist/` на Pages
  при пуше в main.
- Ночной дрейф: `.github/workflows/nightly.yml` — тесты/сборка/`npm audit`
  раз в сутки.
- Renovate/Dependabot: `.github/dependabot.yml` — еженедельные PR на npm и
  actions-зависимости; PR от Dependabot прогоняют CI, мержить только зелёные.
