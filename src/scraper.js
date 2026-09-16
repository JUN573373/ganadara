import { parseOrderList, parseContract } from './extraction.js';

export const SITES = [
  { id: 'ini', name: '아이니', label: '아이니웨딩', baseUrl: 'https://prm.iniwedding.com', homeTitle: '아이니웨딩 PRM' },
  { id: 'swed', name: 'S웨딩', label: 'S웨딩', baseUrl: 'https://prm.s-wed.co.kr', homeTitle: 'S웨딩 PRM' },
];

/**
 * 발주 수집 메인 함수:
 * 1. Vercel 서버리스 API (/api/scrape) 호출 및 SSE 실시간 스트리밍 수신
 * 2. API가 없는 오프라인/테스트 환경에서는 기존 브라우저 직접 요청으로 fallback
 */
export async function scrapeSite({ site, account, options, signal, log, onRow }) {
  try {
    return await scrapeViaServerlessApi({ site, account, options, signal, log, onRow });
  } catch (apiErr) {
    if (signal?.aborted || apiErr.name === 'AbortError') {
      throw apiErr;
    }
    // 404이거나 명시적 fallback인 경우 기존 브라우저 직접 수집 시도
    if (apiErr.isFallback || apiErr.message?.includes('404')) {
      return await scrapeDirectBrowser({ site, account, options, signal, log, onRow });
    }
    throw apiErr;
  }
}

/**
 * Vercel Serverless API (/api/scrape) SSE 스트리밍 수신
 */
async function scrapeViaServerlessApi({ site, account, options, signal, log, onRow }) {
  const payload = {
    sites: [site.id],
    accounts: {
      [site.id]: account,
    },
    options: {
      orderType: options.type,
      startDate: options.startDate,
      endDate: options.endDate,
      onlyUnconfirmed: options.onlyUnconfirmed,
    },
  };

  const response = await fetch('/api/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (response.status === 404) {
    const err = new Error('API 404 Not Found');
    err.isFallback = true;
    throw err;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`서버 수집 API 오류 (HTTP ${response.status}): ${errText || response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalDoneData = null;
  let currentEvent = 'message';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';


    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.slice(5).trim();
        try {
          const data = JSON.parse(dataStr);
          if (currentEvent === 'log') {
            log(data.level || 'info', data.message || '');
          } else if (currentEvent === 'done') {
            finalDoneData = data;
          } else if (currentEvent === 'error') {
            throw new Error(data.message || '서버 수집 오류');
          }
        } catch (parseErr) {
          if (currentEvent === 'error') throw parseErr;
        }
      }
    }
  }

  if (!finalDoneData) {
    throw new Error(`${site.label} · 서버에서 최종 수집 완료 응답을 받지 못했습니다.`);
  }

  const siteResults = finalDoneData.results?.[site.id] || [];
  for (const row of siteResults) {
    onRow(row);
  }

  return {
    total: siteResults.length,
    failed: finalDoneData.hasPartialError ? 1 : 0,
    skipped: 0,
  };
}

/**
 * 기존 브라우저 직접 요청 (테스트 모킹 환경용 fallback)
 */
async function scrapeDirectBrowser({ site, account, options, signal, log, onRow }) {
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
    let rows;
    try {
      rows = parseOrderList(html);
    } catch (error) {
      throw new Error(site.label + ' · 목록 ' + page + '페이지: ' + error.message);
    }
    if (!rows.length) {
      ended = true;
      log('info', site.label + ' · 마지막 목록 페이지에 도달했습니다.');
      break;
    }
    const signature = JSON.stringify(rows);
    if (pageSignatures.has(signature)) {
      throw new Error(site.label + ' · 같은 목록 페이지가 반복됩니다. 중복 수집을 막기 위해 중단했습니다.');
    }
    pageSignatures.add(signature);
    let excluded = 0;
    for (const row of rows) {
      if (options.onlyUnconfirmed && row.confirmed) {
        excluded++;
        continue;
      }
      if (options.type === 'RMON' && !row.product.includes('촬영')) continue;
      if (knownCodes.has(row.code)) {
        log('warn', site.label + ' · 앞서 수집한 발주코드와 겹치는 목록 행을 제외합니다.');
        continue;
      }
      knownCodes.add(row.code);
      orders.push(row);
    }
    if (excluded) log('info', site.label + ' · 확인 완료 ' + excluded + '건 제외, 다음 목록도 조회합니다.');
    log('info', site.label + ' · 상세 조회 대상 ' + orders.length + '건');
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
