export const SITES = [
  { id: 'ini', name: '아이니', label: '아이니웨딩', baseUrl: 'https://prm.iniwedding.com', homeTitle: '아이니웨딩 PRM' },
  { id: 'swed', name: 'S웨딩', label: 'S웨딩', baseUrl: 'https://prm.s-wed.co.kr', homeTitle: 'S웨딩 PRM' },
];

// 두 기관이 같은 발주서 구조를 사용하므로 파싱 규칙을 공유합니다.
export function parseContract(html, order, type) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!/발\s*주\s*서/.test(doc.body.textContent)) {
    throw new Error('상세 발주서 형식이 아닙니다. 세션 만료 또는 사이트 변경을 확인해 주세요.');
  }
  const root = doc.querySelector('body > div:nth-child(1)');
  const bride = root?.querySelector(':scope > table:nth-child(2) tr:nth-child(2) td:nth-child(2)');
  const product = root?.querySelector(':scope > table:nth-child(4) tr:nth-child(2) td:nth-child(3)');
  const event = root?.querySelector(type === 'RMON'
    ? ':scope > table:nth-child(3) tr:nth-child(2) td.tdLine'
    : ':scope > table:nth-child(3) tr:nth-child(2) td.tdEndLine');
  if (!bride || !product || !event || !bride.textContent.trim()) {
    throw new Error('발주서의 필수 항목을 읽지 못했습니다. 사이트의 표 구조 변경을 확인해 주세요.');
  }
  const text = (selector) => root.querySelector(selector)?.textContent.trim() || '';
  const productName = product.textContent.replace('수임료차감포함', '').trim();
  if (type === 'RMON' && !productName.includes('촬영')) return null;
  const eventText = event.textContent.trim();
  const eventDate = eventText.match(/(\d{4})-(\d{2})-(\d{2})/);
  const eventTime = eventText.match(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)(?:\s|$)/)?.[1] || '';
  const row = { 발주코드: order.code };
  if (type === 'RMON') {
    if (!eventDate) throw new Error('리허설 날짜를 읽지 못했습니다.');
    const date = new Date(Number(eventDate[1]), Number(eventDate[2]) - 1, Number(eventDate[3]));
    if (date.getFullYear() !== Number(eventDate[1]) || date.getMonth() + 1 !== Number(eventDate[2]) || date.getDate() !== Number(eventDate[3])) {
      throw new Error('리허설 날짜가 올바르지 않습니다.');
    }
    row['날짜'] = eventDate[2] + '/' + eventDate[3] + '(' + '일월화수목금토'[date.getDay()] + ')';
  }
  row['담당플래너'] = text(':scope > table:nth-child(2) tr:nth-child(1) td.tdEndLine').split('/')[0].trim();
  row['신부명'] = bride.textContent.trim();
  let totalRow = 0;
  if (type === 'RMON') {
    for (let index = 2; index <= 9; index++) {
      if (text(':scope > table:nth-child(4) tr:nth-child(' + index + ') td:nth-child(3)').includes('토탈')) {
        totalRow = index;
        break;
      }
    }
  } else if (text(':scope > table:nth-child(4) tr:nth-child(3) td:nth-child(3)').includes('토탈')) {
    totalRow = 3;
  }
  row['배송지'] = text(':scope > table:nth-child(4) tr:nth-child(' + (totalRow || 3) + ') td:nth-child(2)');
  if (!totalRow) row['배송지'] += '(확인필요)';
  row['배송시간'] = '';
  row['발주부케'] = productName + ' - ' + order.price + '원';
  if (type !== 'RMON') row['부토니에'] = '';
  row['특이사항(기타사항)'] = text(':scope > table:nth-child(5) tr td');
  row[type === 'RMON' ? '리허설장소' : '예식장소'] = text(type === 'RMON'
    ? ':scope > table:nth-child(3) tr:nth-child(1) td.tdLine'
    : ':scope > table:nth-child(3) tr:nth-child(1) td.tdEndLine');
  row[type === 'RMON' ? '리허설시간' : '예식시간'] = eventTime;
  if (!eventTime) throw new Error('행사 시간을 읽지 못했습니다. 원본 발주서를 확인해 주세요.');
  return row;
}

