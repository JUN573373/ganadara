import ExcelJS from 'exceljs';
import path from 'path';

async function checkStyles() {
  const filePath = path.resolve('참고/2026_발주체크_오직블라썸_0909_0915_v00.01.XLSX');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const sheet = wb.getWorksheet('9.12(토)');
  console.log('--- 열 너비 (cols) ---');
  sheet.columns.forEach((col, idx) => {
    console.log(`Col ${idx + 1}: width = ${col.width}`);
  });

  console.log('--- Row 1 스타일 ---');
  const r1 = sheet.getRow(1);
  console.log('r1 font:', r1.font, 'fill:', r1.fill, 'height:', r1.height);

  console.log('--- Row 2 (헤더) 스타일 ---');
  const r2 = sheet.getRow(2);
  console.log('r2 font:', r2.font, 'fill:', r2.fill, 'height:', r2.height);
  r2.eachCell((cell, col) => {
    console.log(`Cell 2,${col}: font=${cell.font?.name} ${cell.font?.size} bold=${cell.font?.bold}, fill=${JSON.stringify(cell.fill)}, align=${JSON.stringify(cell.alignment)}`);
  });

  console.log('--- Row 3 (데이터 1행) 스타일 ---');
  const r3 = sheet.getRow(3);
  r3.eachCell((cell, col) => {
    console.log(`Cell 3,${col}: font=${cell.font?.name} ${cell.font?.size} bold=${cell.font?.bold}, fill=${JSON.stringify(cell.fill)}, align=${JSON.stringify(cell.alignment)}, border=${JSON.stringify(cell.border)}`);
  });
}

checkStyles().catch(console.error);
