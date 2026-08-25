/**
 * Общая геометрия восстановления таблицы из координатных данных
 * (используется и текстовым PDF-парсером, и OCR-конвейером).
 *
 * Колонки унифицируются между строками и страницами методом интервалов:
 * каждая ячейка — отрезок [x0, x1], колонка — объединение перекрывающихся
 * отрезков. Это переживает выключку чисел вправо и повторяющиеся шапки.
 */

export interface Segment {
  x0: number;
  x1: number;
  text: string;
  /** Рабочий индекс колонки до сортировки слева направо */
  col: number;
}

interface ColumnBox {
  x0: number;
  x1: number;
}

const COL_TOLERANCE = 4; // pt/px

/**
 * Унификация колонок между строками и страницами.
 *
 * Важно: колонки задают ТОЛЬКО строки минимум с двумя ячейками. Одиночные
 * сегменты (титул акта, подвал) не должны участвовать в определении колонок —
 * их широкий интервал иначе «поглощает» соседние колонки перекрытием.
 * После построения колонок одиночные сегменты привязываются к ближайшей
 * перекрывающей колонке, а совсем непохожие получают собственную.
 */
export function assignColumns(pagesOfLines: Segment[][][]): Map<Segment, number> {
  const boxes: ColumnBox[] = [];

  const tryAssign = (seg: Segment): number => {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      const overlap = Math.min(box.x1, seg.x1) - Math.max(box.x0, seg.x0);
      if (overlap > 0) {
        if (overlap > bestScore) {
          bestScore = overlap;
          bestIdx = i;
        }
      } else {
        const dist = Math.max(box.x0 - seg.x1, seg.x0 - box.x1);
        if (dist < COL_TOLERANCE && -dist > bestScore) {
          bestScore = -dist;
          bestIdx = i;
        }
      }
    }
    return bestIdx;
  };

  const growBox = (idx: number, seg: Segment): void => {
    const box = boxes[idx]!;
    box.x0 = Math.min(box.x0, seg.x0);
    box.x1 = Math.max(box.x1, seg.x1);
    seg.col = idx;
  };

  // Фаза 1: строим колонки по «настоящим» строкам таблицы
  for (const lines of pagesOfLines) {
    for (const line of lines) {
      if (line.length < 2) continue;
      for (const seg of line) {
        const idx = tryAssign(seg);
        if (idx < 0) boxes.push({ x0: seg.x0, x1: seg.x1 }), (seg.col = boxes.length - 1);
        else growBox(idx, seg);
      }
    }
  }

  // Фаза 2: одиночные сегменты (титулы и пр.) — к ближайшей колонке
  const leftovers: Segment[] = [];
  for (const lines of pagesOfLines) {
    for (const line of lines) {
      if (line.length >= 2) continue;
      for (const seg of line) {
        const idx = tryAssign(seg);
        if (idx < 0) leftovers.push(seg);
        else growBox(idx, seg);
      }
    }
  }

  // Колонки слева направо получают последовательные индексы
  const renumber = (): Map<number, number> => {
    const order = boxes
      .map((box, idx) => ({ idx, x0: box.x0 }))
      .sort((a, b) => a.x0 - b.x0 || a.idx - b.idx);
    const map = new Map<number, number>();
    order.forEach((entry, sortedIdx) => map.set(entry.idx, sortedIdx));
    return map;
  };

  const assignment = new Map<Segment, number>();
  const finalize = (): void => {
    const remap = renumber();
    for (const lines of pagesOfLines) {
      for (const line of lines) {
        for (const seg of line) {
          assignment.set(seg, remap.get(seg.col) ?? 0);
        }
      }
    }
  };

  if (leftovers.length === 0) {
    finalize();
    return assignment;
  }

  // Совсем непопадающие одиночки получают собственные колонки (в порядке следования)
  const pending = [...leftovers];
  finalize();
  for (const seg of pending) {
    seg.col = boxes.length;
    boxes.push({ x0: seg.x0, x1: seg.x1 });
  }

  // Перенумеровываем ещё раз с учётом новых колонок
  assignment.clear();
  finalize();
  return assignment;
}

/** Страница → строки → сегменты → прямоугольная сетка значений */
export function segmentsToGrid(
  pagesOfLines: Segment[][][],
  assignment: Map<Segment, number>,
): string[][] {
  const width = new Set(assignment.values()).size || 1;
  const rows: string[][] = [];
  for (const lines of pagesOfLines) {
    for (const segments of lines) {
      const joined: string[] = new Array(width).fill('');
      for (const seg of segments) {
        const col = assignment.get(seg) ?? 0;
        joined[col] = joined[col] ? `${joined[col]} ${seg.text}` : seg.text;
      }
      rows.push(joined.map((text) => text.trim()));
    }
  }
  return rows;
}

/** Обрезка полностью пустых строк и столбцов по краям сетки */
export function trimGridEdges<T>(grid: T[][], empty: (v: T) => boolean): T[][] {
  let top = 0;
  let bottom = grid.length - 1;
  const rowEmpty = (r: number) => (grid[r] ?? []).every(empty);
  while (top <= bottom && rowEmpty(top)) top++;
  while (bottom >= top && rowEmpty(bottom)) bottom--;
  const rows = grid.slice(top, bottom + 1);
  if (rows.length === 0) return [];

  let right = (rows[0]?.length ?? 0) - 1;
  const colEmpty = (c: number) => rows.every((row) => empty(row[c] as T));
  while (right >= 0 && colEmpty(right)) right--;
  return rows.map((row) => row.slice(0, right + 1));
}
