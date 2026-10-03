import type { AiProfile } from '../hooks/useAiProfile';
import { useModelSettings, type ModelSettings, type VerifyTone } from '../hooks/useModelSettings';
import { XIcon } from './icons';

interface ModelModalProps {
  /** Профиль из `App` — единственный в дереве, второй здесь не создаётся */
  profile: AiProfile;
  onClose(): void;
}

interface PartProps {
  settings: ModelSettings;
}

/**
 * Окно настроек модели.
 *
 * Собран на классах, которые лежали в `components.css` неиспользованными с тех
 * пор, как эту возможность убрали из приложения: `.modal-overlay`,
 * `.modal-panel`, `.modal-header`, `.modal-title`, `.modal-close`,
 * `.modal-body`, `.modal-footer` и `XIcon`. Поэтому окно неотличимо от
 * остального интерфейса, а новая разметка не завела второго языка оформления.
 *
 * Закрывается тремя способами — крестик, щелчок по подложке и Escape, — и ни
 * один из них не зависит от того, удалось ли проверить подключение: сломанный
 * провайдер не должен запирать оператора в его же настройках.
 */
export function ModelModal({ profile, onClose }: ModelModalProps) {
  const settings = useModelSettings(profile, onClose);

  return (
    // Щелчок мимо панели закрывает окно, щелчок по панели — нет. Сравнение идёт
    // по самому событию, а не по отдельному флагу: иначе протяжка мышью из поля
    // наружу закрыла бы окно вместе с начавшимся выделением.
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) settings.close();
      }}
    >
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="model-modal-title">
        <div className="modal-header">
          <h2 className="modal-title" id="model-modal-title">
            Модель и ключ
          </h2>
          <button type="button" className="modal-close" onClick={settings.close} aria-label="Закрыть">
            <XIcon />
          </button>
        </div>

        <div className="modal-body">
          <SavedKeyNotice settings={settings} />
          <ProviderChoice settings={settings} />
          {settings.choice === 'remote' && <RemoteFields settings={settings} />}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={settings.useLocal}>
            Вернуться к локальной модели
          </button>
          <button type="button" className="btn btn-ghost" onClick={settings.close}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" onClick={settings.save}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

/** Тон строки результата переводится в тот же баннер, что и в остальном приложении */
function bannerClass(tone: VerifyTone | null): string {
  if (tone === 'ok') return 'banner banner-success';
  if (tone === 'bad') return 'banner banner-error';
  if (tone === 'warn') return 'banner banner-warning';
  return 'banner';
}

/**
 * Индикатор «ключ сохранён в этом браузере» с удалением в один клик (IS-11).
 *
 * Показывается независимо от выбранной модели: следующий человек за этим
 * браузером должен видеть, что секрет в профиле лежит, даже когда работа идёт
 * на локальной модели. Четыре символа в тексте не попадают — сама подсказка о
 * последних символах стоит под полем ключа.
 *
 * Кнопка называет оба удаляемых значения, а не только ключ: очистка профиля
 * убирает и идентификатор модели, и надпись, которая говорила бы об одном,
 * расходилась бы с тем, что происходит в браузере.
 */
function SavedKeyNotice({ settings }: PartProps) {
  if (!settings.hasKey) return null;
  return (
    <div className="banner banner-success">
      <div>Ключ сохранён в этом браузере.</div>
      <button type="button" className="btn btn-ghost btn-xs" onClick={settings.purge}>
        Удалить ключ и модель
      </button>
    </div>
  );
}

/**
 * Выбор между локальной моделью и удалённым шлюзом.
 *
 * Это ровно тот случай, для которого `.modal-model-list` и его части и были
 * написаны: список вариантов с переключателем, названием и подписью-идентификатором
 * под ним. Списка моделей здесь нет и не будет — идентификатор вводится руками,
 * каталог проверяет сервер. Переключатели объединены одним `name`, поэтому
 * выбраны ровно один.
 *
 * Локальный вариант запрещён **только** при подтверждённом «не слушает»:
 * выбирать нечего, и подсказка сервера показывает, что делать. Остальные вердикты
 * оставляют выбор свободным — задание из этого окна не запускается, а локальная
 * модель остаётся запасным путём, когда шлюз недоступен.
 */
