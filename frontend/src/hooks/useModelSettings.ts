import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, type AiVerifyResult, type OllamaStatus } from '../api';
import type { AiProfile } from './useAiProfile';

/**
 * Состояние окна настроек модели: что выбрано, что введено, что показано.
 *
 * Вся логика живёт здесь, а не в компоненте: `AGENTS.md:161` требует держать
 * `components/` рендером и взаимодействием, а здесь четыре `useState`, проверка
 * подключения и подписка на Escape. Компонент получает готовую форму и набор
 * действий и ничего не решает.
 *
 * **Профиль приходит пропом, а не создаётся здесь.** Единственный экземпляр
 * `useAiProfile` живёт в `App` (см. `App.tsx`): два экземпляра держали бы
 * независимые копии, и сохранение из окна обновило бы значок в шапке, но не
 * запросы, которые уходят из «Быстрого» режима — то самое молчаливое
 * расхождение, ради которого профиль и вынесен наружу.
 */

/** Что выбрано в окне: локальная модель или удалённый шлюз */
export type ProviderChoice = 'local' | 'remote';

/** Тон строки результата проверки: тот же словарь, что у баннеров */
export type VerifyTone = 'ok' | 'warn' | 'bad';

/** Проверка подключения: «не сработало» и «не смогли проверить» — разные вещи */
export interface VerifyView {
  /** `busy` только на время запроса: кнопка блокируется, но не исчезает */
  status: 'idle' | 'busy' | 'done';
  tone: VerifyTone | null;
  /** Текст для оператора; ключа не содержит — сервер его не возвращает */
  text: string;
}

/** Локальная модель: вердикт `GET /api/ollama/status` в виде решения */
export interface LocalView {
  /** Модель из settings.txt; '' — сервер не ответил и вердикта нет */
  model: string;
  /** Выбрать нельзя: подтверждено, что по адресу никто не слушает */
  blocked: boolean;
  /** Что делать: текст сервера (`describeOllama`), показывается дословно */
  remedy: string;
  /** Подсказка без запрета: Ollama отвечает, но модель не скачана */
  note: string;
}

/** Форма окна: только чтение */
export interface ModelSettingsView {
  choice: ProviderChoice;
  /** Идентификатор модели из поля ввода; сохраняется при открытии */
  model: string;
  /** Только что введённый ключ. Секрет в разметку не попадает (см. `ModelModal`) */
  key: string;
  /** Показать введённый ключ открытым текстом вместо маски */
  revealed: boolean;
  local: LocalView;
  /** Причина, по которой сохранение отказано; '' — сохранять можно */
  refusal: string;
  /** Строка подсказки под полем ключа; '' — показывать нечего */
  keyHint: string;
  /** Ключ лежит в этом браузере — индикатор для IS-11 */
  hasKey: boolean;
  verify: VerifyView;
}

/** Действия окна */
export interface ModelSettingsActions {
  chooseLocal(): void;
  chooseRemote(): void;
  setModel(value: string): void;
  setKey(value: string): void;
  toggleReveal(): void;
  /** Проверка по нажатию оператора и только по нему */
  runVerify(): void;
  /** Записать выбор в профиль и закрыть окно */
  save(): void;
  /** Вернуться к локальной модели: удалить профиль и закрыть окно */
  useLocal(): void;
  /** Удалить профиль этого браузера целиком (ключ и модель), оставаясь в окне */
  purge(): void;
  /** Закрыть окно без сохранения */
  close(): void;
}

/** То, что отдаёт `useModelSettings` */
export interface ModelSettings extends ModelSettingsView, ModelSettingsActions {}

/** Проверка идёт; значит, кнопку ждать, а строку результата ещё не сбрасывать */
const IDLE_VERIFY: VerifyView = { status: 'idle', tone: null, text: '' };

/**
 * Пустой вердикт: сервер не ответил, поэтому локальная модель остаётся
 * запасным вариантом, а её поломка ничем не доказывана. Запрещать выбор здесь
 * нельзя — «не смогли проверить» и «не слушает» разные вещи.
 */
const UNKNOWN_LOCAL: LocalView = { model: '', blocked: false, remedy: '', note: '' };

/**
 * Причины отказа сохранения. Текст дословно повторяет серверный
 * (`services/ai/profile.ts`), чтобы окно и сервер не говорили оператору разного
 * про одно и то же. Дублирование строки, а не логики: правила проверки там свои.
 */
const REFUSE_NO_MODEL = 'Укажите модель — её идентификатор из каталога OpenRouter.';
const REFUSE_BAD_MODEL = 'Идентификатор модели не должен содержать пробелов или служебных символов.';
const REFUSE_NO_KEY = 'Укажите API-ключ OpenRouter.';

