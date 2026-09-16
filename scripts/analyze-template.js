import ExcelJS from 'exceljs';
import path from 'path';

async function analyzeExcel() {
  const filePath = path.resolve('참고/2026_발주체크_오직블라썸_0909_0915_v00.01.XLSX');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  console.log('=== 시트 목록 ===');
  wb.eachSheet((sheet, id) => {
    console.log(`[Sheet ${id}] ${sheet.name} (행 수: ${sheet.rowCount}, 열 수: ${sheet.columnCount})`);
  });

  // 첫 번째 및 주요 시트 헤더 및 샘플 행 확인
  wb.eachSheet((sheet, id) => {
    console.log(`\n--- Sheet: ${sheet.name} ---`);
    for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        values.push(`[${colNumber}] ${cell.text || cell.value || ''}`);
      });
      if (values.length > 0) {
        console.log(`Row ${r}: ${values.join(' | ')}`);
      }
    }
  });
}

analyzeExcel().catch(console.error);
