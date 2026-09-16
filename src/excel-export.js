import ExcelJS from 'exceljs';
import { cleanBouquetName, cleanBrideName, formatNotes } from './formatter.js';

/**
 * 엑셀 시트명 포맷: "9.12(토)"
 */
function formatSheetName(dateText) {
  if (!dateText) return '기타';
  const match = dateText.match(/(\d{1,2})\/(\d{1,2})\s*\(([가-힣])\)/);
  if (match) {
    return `${parseInt(match[1], 10)}.${parseInt(match[2], 10)}(${match[3]})`;
  }
  const isoMatch = dateText.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(dateText);
    const dayOfWeek = '일월화수목금토'[d.getDay()] || '';
    return `${parseInt(isoMatch[2], 10)}.${parseInt(isoMatch[3], 10)}(${dayOfWeek})`;
  }
  return dateText.slice(0, 30);
}

/**
 * 날짜 헤더 타이틀 포맷: "9/12(토)"
 */
function formatDateTitle(sheetName) {
  return sheetName.replace('.', '/');
}

/**
 * 오직블라썸 표준 발주체크 엑셀 통합 문서 생성
 */
export async function createBaljuWorkbook(aggregatedRows, options = {}) {
  const { orderType = 'WMON' } = options;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OZIC BLOSSOM';
  wb.created = new Date();

  const thinBorder = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } },
  };

  if (orderType === 'RMON') {
    // === 촬영용 시트 단일 생성 ===
    const sheet = wb.addWorksheet('촬영');

    sheet.columns = [
      { width: 15.0 },  // 날짜
      { width: 20.6 },  // 담당플래너
      { width: 15.8 },  // 신부명
      { width: 26.6 },  // 배송지
      { width: 11.9 },  // 배송시간
      { width: 55.6 },  // 발주부케
      { width: 125.6 }, // 특이사항
      { width: 24.6 },  // 리허설장소
      { width: 11.9 },  // 리허설시간
    ];

    // 헤더 행
    const headerRow = sheet.addRow([
      '날짜', '담당플래너', '신부명', '배송지', '배송시간', '발주부케', '특이사항', '리허설장소', '리허설시간'
    ]);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { name: '맑은 고딕', size: 16, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = thinBorder;
    });

    aggregatedRows.forEach((row) => {
      const planner = row._site === 'swed' && !row['담당플래너']?.includes('S웨딩')
        ? `${row['담당플래너']}-S웨딩`
        : row['담당플래너'] || '';

      const dataRow = sheet.addRow([
        row['날짜'] || '',
        planner,
        cleanBrideName(row['신부명']),
        row['배송지'] || '',
        row['배송시간'] || '',
        row._cleanedBouquet || cleanBouquetName(row['발주부케']),
        row['특이사항'] || '',
        row['리허설장소'] || '',
        row['리허설시간'] || '',
      ]);

      dataRow.height = 36;
      dataRow.eachCell((cell, colNum) => {
        cell.font = { name: '맑은 고딕', size: 16, bold: true };
        cell.alignment = {
          horizontal: colNum === 6 || colNum === 7 ? 'left' : 'center',
          vertical: 'middle',
          wrapText: true,
        };
        cell.border = thinBorder;
      });
    });

    return wb;
  }

  // === 예식일 (WMON): 날짜별 시트 분리 생성 ===
  const dateGroups = new Map();
  for (const row of aggregatedRows) {
    const rawDate = row['날짜'] || row['예식일'] || '';
    const sheetName = formatSheetName(rawDate);
    if (!dateGroups.has(sheetName)) {
      dateGroups.set(sheetName, []);
    }
    dateGroups.get(sheetName).push(row);
  }

  if (dateGroups.size === 0) {
    dateGroups.set('예식일', []);
  }

  for (const [sheetName, rows] of dateGroups.entries()) {
    const sheet = wb.addWorksheet(sheetName);

    sheet.columns = [
      { width: 6.0 },   // NO
      { width: 20.6 },  // 담당플래너
      { width: 15.8 },  // 신부명
      { width: 26.6 },  // 배송지
      { width: 11.9 },  // 배송시간
      { width: 55.6 },  // 발주부케
      { width: 35.6 },  // 부토니에
      { width: 125.6 }, // 특이사항
      { width: 24.6 },  // 예식장소
      { width: 11.9 },  // 예식시간
    ];

    // 1행: 날짜 헤더 타이틀 (예: "9/12(토)")
    const titleRow = sheet.addRow([formatDateTitle(sheetName)]);
    titleRow.height = 24;
    titleRow.getCell(1).font = { name: '맑은 고딕', size: 14, bold: true };
    titleRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

    // 2행: 헤더
    const headerRow = sheet.addRow([
      'NO', '담당플래너', '신부명', '배송지', '배송시간', '발주부케', '부토니에', '특이사항', '예식장소', '예식시간'
    ]);
    headerRow.height = 30;
    headerRow.eachCell((cell, colNum) => {
      cell.font = { name: '맑은 고딕', size: colNum === 1 ? 12 : 16, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = thinBorder;
    });

    // 3행~: 데이터 행
    rows.forEach((row, idx) => {
      const planner = row._site === 'swed' && !row['담당플래너']?.includes('S웨딩')
        ? `${row['담당플래너']}-S웨딩`
        : row['담당플래너'] || '';

      const dataRow = sheet.addRow([
        idx + 1,
        planner,
        cleanBrideName(row['신부명']),
        row['배송지'] || '',
        row['배송시간'] || '',
        row._cleanedBouquet || cleanBouquetName(row['발주부케']),
        row['부토니에'] || '',
        row['특이사항'] || '',
        row['예식장소'] || '',
        row['예식시간'] || '',
      ]);

      dataRow.height = 36;
      dataRow.eachCell((cell, colNum) => {
        cell.font = { name: '맑은 고딕', size: colNum === 1 ? 12 : 16, bold: true };
        cell.alignment = {
          horizontal: colNum === 6 || colNum === 8 ? 'left' : 'center',
          vertical: 'middle',
          wrapText: true,
        };
        cell.border = thinBorder;
      });
    });
  }

  return wb;
}

/**
 * 브라우저에서 엑셀 파일 다운로드 실행
 */
export async function downloadBaljuExcel(aggregatedRows, options = {}) {
  const wb = await createBaljuWorkbook(aggregatedRows, options);
  const buffer = await wb.xlsx.writeBuffer();

  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefix = options.orderType === 'RMON' ? '촬영용' : '발주체크';
  link.download = `${prefix}_오직블라썸_${dateStr}.xlsx`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