/**
 * Пробел, таб и управляющие символы в идентификаторе.
 *
 * Проверка та же, что на сервере (`services/ai/profile.ts`, `hasForbiddenChars`)
 * и у хука в `isPlausibleModelId`, и нужна здесь не для красоты: без неё окно
 * записало бы модель с пробелом, `useAiProfile` молча счёл бы её пустой, и в
 * хранилище оказался бы ключ без модели — профиль, который `isRemote` называет
 * нерабочим, то есть ключ лежит, а применяться не будет.
 */
function hasForbiddenChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined) return true;
    if (/\s/.test(char)) return true;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Единственный богатый вывод, который диалог вообще может получить от сервера:
 * остаток кредита уже входит в `message` (`creditNote`), поэтому вторую
 * арифметику по кредиту интерфейс не повторяет.
 */
function verifyViewFrom(result: AiVerifyResult): VerifyView {
  const tone: VerifyTone = result.status === 'ok' ? 'ok' : result.status === 'failed' ? 'bad' : 'warn';
  return { status: 'done', tone, text: result.message };
}

/**
 * Вердикт о локальной модели превращается в решение окна.
 *
 * `not-listening` — единственный случай, когда локальный вариант запрещён: там
 * действительно нет модели, и выбирать её нечего. `model-missing` — подсказка
 * без запрета (модель скачивается одной командой, и это не поломка Ollama).
 * `unresponsive` не показывается вовсе: медленная локальная модель не должна
 * выглядеть как отсутствующая, а запрета по этому поводу не заводим.
 */
function localViewFrom(status: OllamaStatus | null): LocalView {
  if (status === null) return UNKNOWN_LOCAL;
  const { verdict, model, remedy } = status;
  return {
    model,
    blocked: verdict === 'not-listening',
    remedy: verdict === 'not-listening' ? remedy : '',
    note: verdict === 'model-missing' ? remedy : '',
  };
}

/**
 * Окно настроек модели поверх единственного профиля.
 *
 * Открыто — значит смонтировано: `App` рендерит `ModelModal` только пока окно на
 * экране, поэтому проверка локальной модели уходит ровно один раз за открытие, а
 * не на каждый рендер.
 */
