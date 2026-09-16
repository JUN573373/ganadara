import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';

export const SITES = {
  ini: {
    id: 'ini',
    name: '아이니',
    label: '아이니웨딩',
    baseUrl: 'https://prm.iniwedding.com',
    homeTitle: '아이니웨딩 PRM',
  },
  swed: {
    id: 'swed',
    name: 'S웨딩',
    label: 'S웨딩',
    baseUrl: 'https://prm.s-wed.co.kr',
    homeTitle: 'S웨딩 PRM',
  },
};

/**
 * 요청별 격리된 세션 및 HTTP 통신 관리자
 */
export class ScrapeSession {
  constructor(site) {
    this.site = typeof site === 'string' ? SITES[site] : site;
    if (!this.site) throw new Error(`지원하지 않는 기관입니다: ${site}`);
    this.cookieJar = new CookieJar();
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';
  }

  async request(method, path, body = null, retryCount = 1) {
    const url = path.startsWith('http') ? path : `${this.site.baseUrl}${path}`;
    let lastError = null;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        const cookieHeader = await this.cookieJar.getCookieString(url);
        const headers = {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Origin': this.site.baseUrl,
          'Referer': this.site.baseUrl + '/',
        };

        if (cookieHeader) {
          headers['Cookie'] = cookieHeader;
        }

        let requestBody = body;
        if (method.toUpperCase() === 'POST' && body) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
          if (typeof body === 'object' && !(body instanceof URLSearchParams) && typeof body.toString !== 'function') {
            requestBody = new URLSearchParams(body).toString();
          } else if (body instanceof URLSearchParams) {
            requestBody = body.toString();
          }
        }

        const response = await fetch(url, {
          method: method.toUpperCase(),
          headers,
          body: method.toUpperCase() === 'GET' ? undefined : requestBody,
          redirect: 'manual', // 수동 리다이렉트 처리로 Set-Cookie 보존
        });

        // Set-Cookie 처리
        const rawSetCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
        for (const cookieStr of rawSetCookies) {
          try {
            await this.cookieJar.setCookie(cookieStr, url);
          } catch {
            // 개별 쿠키 파싱 실패 무시
          }
        }

