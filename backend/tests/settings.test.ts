/**
 * Тесты разбора settings.txt: дефолты, комментарии, валидация значений
 * и сообщения об ошибках с номером строки.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  DEFAULT_SETTINGS_PATH,
  SettingsError,
  loadSettings,
  parseSettings,
} from '../src/settings.js';

describe('parseSettings: дефолты', () => {
  it('пустой файл даёт значения по умолчанию', () => {
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
  });

  it('файл только с комментариями даёт значения по умолчанию', () => {
    const text = ['# настройки', '', '   ', '#APP_PORT=1'].join('\n');
    expect(parseSettings(text)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('parseSettings: разбор', () => {
  it('читает все девять ключей', () => {
    const settings = parseSettings(
      [
        'APP_HOST=0.0.0.0',
        'APP_PORT=9000',
        'API_BASE_URL=https://api.example.com/',
        'OLLAMA_BASE_URL=http://127.0.0.1:11434/',
        'OLLAMA_MODEL=llama3.1:8b',
        'AI_TIMEOUT_SEC=90',
        'LOG_LEVEL=debug',
        'LOG_FILE=logs/app.log',
        'OPEN_BROWSER=false',
      ].join('\n'),
    );

    expect(settings).toEqual({
      appHost: '0.0.0.0',
      appPort: 9000,
      apiBaseUrl: 'https://api.example.com',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'llama3.1:8b',
      aiTimeoutSec: 90,
      logLevel: 'debug',
      logFile: 'logs/app.log',
      openBrowser: false,
    });
  });

  it('обрезает пробелы вокруг ключа и значения', () => {
    const settings = parseSettings('  OLLAMA_MODEL  =  qwen2.5:7b-instruct  ');
    expect(settings.ollamaModel).toBe('qwen2.5:7b-instruct');
  });

  it('ключи регистронезависимы, значения сохраняют регистр', () => {
    expect(parseSettings('ollama_model=Mixtral:8x7B').ollamaModel).toBe('Mixtral:8x7B');
  });

  it('поддерживает CRLF и BOM', () => {
    const settings = parseSettings('﻿APP_PORT=7000\r\nOLLAMA_MODEL=qwen2.5:7b-instruct\r\n');
    expect(settings.appPort).toBe(7000);
    expect(settings.ollamaModel).toBe('qwen2.5:7b-instruct');
  });

  it('значение может содержать знак равенства', () => {
    expect(parseSettings('APP_HOST=a=b').appHost).toBe('a=b');
  });

  it('убирает завершающие слэши у адресов', () => {
    const settings = parseSettings(
      ['OLLAMA_BASE_URL=http://localhost:11434//', 'API_BASE_URL=https://x.example.com//'].join('\n'),
    );
    expect(settings.ollamaBaseUrl).toBe('http://localhost:11434');
    expect(settings.apiBaseUrl).toBe('https://x.example.com');
  });

  it('API_BASE_URL может быть пустым — тогда фронт ходит на тот же origin', () => {
    expect(parseSettings('API_BASE_URL=').apiBaseUrl).toBe('');
  });

  it('LOG_FILE может быть пустым — тогда логи только в консоль', () => {
    expect(parseSettings('LOG_FILE=').logFile).toBe('');
  });
});

describe('parseSettings: комментарии', () => {
  it('игнорирует строки-комментарии', () => {
    expect(parseSettings('#APP_PORT=1\nAPP_PORT=8081').appPort).toBe(8081);
  });

  it('вырезает инлайн-комментарий после пробела', () => {
    expect(parseSettings('OLLAMA_MODEL=qwen2.5:7b-instruct # локальная модель').ollamaModel).toBe(
      'qwen2.5:7b-instruct',
    );
  });

  it('не вырезает # без пробела перед ним', () => {
    expect(parseSettings('OLLAMA_MODEL=a#b').ollamaModel).toBe('a#b');
  });
});

describe('parseSettings: булевы значения', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['yes', true],
    ['1', true],
    ['да', true],
    ['false', false],
    ['No', false],
    ['off', false],
    ['0', false],
    ['нет', false],
  ])('OPEN_BROWSER=%s → %s', (value, expected) => {
    expect(parseSettings(`OPEN_BROWSER=${value}`).openBrowser).toBe(expected);
  });

  it('отклоняет мусорное значение', () => {
    expect(() => parseSettings('OPEN_BROWSER=maybe')).toThrow(SettingsError);
  });
});

describe('parseSettings: ошибки', () => {
  it('указывает номер строки для неизвестного ключа', () => {
    let error: unknown;
    try {
      parseSettings(['APP_PORT=8080', 'PORT=8080'].join('\n'));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(SettingsError);
    expect((error as SettingsError).message).toContain('Строка 2');
    expect((error as SettingsError).message).toContain('неизвестный ключ PORT');
    expect((error as SettingsError).message).toContain('APP_HOST');
  });

  it('ловит строку без знака равенства', () => {
    expect(() => parseSettings('APP_PORT 8080')).toThrow(/КЛЮЧ=ЗНАЧЕНИЕ/);
  });

  it('ловит дубль ключа', () => {
    expect(() => parseSettings('APP_PORT=1\nAPP_PORT=2')).toThrow(/дважды/);
  });

  it('ловит пустой ключ', () => {
    expect(() => parseSettings('=8080')).toThrow(/пустое имя ключа/);
  });

  it('ловит непустой порт вне диапазона', () => {
    expect(() => parseSettings('APP_PORT=70000')).toThrow(/диапазоне 1\.\.65535/);
    expect(() => parseSettings('APP_PORT=0')).toThrow(/диапазоне 1\.\.65535/);
  });

  it('ловит дробный и нечисловой порт', () => {
    expect(() => parseSettings('APP_PORT=80.5')).toThrow(/целым числом/);
    expect(() => parseSettings('APP_PORT=http')).toThrow(/целым числом/);
  });

  it('ловит неположительный таймаут', () => {
    expect(() => parseSettings('AI_TIMEOUT_SEC=0')).toThrow(/диапазоне 1\.\.3600/);
  });

  it('ловит неизвестный уровень лога', () => {
    expect(() => parseSettings('LOG_LEVEL=verbose')).toThrow(/LOG_LEVEL.*ожидается одно из/s);
  });

  it('ловит пустое обязательное значение', () => {
    expect(() => parseSettings('OLLAMA_MODEL=')).toThrow(/не может быть пустым/);
    expect(() => parseSettings('APP_HOST=')).toThrow(/не может быть пустым/);
    expect(() => parseSettings('OLLAMA_BASE_URL=')).toThrow(/не может быть пустым/);
  });

  it('ловит забытую схему — самая частая опечатка', () => {
    expect(() => parseSettings('OLLAMA_BASE_URL=localhost:11434')).toThrow(
      /схема.*не поддерживается/s,
    );
  });

  it('ловит не-URL в адресе', () => {
    expect(() => parseSettings('OLLAMA_BASE_URL=http://')).toThrow(/не похоже на адрес/);
    expect(() => parseSettings('OLLAMA_BASE_URL=не адрес')).toThrow(/не похоже на адрес/);
  });

  it('ловит неподдерживаемую схему', () => {
    expect(() => parseSettings('OLLAMA_BASE_URL=ftp://localhost:11434')).toThrow(
      /схема.*не поддерживается/s,
    );
  });

  it('ловит не-URL в API_BASE_URL', () => {
    expect(() => parseSettings('API_BASE_URL=/api')).toThrow(/не похоже на адрес/);
  });
});

describe('settings.example.txt', () => {
  const examplePath = new URL('../../settings.example.txt', import.meta.url);

  it('разбирается без ошибок: опечатка в ключе сломала бы старт каждому пользователю сборки', () => {
    // build-win.cmd копирует шаблон как рабочий settings.txt, а парсер падает
    // на неизвестном ключе — значит, ошибка здесь уехала бы к конечному юзеру.
    const settings = parseSettings(readFileSync(examplePath, 'utf8'));

    // Шаблон не должен расходиться с реальными дефолтами: иначе документация
    // в комментариях («(8080)», «(info)») обещает не то, что получит пользователь.
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('разбирается с CRLF — файл правят в блокноте на Windows', () => {
    const text = readFileSync(examplePath, 'utf8').replace(/\n/g, '\r\n');
    expect(() => parseSettings(text)).not.toThrow();
  });
});

describe('loadSettings', () => {
  it('указывает путь к файлу в сообщении об ошибке', () => {
    expect(() => loadSettings('/нет/такого/settings.txt')).toThrow(/\/нет\/такого\/settings\.txt/);
  });

  it('путь по умолчанию — settings.txt на два уровня выше backend/src', () => {
    const normalized = DEFAULT_SETTINGS_PATH.replace(/\\/g, '/');
    expect(normalized.endsWith('/settings.txt')).toBe(true);
    // путь должен указывать на корень (репозитория при разработке, app/ в сборке),
    // а не внутрь backend/src — иначе настройки не найдутся
    expect(normalized).not.toContain('/backend/src/');
  });
});