export function useModelSettings(profile: AiProfile, onClose: () => void): ModelSettings {
  const [choice, setChoice] = useState<ProviderChoice>(profile.isRemote ? 'remote' : 'local');
  const [model, setModelState] = useState<string>(profile.model);
  const [key, setKeyState] = useState<string>('');
  const [revealed, setRevealed] = useState<boolean>(false);
  const [local, setLocal] = useState<LocalView>(UNKNOWN_LOCAL);
  const [refusal, setRefusal] = useState<string>('');
  const [verify, setVerify] = useState<VerifyView>(IDLE_VERIFY);

  // Правка поля снимает отказ: он относился к прежнему набору значений.
  const setModel = useCallback((value: string): void => {
    setModelState(value);
    setRefusal('');
  }, []);

  const setKey = useCallback((value: string): void => {
    setKeyState(value);
    setRefusal('');
  }, []);

  /** Отказ гасится вместе со сменой варианта: к local он отношения не имеет */
  const pick = useCallback((next: ProviderChoice): void => {
    setChoice(next);
    setRefusal('');
  }, []);

  const chooseLocal = useCallback((): void => pick('local'), [pick]);
  const chooseRemote = useCallback((): void => pick('remote'), [pick]);
  const toggleReveal = useCallback((): void => setRevealed((was) => !was), []);
  const close = useCallback((): void => onClose(), [onClose]);

  // Локальная модель — единственная, чьё состояние окно берёт не из профиля.
  // Ошибка здесь ничего не запрещает: не ответил backend — не доказано, что
  // модель отсутствует.
  useEffect(() => {
    let alive = true;
    api
      .ollamaStatus()
      .then((status) => {
        if (alive) setLocal(localViewFrom(status));
      })
      .catch(() => {
        if (alive) setLocal(UNKNOWN_LOCAL);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Escape закрывает окно, как и щелчок по подложке. Обработчик вешается на
  // окно, а не на панель: фокус внутри формы Escape не отменяет.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /**
   * Ключ для проверки и для сохранения: введённый, а если поле оставлено пустым
   * — уже сохранённый. Пустое поле означает «оставь как есть», а не «удали».
   */
  const effectiveKey = key.trim() !== '' ? key.trim() : profile.apiKey;

  /** Названная причина, если пара неполна; '' — пара годится */
  const pairRefusal = useCallback((): string => {
    const id = model.trim();
    if (id === '') return REFUSE_NO_MODEL;
    if (hasForbiddenChars(id)) return REFUSE_BAD_MODEL;
    return effectiveKey === '' ? REFUSE_NO_KEY : '';
  }, [model, effectiveKey]);

  const runVerify = useCallback((): void => {
    const refused = pairRefusal();
    if (refused !== '') {
      setVerify({ status: 'done', tone: 'bad', text: refused });
      return;
    }
    setVerify({ status: 'busy', tone: null, text: 'Проверяем ключ и каталог моделей…' });
    api
      .verifyProfile({ model: model.trim(), apiKey: effectiveKey })
      .then((result) => setVerify(verifyViewFrom(result)))
      .catch((err: unknown) => {
        // Текст ошибки приходит с сервера и ключа не содержит; на всякий случай
        // не показываем ничего, кроме текста: `message` у ApiError безопаснее
        // строкового представления исключения.
        const text = err instanceof Error ? err.message : 'Проверка не выполнена.';
        setVerify({ status: 'done', tone: 'bad', text });
      });
  }, [effectiveKey, model, pairRefusal]);

  const save = useCallback((): void => {
    if (choice === 'local') {
      // Явный выбор локальной модели означает отказ от удалённого профиля.
      profile.clear();
      onClose();
      return;
    }
    const refused = pairRefusal();
    if (refused !== '') {
      setRefusal(refused);
      return;
    }
    /**
     * Строка, ради которой окно и написано.
     *
     * `save` трактует пустой `apiKey` как удаление ключа — это его контракт
     * (`useAiProfile`), а не ошибка. Поле маскировано и показывает только
     * последние четыре символа, поэтому оно пусто всякий раз, когда оператор
     * модель поменял, а ключ не ввёл заново. Сюда уходит `effectiveKey`:
     * введённый ключ, а при пустом поле — сохранённый. Отправил бы пустую
     * строку — смена модели молча уничтожила бы живой ключ.
     */
    profile.save({ model: model.trim(), apiKey: effectiveKey });
    onClose();
  }, [choice, effectiveKey, model, onClose, pairRefusal, profile]);

  const useLocal = useCallback((): void => {
    profile.clear();
    onClose();
  }, [onClose, profile]);

  /**
   * Полная очистка удалённого профиля в этом браузере — ключа **и**
   * идентификатора модели, — с возвратом варианта «локальная модель».
   *
   * Очистка именно полная: половина профиля оставила бы в хранилище модель без
   * ключа, а `isRemote` такой набор всё равно не применяет — остался бы мусор,
   * который выглядит как настройка. Кнопка в окне называет оба значения.
   *
   * Поле модели очищается вместе с хранилищем: оставшийся в форме
   * идентификатор показывался бы в списке вариантов как сохранённый, а в
   * хранилище его уже нет.
   */
  const purge = useCallback((): void => {
    profile.clear();
    setKeyState('');
    setModelState('');
    pick('local');
    setVerify(IDLE_VERIFY);
  }, [pick, profile]);

  /**
   * Подсказка нужна ровно в одном состоянии: поле ключа пусто, а ключ в этом
   * браузере сохранён. Тогда она отвечает на главный вопрос этого поля — «пустое
   * поле удалит ключ или оставит?» — и отвечает «оставит». Если ключ только что
   * введён, хранилище уже не в счёт, и подсказка про старое содержимое была бы
   * просто шумом; при показе ключа она и вовсе лишняя.
   */
  const keyHint = useMemo((): string => {
    if (revealed || key.trim() !== '' || !profile.hasKey) return '';
    return `Сохранённый ключ оканчивается на ${profile.keyHint}. Пустое поле оставит его без изменений.`;
  }, [key, profile.hasKey, profile.keyHint, revealed]);

  return useMemo(
    () => ({
      choice,
      model,
      key,
      revealed,
      local,
      refusal,
      keyHint,
      hasKey: profile.hasKey,
      verify,
      chooseLocal,
      chooseRemote,
      setModel,
      setKey,
      toggleReveal,
      runVerify,
      save,
      useLocal,
      purge,
      close,
    }),
    [
      choice,
      model,
      key,
      revealed,
      local,
      refusal,
      keyHint,
      profile.hasKey,
      verify,
      chooseLocal,
      chooseRemote,
      setModel,
      setKey,
      toggleReveal,
      runVerify,
      save,
      useLocal,
      purge,
      close,
    ],
  );
}