function ProviderChoice({ settings }: PartProps) {
  const { local, choice, model } = settings;
  return (
    <>
      <div className="modal-model-list">
        <label className={`modal-model-option${local.blocked ? ' is-disabled' : ''}`}>
          <input
            type="radio"
            name="ai-provider"
            value="local"
            checked={choice === 'local'}
            disabled={local.blocked}
            onChange={settings.chooseLocal}
          />
          <span className="modal-model-info">
            <span className="modal-model-name">Локальная модель Ollama</span>
            <span className="modal-model-id">{local.model || 'задана в settings.txt'}</span>
          </span>
        </label>
        <label className="modal-model-option">
          <input
            type="radio"
            name="ai-provider"
            value="remote"
            checked={choice === 'remote'}
            onChange={settings.chooseRemote}
          />
          <span className="modal-model-info">
            <span className="modal-model-name">OpenRouter — удалённый шлюз</span>
            <span className="modal-model-id">{model || 'идентификатор вводится ниже'}</span>
          </span>
        </label>
      </div>
      <LocalNotice settings={settings} />
    </>
  );
}

/**
 * Одна строка о локальной модели: почему вариант запрещён либо что подсказать.
 *
 * Оба случая живут в одном баннере и показываются вместе с отказом сохранения —
 * так оператор видит все причины, по которым «Сохранить» не сработает, в одном
 * месте. Текст о локальной модели дословно взят у сервера (`describeOllama`):
 * окно не знает адреса Ollama и не должно додумывать подсказку вместо него.
 */
function LocalNotice({ settings }: PartProps) {
  const { local, refusal } = settings;
  const text = refusal || local.blocked ? refusal || local.remedy : local.note;
  if (text === '') return null;
  const tone: VerifyTone = refusal !== '' || local.blocked ? 'bad' : 'warn';
  return <div className={bannerClass(tone)}>{text}</div>;
}

/**
 * Поля удалённого варианта: идентификатор, ключ, проверка и предупреждение.
 *
 * Ключ маскирован штатным `type="password"`, а «Показать» меняет только тип
 * поля — в разметку он попадает как значение `input`, и ни в одну строку
 * интерфейса не превращается. Скрытый текст подсказки говорит и вторую вещь:
 * пустое поле сохранит прежний ключ, а не удалит его.
 *
 * Проверка бесплатна (модель не зовётся) и запускается только нажатием: сам
 * интерфейс в удалённый шлюз не стучится. Её результат — строка под кнопкой,
 * дословный текст сервера; секрет в этот текст попасть не может, потому что
 * сервер его не возвращает.
 */
function RemoteFields({ settings }: PartProps) {
  const { model, key, revealed, verify } = settings;
  return (
    <div className="modal-custom-section">
      <label className="modal-label" htmlFor="ai-model">
        Идентификатор модели в каталоге OpenRouter
      </label>
      <input
        id="ai-model"
        className="modal-custom-input"
        value={model}
        onChange={(event) => settings.setModel(event.target.value)}
        placeholder="vendor/model:free"
        autoComplete="off"
        spellCheck={false}
      />

      <label className="modal-label mt-4" htmlFor="ai-api-key">
        API-ключ OpenRouter
      </label>
      <div className="modal-key-row">
        <input
          id="ai-api-key"
          className="modal-custom-input"
          type={revealed ? 'text' : 'password'}
          value={key}
          onChange={(event) => settings.setKey(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="modal-reveal" onClick={settings.toggleReveal} aria-pressed={revealed}>
          {revealed ? 'Скрыть' : 'Показать'}
        </button>
      </div>
      {settings.keyHint !== '' && <p className="modal-hint">{settings.keyHint}</p>}

      <div className="mt-3">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={settings.runVerify}
          disabled={verify.status === 'busy'}
        >
          {verify.status === 'busy' ? 'Проверяем…' : 'Проверить подключение'}
        </button>
      </div>
      {verify.text !== '' && <div className={bannerClass(verify.tone)}>{verify.text}</div>}

      <div className="banner banner-warning mt-4">
        <div>
          <strong>Документ уходит третьей стороне.</strong> При удалённой модели он отправляется OpenRouter, и в
          отчёте это будет указано. Заведите лимит кредита — тогда утёкший ключ стоит ограниченную сумму. Ключ
          хранится только в этом браузере.
        </div>
      </div>
    </div>
  );
}
