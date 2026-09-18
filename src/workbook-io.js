import ExcelJS from 'exceljs';

// 화면에서 사용하는 JSON을 숨김 시트에 보존합니다. 계정·로그인 세션은 저장하지 않습니다.
export function attachWorkspaceMetadata(wb, rows, options) {
  const meta = wb.addWorksheet('_발주정보', { state: 'veryHidden' });
  meta.addRow(['발주작업', 1]);
  meta.addRow(['__설정', 0, JSON.stringify({ options: options.workspaceOptions || { type: options.orderType || 'WMON' }, config: options.config })]);
  for (const row of [...rows, ...(options.originalData ? [{ _rowId: '__원본', data: options.originalData }] : [])]) {
    const json = JSON.stringify(row);
    for (let offset = 0; offset < json.length; offset += 30000) {
      meta.addRow([row._rowId, offset / 30000, json.slice(offset, offset + 30000)]);
    }
  }
}

// 수식은 실행하지 않고 저장된 결과만 읽습니다.
function cellText(cell) {
  const value = cell.value;
  if (value == null) return '';
  if (value instanceof Date) return /h/i.test(cell.numFmt || '')
    ? value.toISOString().slice(11, 16) : value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return String(value);
  if (value.richText) return value.richText.map(part => part.text).join('');
  if (value.formula || value.sharedFormula) return value.result == null ? '' : String(value.result);
  return value.text || '';
}

export async function importWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const meta = wb.getWorksheet('_발주정보');
  const snapshots = new Map();
  let settings = {};
  if (meta) {
    if (meta.getCell('A1').value !== '발주작업' || meta.getCell('B1').value !== 1) {
      throw new Error('지원하지 않는 엑셀 작업정보 버전입니다.');
    }
    const chunks = new Map();
    meta.eachRow((row, index) => {
      if (index === 1) return;
      const id = cellText(row.getCell(1));
      if (id === '__설정') { settings = JSON.parse(cellText(row.getCell(3))); return; }
      if (!chunks.has(id)) chunks.set(id, []);
      chunks.get(id)[Number(row.getCell(2).value)] = cellText(row.getCell(3));
    });
    for (const [id, parts] of chunks) snapshots.set(id, JSON.parse(parts.join('')));
  }
  const rows = [];
  const seen = new Set();
  let unmapped = 0;
  let orderType = settings.options?.type;
  for (const sheet of wb.worksheets) {
    if (sheet.name === '_발주정보') continue;
    let headerIndex = 0;
    const columns = new Map();
    for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
      const names = [];
      sheet.getRow(r).eachCell((cell, column) => { names[column] = cellText(cell).trim(); });
      if (names.includes('신부명') && names.includes('발주부케')) {
        headerIndex = r;
        names.forEach((name, col) => { if (name) columns.set(name, col); });
        break;
      }
    }
    if (!headerIndex) continue;
    const shoot = columns.has('리허설장소');
    const detectedType = shoot ? 'RMON' : 'WMON';
    if (orderType && orderType !== detectedType) throw new Error('본식과 촬영이 함께 있는 파일은 유형별로 나누어 올려 주세요.');
    orderType = detectedType;
    for (let r = headerIndex + 1; r <= sheet.rowCount; r++) {
      const source = sheet.getRow(r);
      const read = name => columns.has(name) ? cellText(source.getCell(columns.get(name))) : '';
      if (!read('신부명').trim()) continue;
      const id = read('__발주ID');
      if (id && seen.has(id)) throw new Error('동일한 발주 식별자가 중복되었습니다. 복제된 행을 확인해 주세요.');
      if (id) seen.add(id);
      const snapshot = snapshots.get(id);
      if (!snapshot) unmapped++;
      const row = { ...snapshot };
      row._rowId = id || crypto.randomUUID();
      row._key = row._rowId;
      row._originalOrders = snapshot?._originalOrders || [];
      row._sources = snapshot?._sources || [];
      for (const field of ['담당플래너', '신부명', '배송지', '배송시간', '부토니에', '예식장소', '예식시간', '리허설장소', '리허설시간']) {
        if (columns.has(field)) row[field] = read(field);
      }
      row['특이사항'] = read('특이사항') || read('특이사항(기타사항)');
      row['특이사항(기타사항)'] = row['특이사항'];
      row['추가사항'] = read('추가사항');
      // B가 추가한 제목 있는 열도 버리지 않고 추가사항에 반영합니다.
      const known = new Set(['NO','날짜','예식일','담당플래너','신부명','배송지','배송시간','발주부케','부토니에','특이사항','특이사항(기타사항)','예식장소','예식시간','리허설장소','리허설시간','추가사항','__발주ID','금액','발주코드']);
      for (const name of columns.keys()) {
        if (!known.has(name) && read(name)) row['추가사항'] += (row['추가사항'] ? '\n' : '') + name + ': ' + read(name);
      }
      const bouquet = read('발주부케');
      const amount = bouquet.match(/\n합계\s*([\d,]+)원\s*$/);
      row._cleanedBouquet = bouquet.replace(/\n합계\s*(?:[\d,]+원|금액 확인필요)\s*$/, '');
      if (amount) {
        row['금액'] = Number(amount[1].replaceAll(',', ''));
        row._amountText = row['금액'].toLocaleString('ko-KR') + '원';
        row._isAggregated = true;
      }
      row['발주부케'] = snapshot?.['발주부케'] || row._cleanedBouquet;
      row._amountText ||= '금액 확인필요';
      const date = read('날짜') || read('예식일') || cellText(sheet.getCell('A1')).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        row['예식일'] = date;
        row['날짜'] = date;
      } else if (/^\d{1,2}[/.]\d{1,2}\s*\([일월화수목금토]\)$/.test(date)) {
        row['날짜'] = date.replace('.', '/');
        const prior = snapshot?.['예식일']?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const current = row['날짜'].match(/^(\d{1,2})\/(\d{1,2})/);
        if (!prior || +prior[2] !== +current[1] || +prior[3] !== +current[2]) row['예식일'] = '';
      } else if (!row['날짜']) {
        row['날짜'] = '';
      }
      row._needsCheck = String(row['배송지'] || '').includes('확인필요') || !row['날짜'];
      const modified = ['신부명', '날짜', '배송지', '배송시간', '_cleanedBouquet', '추가사항'].some(key => row[key] !== snapshot?.[key]);
      if (modified) delete row._deliveryDraft;
      rows.push(row);
      if (rows.length > 20000) throw new Error('한 번에 20,000행까지 열 수 있습니다.');
    }
  }
  if (!rows.length) throw new Error('신부명·발주부케 열이 있는 발주체크 엑셀을 선택해 주세요.');
  return { format: 'ozic-workspace', version: 1, rows,
    options: { ...settings.options, type: orderType }, config: settings.config,
    originalData: snapshots.get('__원본')?.data,
    importNotice: unmapped ? `${unmapped}행은 원본 식별 정보가 없어 향후 기관 확인 처리와 연결할 수 없습니다. 편집·문자 생성은 가능합니다.` : '' };
}