        // 301/302 리다이렉트 처리
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (location) {
            const nextUrl = new URL(location, url).toString();
            return await this.request('GET', nextUrl, null, retryCount);
          }
        }

        if (!response.ok && response.status !== 200) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const responseText = await response.text();
        return responseText;
      } catch (err) {
        lastError = err;
        if (attempt < retryCount) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }

    throw lastError || new Error(`통신 실패: ${url}`);
  }

  async login(id, password) {
    // 1. 메인 접속
    await this.request('GET', '/');

    // 2. 로그인 요청
    const loginBody = new URLSearchParams({
      mb_id: id,
      mb_password: password,
    }).toString();

    const loginRes = await this.request('POST', '/bbs/login_check.php?', loginBody);

    if (loginRes.includes('자동등록') || loginRes.includes('보안문자') || loginRes.includes('captcha')) {
      throw new Error(`${this.site.label} · 로그인 실패: 보안문자(CAPTCHA) 추가 인증이 요구됩니다.`);
    }

    if (!loginRes.includes("location.replace('/home')") && !loginRes.includes('location.replace("/home")')) {
      // alert 메시지 추출 시도
      const alertMatch = loginRes.match(/alert\s*\(\s*['"]([^'"]+)['"]\s*\)/);
      const reason = alertMatch ? alertMatch[1] : '계정 정보 불일치';
      throw new Error(`${this.site.label} · 로그인 실패: ${reason}`);
    }

    // 3. 홈 이동 확인
    const homeRes = await this.request('GET', '/home/');
    const $home = cheerio.load(homeRes);
    const homeTitle = $home('title').text().trim();
    if (!homeTitle.includes(this.site.homeTitle) && !homeTitle.includes('PRM')) {
      throw new Error(`${this.site.label} · 홈 진입 실패: 세션 쿠키가 저장되지 않았거나 페이지 구조가 변경되었습니다.`);
    }

    return true;
  }

  async testConnection(id, password) {
    await this.login(id, password);
    const listRes = await this.request('GET', '/Order/OrderList.php');
    const $ = cheerio.load(listRes);
    const title = $('title').text().trim();
    if (!title.includes('발주현황')) {
      throw new Error(`${this.site.label} · 발주현황 페이지 진입 실패`);
    }
    return { ok: true, message: `${this.site.label} 로그인 및 발주현황 진입 성공` };
  }

  async collectOrders({ orderType, startDate, endDate, onlyUnconfirmed = true, onLog = () => {}, signal = null }) {
    // 발주현황 접근
    const listInit = await this.request('GET', '/Order/OrderList.php');
    const $init = cheerio.load(listInit);
    if (!$init('title').text().includes('발주현황')) {
      throw new Error(`${this.site.label} · 발주현황 접근 실패`);
    }

    let paging = 1;
    this.failedCount = 0;
    const codeArr = [];
    const knownCodes = new Set();
    const pageSignatures = new Set();

    onLog('info', `${this.site.label} · 발주 목록 조회 시작 (${startDate} ~ ${endDate})`);

    while (true) {
      if (signal?.aborted) throw new Error('사용자에 의해 작업이 취소되었습니다.');

      const postOrderBody = new URLSearchParams({
        button_flag: '',
        sort: 'CP_PlacingDateTime',
        pages: String(paging),
        ContractPlacing_Code: '',
        OrderType: 'O',
        dateFrmName: '',
        idxno: '',
        ContractName: '',
        ShContractPlacing_Code: '',
        CP_GoodName: '',
        SearchMon: orderType,
        SDAY: startDate,
        EDAY: endDate,
      }).toString();

      const pageHtml = await this.request('POST', '/Order/OrderList.php', postOrderBody);
      const $page = cheerio.load(pageHtml);

      if (!$page('title').text().includes('발주현황')) {
        throw new Error(`${this.site.label} · 발주 목록 조회 중 세션 만료`);
      }

      const $rows = $page('tr.ConteTR');
      if ($rows.length === 0) {
        onLog('info', `${this.site.label} · ${paging}페이지: 데이터 없음 (목록 끝)`);
        break;
      }

      const signature = $rows.toArray().map(row => $page.html(row)).join('|');
      if (pageSignatures.has(signature)) throw new Error('동일 목록 페이지가 반복되어 수집을 중단했습니다.');
      pageSignatures.add(signature);

      let pageFoundCount = 0;
      let pageTargetCount = 0;
      let pageConfirmedSkipped = 0;

      for (let i = 0; i < $rows.length; i++) {
        if (signal?.aborted) throw new Error('사용자에 의해 작업이 취소되었습니다.');

        const $row = $rows.eq(i);
        pageFoundCount++;

        // 확인 상태 컬럼 체크
        const statusText = $row.find('td.ConteTD_End_C').text().trim();
        const hasPendingButton = $row.find('td.ConteTD_End_C button:not(:disabled), td.ConteTD_End_C [onclick*="OrderRUN"]').length > 0 || statusText.includes('미확인');
        const isConfirmed = /^(확인|확인완료)$/.test(statusText.replace(/\s+/g, '')) && !hasPendingButton;
        if (!hasPendingButton && !isConfirmed) throw new Error('발주 확인 상태를 읽지 못했습니다.');

        if (onlyUnconfirmed && isConfirmed) {
          pageConfirmedSkipped++;
          continue;
        }

        // RMON(리허설)인 경우 상품명에 '촬영'이 들어간 건만 필터
        if (orderType === 'RMON') {
          const productText = $row.find('td.ConteTD_L').text().trim();
          if (!productText.includes('촬영')) {
            continue;
          }
        }

        // 발주코드 추출 (OrderFax 호출 인자 또는 컬럼)
        let contCd = '';
        const orderLink = $row.find('[onclick*="OrderFax"], [href*="OrderFax"]').first();
        const orderFaxHtml = orderLink.attr('onclick') || orderLink.attr('href') || '';
        const matchFax = orderFaxHtml.match(/OrderFax\s*\(\s*['"]([^'"]+)['"]/);
        if (matchFax) {
          contCd = matchFax[1];
        } else {
          throw new Error('상세 보기의 발주코드를 읽지 못했습니다.');
        }

        const price = $row.find('td.ConteTD_R').text().trim();

        if (contCd && !knownCodes.has(contCd)) {
          knownCodes.add(contCd);
          codeArr.push({ contCd, price });
          pageTargetCount++;
        }
      }

      onLog('info', `${this.site.label} · ${paging}페이지 ${pageFoundCount}건 (대상 ${pageTargetCount}건 추가, 누적 ${codeArr.length}건)`);

      paging++;
      if (paging > 1000) throw new Error('최대 조회 페이지를 초과했습니다. 조회 기간을 줄여 주세요.');
    }

    onLog('info', `${this.site.label} · 상세 발주서 수집 대상 총 ${codeArr.length}건`);

    // 상세 발주서 조회
    const detailedOrders = [];
    for (let idx = 0; idx < codeArr.length; idx++) {
      if (signal?.aborted) throw new Error('사용자에 의해 작업이 취소되었습니다.');

      const item = codeArr[idx];
      const postDetailBody = new URLSearchParams({
        button_flag: '',
        sort: 'CP_PlacingDateTime',
        pages: '1',
        ContractPlacing_Code: item.contCd,
        OrderType: 'O',
        dateFrmName: '',
        idxno: '',
        ContractName: '',
        ShContractPlacing_Code: '',
        CP_GoodName: '',
        SearchMon: orderType,
        SDAY: startDate,
        EDAY: endDate,
      }).toString();

      try {
        const detailHtml = await this.request('POST', '/Order/ContractOptionFax_Fixed.php', postDetailBody);
        const parsed = this.parseContractDetail(detailHtml, item, orderType);
        if (parsed) {
          detailedOrders.push(parsed);
        }
      } catch (err) {
        this.failedCount++;
        onLog('warn', `${this.site.label} · [${item.contCd}] 상세 수집 실패: ${err.message}`);
      }

      if ((idx + 1) % 5 === 0 || idx === codeArr.length - 1) {
        onLog('info', `${this.site.label} · 상세 조회 진행률 (${idx + 1}/${codeArr.length})`);
      }
    }

    onLog('success', `${this.site.label} · 수집 완료 (총 ${detailedOrders.length}건)`);
    return detailedOrders;
  }

  parseContractDetail(html, order, type) {
    const $ = cheerio.load(html);
    if (!/발\s*주\s*서/.test($('body').text())) {
      throw new Error('상세 발주서 형식이 아닙니다.');
    }

    const result = { 발주코드: order.contCd, 금액: order.price };
    const eventCell = type === 'RMON' ? 'td.tdLine' : 'td.tdEndLine';
    const event = $(`body > div:nth-child(1) > table:nth-child(3) tr:nth-child(2) ${eventCell}`).text();
    const eventDate = event.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!eventDate) throw new Error('행사 날짜를 읽지 못했습니다.');
    const date = new Date(Number(eventDate[1]), Number(eventDate[2]) - 1, Number(eventDate[3]));
    if (date.getFullYear() !== +eventDate[1] || date.getMonth() + 1 !== +eventDate[2] || date.getDate() !== +eventDate[3]) {
      throw new Error('행사 날짜가 올바르지 않습니다.');
    }
    result['예식일'] = eventDate[0];
    result['날짜'] = `${eventDate[2]}/${eventDate[3]}(${'일월화수목금토'[date.getDay()]})`;
    const planner = $('body > div:nth-child(1) > table:nth-child(2) tr:nth-child(1) td.tdEndLine').text().split('/')[0].trim();
    const bride = $('body > div:nth-child(1) > table:nth-child(2) tr:nth-child(2) td:nth-child(2)').text().trim();
    const rawProduct = $('body > div:nth-child(1) > table:nth-child(4) tr:nth-child(2) td:nth-child(3)').text().replace('수임료차감포함', '').trim();
    const notes = $('body > div:nth-child(1) > table:nth-child(5) tr td').text().trim();

    if (type === 'RMON') {
      if (!rawProduct.includes('촬영')) return null;

      const eventText = $('body > div:nth-child(1) > table:nth-child(3) tr:nth-child(2) td.tdLine').text().trim();
      const parts = eventText.split(/\s+/);
      const dateStr = parts[0] || '';
      const timeStr = parts[1] || '';

      if (dateStr) {
        const d = new Date(dateStr);
        const dayOfWeek = '일월화수목금토'[d.getDay()] || '';
        result['날짜'] = ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2) + '(' + dayOfWeek + ')';
      } else {
        result['날짜'] = '';
      }

      result['담당플래너'] = planner;
      result['신부명'] = bride;

      // 배송지 확인
      let totalRowIdx = 0;
      for (let i = 2; i <= 9; i++) {
        const itemText = $(`body > div:nth-child(1) > table:nth-child(4) tr:nth-child(${i}) td:nth-child(3)`).text();
        if (itemText.includes('토탈')) {
          totalRowIdx = i;
          break;
        }
      }

      if (totalRowIdx === 0) {
        result['배송지'] = $('body > div:nth-child(1) > table:nth-child(4) tr:nth-child(3) td:nth-child(2)').text().trim() + '(확인필요)';
      } else {
        result['배송지'] = $(`body > div:nth-child(1) > table:nth-child(4) tr:nth-child(${totalRowIdx}) td:nth-child(2)`).text().trim();
      }

      result['배송시간'] = '';
      result['발주부케'] = rawProduct + ' - ' + order.price + '원';
      result['특이사항(기타사항)'] = notes;
      result['리허설장소'] = $('body > div:nth-child(1) > table:nth-child(3) tr:nth-child(1) td.tdLine').text().trim();
      result['리허설시간'] = timeStr;
    } else {
      // WMON (본식/예식일)
      result['담당플래너'] = planner;
      result['신부명'] = bride;

      const isTotal = $('body > div:nth-child(1) > table:nth-child(4) tr:nth-child(3) td:nth-child(3)').text();
      let shipping = $('body > div:nth-child(1) > table:nth-child(4) tr:nth-child(3) td:nth-child(2)').text().trim();
      if (!/본식|토탈/.test(isTotal)) {
        shipping += '(확인필요)';
      }
      result['배송지'] = shipping;
      result['배송시간'] = '';
      result['발주부케'] = rawProduct + ' - ' + order.price + '원';
      result['부토니에'] = '';
      result['특이사항(기타사항)'] = notes;
      result['예식장소'] = $('body > div:nth-child(1) > table:nth-child(3) tr:nth-child(1) td.tdEndLine').text().trim();

      const timeFull = $('body > div:nth-child(1) > table:nth-child(3) tr:nth-child(2) td.tdEndLine').text().trim();
      const timeParts = timeFull.split(/\s+/);
      result['예식시간'] = timeParts[1] || timeParts[0] || '';
    }

    return result;
  }
}
