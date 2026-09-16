// 사이트 표 구조가 바뀌면 먼저 이 선택자와 문구를 수정합니다.
// .클래스 선택자는 클래스 순서, 추가 클래스, HTML 따옴표 종류에 영향을 받지 않습니다.
const RULES = {
  list: {
    title: '발주현황',
    row: 'tr.ConteTR',
    product: 'td.ConteTD_L',
    price: 'td.ConteTD_R',
    status: 'td.ConteTD_End_C',
    pendingButton: 'button[name="idxno"]:not(:disabled), [onclick*="OrderRUN"]',
    orderLink: '[onclick*="OrderFax"], [href*="OrderFax"]',
    orderArgument: /\bOrderFax\s*\(\s*(['"])([\p{L}\p{N}_-]+)\1\s*[,)]/u,
    codeHeader: '발주코드',
    codeFormat: /^[\p{L}\p{N}_-]+$/u,
    confirmedText: /^(확인|확인완료)$/,
    pendingText: /^미확인$/,
  },
  detail: {
    root: 'body > div:nth-child(1)',
    bride: ':scope > table:nth-child(2) tr:nth-child(2) td:nth-child(2)',
    planner: ':scope > table:nth-child(2) tr:nth-child(1) td.tdEndLine',
    product: ':scope > table:nth-child(4) tr:nth-child(2) td:nth-child(3)',
    productRows: ':scope > table:nth-child(4) > tbody > tr',
    shipping: ':scope > table:nth-child(4) tr:nth-child(3) td:nth-child(2)',
    notes: ':scope > table:nth-child(5) tr td',
    WMON: {
      venue: ':scope > table:nth-child(3) tr:nth-child(1) td.tdEndLine',
      event: ':scope > table:nth-child(3) tr:nth-child(2) td.tdEndLine',
    },
    RMON: {
      venue: ':scope > table:nth-child(3) tr:nth-child(1) td.tdLine',
      event: ':scope > table:nth-child(3) tr:nth-child(2) td.tdLine',
    },
  },
};

// HTML은 분리된 문서에서 읽기만 합니다. 이벤트 코드나 버튼은 실행하지 않습니다.
export function parseOrderList(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rule = RULES.list;
  if (doc.title.trim() !== rule.title) {
    throw new Error('목록 조회 실패: 세션이 만료됐거나 응답 형식이 변경됐습니다.');
  }
  const rows = [...doc.querySelectorAll(rule.row)];
  if (!rows.length && (!doc.querySelector('table') || doc.querySelector(rule.orderLink))) {
    throw new Error('발주 목록의 행 구조를 읽지 못했습니다. 추출 규칙을 확인해 주세요.');
  }
  return rows.map((row, index) => {
    const status = row.querySelector(rule.status);
    const statusText = status?.textContent.replace(/\s+/g, '') || '';
    const pending = !!status?.querySelector(rule.pendingButton) || rule.pendingText.test(statusText);
    const confirmed = rule.confirmedText.test(statusText) && !pending;
    if (!status || (!pending && !confirmed)) {
      throw new Error('목록 ' + (index + 1) + '행의 확인 상태를 읽지 못했습니다. 추출 규칙을 확인해 주세요.');
    }

    // 화면의 몇 번째 셀인지 추측하지 않고, 상세 보기 요청의 발주코드를 읽습니다.
    const codes = new Set();
    for (const link of row.querySelectorAll(rule.orderLink)) {
      const call = link.getAttribute('onclick') || link.getAttribute('href') || '';
      const match = call.match(rule.orderArgument);
      if (match) codes.add(match[2]);
    }
    if (codes.size > 1) throw new Error('목록 ' + (index + 1) + '행의 발주코드가 서로 다릅니다.');
    let code = [...codes][0] || '';
    if (!code) {
      const header = [...(row.closest('table')?.rows || [])].find(candidate =>
        [...candidate.cells].some(cell => cell.textContent.replace(/\s+/g, '') === rule.codeHeader));
      const column = header ? [...header.cells].findIndex(cell => cell.textContent.replace(/\s+/g, '') === rule.codeHeader) : -1;
      if (column >= 0 && header.cells.length === row.cells.length) code = row.cells[column].textContent.trim();
    }
    const product = row.querySelector(rule.product)?.textContent.trim();
    const price = row.querySelector(rule.price)?.textContent.trim();
    if (!code || !rule.codeFormat.test(code) || !product || !price) {
      throw new Error('목록 ' + (index + 1) + '행의 발주코드·상품명·금액을 읽지 못했습니다. 추출 규칙을 확인해 주세요.');
    }
    return { code, product, price, confirmed };
  });
}

export function parseContract(html, order, type) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!/발\s*주\s*서/.test(doc.body.textContent)) {
    throw new Error('상세 발주서 형식이 아닙니다. 세션 만료 또는 사이트 변경을 확인해 주세요.');
  }
  const rule = RULES.detail;
  const root = doc.querySelector(rule.root);
  const bride = root?.querySelector(rule.bride);
  const product = root?.querySelector(rule.product);
  const event = root?.querySelector(rule[type].event);
  if (!bride || !product || !event || !bride.textContent.trim()) {
    throw new Error('발주서의 필수 항목을 읽지 못했습니다. 사이트의 표 구조 변경을 확인해 주세요.');
  }
  const text = (selector) => root.querySelector(selector)?.textContent.trim() || '';
  const productName = product.textContent.replace('수임료차감포함', '').trim();
  if (type === 'RMON' && !productName.includes('촬영')) return null;
  const eventText = event.textContent.trim();
  const eventDate = eventText.match(/(\d{4})-(\d{2})-(\d{2})/);
  const eventTime = eventText.match(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)(?:\s|$)/)?.[1] || '';
  const row = { 발주코드: order.code, 금액: order.price };
  {
    if (!eventDate) throw new Error('행사 날짜를 읽지 못했습니다.');
    const date = new Date(Number(eventDate[1]), Number(eventDate[2]) - 1, Number(eventDate[3]));
    if (date.getFullYear() !== Number(eventDate[1]) || date.getMonth() + 1 !== Number(eventDate[2]) || date.getDate() !== Number(eventDate[3])) {
      throw new Error('행사 날짜가 올바르지 않습니다.');
    }
    row['예식일'] = eventDate[0];
    row['날짜'] = eventDate[2] + '/' + eventDate[3] + '(' + '일월화수목금토'[date.getDay()] + ')';
  }
  row['담당플래너'] = text(rule.planner).split('/')[0].trim();
  row['신부명'] = bride.textContent.trim();
  const productRows = [...root.querySelectorAll(rule.productRows)];
  const totalRow = type === 'RMON'
    ? productRows.slice(1).find(item => item.cells[2]?.textContent.includes('토탈'))
    : productRows[2]?.cells[2]?.textContent.includes('토탈') ? productRows[2] : null;
  row['배송지'] = totalRow?.cells[1]?.textContent.trim() || text(rule.shipping);
  if (!totalRow) row['배송지'] += '(확인필요)';
  row['배송시간'] = '';
  row['발주부케'] = productName + ' - ' + order.price + '원';
  if (type !== 'RMON') row['부토니에'] = '';
  row['특이사항(기타사항)'] = text(rule.notes);
  row[type === 'RMON' ? '리허설장소' : '예식장소'] = text(rule[type].venue);
  row[type === 'RMON' ? '리허설시간' : '예식시간'] = eventTime;
  if (!eventTime) throw new Error('행사 시간을 읽지 못했습니다. 원본 발주서를 확인해 주세요.');
  return row;
}