export async function scrapeSite({ site, account, options, signal, log, onRow }) {
  // 단계별 요청의 시간 제한·오류 처리를 한곳에서 공유합니다.
  const request = async (stage, path, body) => {
    signal.throwIfAborted();
    log('info', site.label + ' · ' + stage);
    const timeout = AbortSignal.timeout(30000);
    try {
      const response = await fetch(site.baseUrl + path, {
        method: body ? 'POST' : 'GET',
        body,
        mode: 'cors',
        credentials: 'include',
        redirect: 'follow',
        signal: AbortSignal.any([signal, timeout]),
      });
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' 응답입니다. 기관 접근 권한이나 서버 상태를 확인해 주세요.');
      }
      const html = await response.text();
      if (!html.trim()) throw new Error('기관에서 빈 응답을 받았습니다.');
      return html;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (timeout.aborted) throw new Error(site.label + ' · ' + stage + ': 응답 대기 시간 30초를 초과했습니다.');
      if (error instanceof TypeError) {
        throw new Error(site.label + ' · ' + stage + ': 브라우저에서 응답을 읽지 못했습니다. CORS·쿠키 정책, 네트워크 또는 인증서 문제가 원인일 수 있습니다. 개발자 도구의 네트워크·콘솔에서 확인해 주세요.');
      }
      throw new Error(site.label + ' · ' + stage + ': ' + error.message);
    }
  };

  await request('기관 접속', '/');
  const loginHtml = await request('로그인 요청', '/bbs/login_check.php?', new URLSearchParams({
    mb_id: account.id,
    mb_password: account.password,
  }));
  if (/자동등록|보안문자|captcha/i.test(loginHtml) && !/location\.replace\s*\(\s*['"]\/home/.test(loginHtml)) {
    throw new Error(site.label + ' · 로그인: 보안문자 등 추가 인증이 요구됩니다.');
  }
  const loginDocument = new DOMParser().parseFromString(loginHtml, 'text/html');
  if (!/location\.replace\s*\(\s*['"]\/home/.test(loginHtml) && loginDocument.title.trim() !== site.homeTitle) {
    throw new Error(site.label + ' · 로그인 실패: 계정 정보 또는 기관의 로그인 응답 변경을 확인해 주세요.');
  }
  const home = new DOMParser().parseFromString(await request('로그인 응답 확인', '/home/'), 'text/html');
  if (home.title.trim() !== site.homeTitle) {
    throw new Error(site.label + ' · 로그인 실패: 계정 정보, 세션 쿠키 차단 또는 기관의 로그인 화면 변경을 확인해 주세요.');
  }
  log('success', site.label + ' · 로그인 요청 처리 완료');

  const initialList = new DOMParser().parseFromString(await request('발주현황 열기', '/Order/OrderList.php'), 'text/html');
  if (initialList.title.trim() !== '발주현황') {
    throw new Error(site.label + ' · 발주현황 접근 실패: 로그인 세션 또는 발주 조회 권한을 확인해 주세요.');
  }
  const params = {
    button_flag: '', sort: 'CP_PlacingDateTime', pages: '1',
    ContractPlacing_Code: '', OrderType: 'O', dateFrmName: '', idxno: '',
    ContractName: '', ShContractPlacing_Code: '', CP_GoodName: '',
    SearchMon: options.type, SDAY: options.startDate, EDAY: options.endDate,
  };
  const orders = [];
  const knownCodes = new Set();
  const pageSignatures = new Set();
  let ended = false;
  for (let page = 1; page <= 1000; page++) {
    const html = await request('목록 ' + page + '페이지 조회', '/Order/OrderList.php', new URLSearchParams({ ...params, pages: String(page) }));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.title.trim() !== '발주현황') throw new Error(site.label + ' · 목록 조회 실패: 세션이 만료됐거나 응답 형식이 변경됐습니다.');
    const rows = [...doc.querySelectorAll('tr.ConteTR')];
    if (!rows.length) {
      ended = true;
      log('info', site.label + ' · 마지막 목록 페이지에 도달했습니다.');
      break;
    }
    const signature = rows.map((row) => row.textContent.trim()).join('\n');
    if (pageSignatures.has(signature)) {
      throw new Error(site.label + ' · 같은 목록 페이지가 반복됩니다. 중복 수집을 막기 위해 중단했습니다.');
    }
    pageSignatures.add(signature);
    for (const row of rows) {
      const status = row.querySelector('td.ConteTD_End_C')?.textContent.trim();
      if (!status) throw new Error(site.label + ' · 목록의 확인 상태를 읽지 못했습니다. 표 구조를 확인해 주세요.');
      // "미확인"은 미처리 발주이므로 확인 완료와 구분합니다.
      if (options.onlyUnconfirmed && status.includes('확인') && !/미\s*확인/.test(status)) {
        ended = true;
        log('info', site.label + ' · 확인 완료 발주를 만나 목록 수집을 종료합니다.');
        break;
      }
      const item = row.querySelector('td.ConteTD_L')?.textContent || '';
      if (options.type === 'RMON' && !item.includes('촬영')) continue;
      const code = row.querySelectorAll('td.ConteTD_C')[1]?.textContent.trim();
      const price = row.querySelector('td.ConteTD_R')?.textContent.trim();
      if (!code || !price) throw new Error(site.label + ' · 발주코드 또는 금액을 읽지 못했습니다.');
      if (knownCodes.has(code)) {
        log('warn', site.label + ' · 앞서 수집한 발주코드와 겹치는 목록 행을 제외합니다.');
        continue;
      }
      knownCodes.add(code);
      orders.push({ code, price });
    }
    log('info', site.label + ' · 상세 조회 대상 ' + orders.length + '건');
    if (ended) break;
  }
  if (!ended) throw new Error(site.label + ' · 목록이 1,000페이지를 넘어 중단했습니다. 조회 기간을 줄여 주세요.');
  let failed = 0;
  let skipped = 0;
  for (let index = 0; index < orders.length; index++) {
    signal.throwIfAborted();
    const order = orders[index];
    const html = await request('상세 발주서 ' + (index + 1) + '/' + orders.length, '/Order/ContractOptionFax_Fixed.php', new URLSearchParams({ ...params, ContractPlacing_Code: order.code }));
    try {
      const row = parseContract(html, order, options.type);
      if (row) {
        onRow(row);
        log('success', site.label + ' · 상세 ' + (index + 1) + '/' + orders.length + ' 정리 완료');
      } else {
        skipped++;
        log('info', site.label + ' · 상세 ' + (index + 1) + '은 촬영 상품이 아니어서 제외합니다.');
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      failed++;
      log('error', site.label + ' · 상세 ' + (index + 1) + '/' + orders.length + ' 실패: ' + error.message);
    }
  }
  if (!orders.length) log('info', site.label + ' · 조회 조건에 해당하는 발주가 없습니다.');
  return { total: orders.length, failed, skipped };
}
