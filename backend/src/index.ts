import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { structuredParse } from './services/structuredParse';
import { compareDocuments } from './services/comparisonService';
import { generateReport } from './services/reportGenerator';
import { AiUnavailableError } from './services/ai/errors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Настройка хранилища файлов
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Тестовый анализ с поддержкой клиентского API Key
app.post('/api/test/analyze', upload.array('files', 2), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    const apiKey = req.headers['x-api-key'] as string | undefined;
    const model = req.headers['x-model'] as string | undefined;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Файлы не загружены' });
    }

    console.log(`📂 Обработка файлов: ${files.map(f => f.filename).join(', ')}`);
    console.log(`🔑 API Key предоставлен: ${!!apiKey}`);
    console.log(`🤖 Модель: ${model || 'default'}`);

    const result = await structuredParse(files, { apiKey, model });
    res.json(result);
  } catch (error: any) {
    console.error('❌ Ошибка анализа:', error);

    if (error instanceof AiUnavailableError) {
      return res.status(503).json({
        error: 'AI сервис недоступен',
        details: error.message,
        fallbackUsed: error.fallbackUsed
      });
    }

    res.status(500).json({ error: error.message || 'Внутренняя ошибка сервера' });
  }
});

// Сравнение документов
app.post('/api/compare', upload.array('files', 2), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    const apiKey = req.headers['x-api-key'] as string | undefined;
    const model = req.headers['x-model'] as string | undefined;

    if (!files || files.length !== 2) {
      return res.status(400).json({ error: 'Требуется ровно 2 файла для сравнения' });
    }

    const result = await compareDocuments(files, { apiKey, model });
    res.json(result);
  } catch (error: any) {
    console.error('❌ Ошибка сравнения:', error);
    res.status(500).json({ error: error.message });
  }
});

// Генерация отчета
app.post('/api/report', async (req, res) => {
  try {
    const { data, format = 'html' } = req.body;
    if (!data) return res.status(400).json({ error: 'Нет данных для отчета' });

    const reportPath = await generateReport(data, format);
    res.json({ url: `/reports/${path.basename(reportPath)}` });
  } catch (error: any) {
    console.error('❌ Ошибка генерации отчета:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
