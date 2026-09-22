import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

export async function generateReport(data: any[], format: string = 'html'): Promise<string> {
  const reportsDir = path.join(__dirname, '../../reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Результаты');

    // Заголовки
    const headers = Object.keys(data[0] || {});
    worksheet.addRow(headers);

    // Данные
    data.forEach(row => {
      worksheet.addRow(headers.map(h => row[h]));
    });

    const filePath = path.join(reportsDir, `report_${timestamp}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }

  // HTML по умолчанию
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <title>Отчет по распознаванию</title>
      <style>
        body { font-family: sans-serif; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        tr:nth-child(even) { background-color: #f9f9f9; }
      </style>
    </head>
    <body>
      <h1>Результаты обработки документа</h1>
      <p>Дата генерации: ${new Date().toLocaleString()}</p>
      <table>
        <thead>
          <tr>${Object.keys(data[0] || {}).map(h => `<th>${h}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${data.map(row =>
            `<tr>${Object.values(row).map(v => `<td>${v !== null && v !== undefined ? v : ''}</td>`).join('')}</tr>`
          ).join('')}
        </tbody>
      </table>
    </body>
    </html>
  `;

  const filePath = path.join(reportsDir, `report_${timestamp}.html`);
  fs.writeFileSync(filePath, htmlContent);
  return filePath;
}
