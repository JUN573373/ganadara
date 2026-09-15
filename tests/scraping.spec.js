import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';

const orderRow = (code, status = '미확인', product = '촬영 부케') =>
  '<tr class="ConteTR"><td class="ConteTD_C">1</td><td class="ConteTD_C">' + code +
  '</td><td class="ConteTD_L">' + product + '</td><td class="ConteTD_R">90,000</td><td class="ConteTD_End_C">' + status + '</td></tr>';
const list = (rows = '') => '<title>발주현황</title><table>' + rows + '</table>';
const contract = (product = '본식 부케', total = '토탈', date = '2026-09-12', bride = '가상신부') =>
  '<body><div><h1>발   주   서</h1>' +
  '<table><tr><td class="tdEndLine">가상플래너 / 연락처</td></tr><tr><td>신부</td><td>' + bride + '</td></tr></table>' +
  '<table><tr><td class="tdLine">가상스튜디오</td><td class="tdEndLine">가상예식장</td></tr>' +
  '<tr><td class="tdLine">' + date + ' 10:30</td><td class="tdEndLine">' + date + ' 13:00</td></tr></table>' +
  '<table><tr><td>상품</td></tr><tr><td></td><td></td><td>' + product + ' 수임료차감포함</td></tr>' +
  '<tr><td></td><td>가상배송지</td><td>' + total + '</td></tr></table>' +
  '<table><tr><td>가상 메모 &amp; 안내\n=SUM(1,2)</td></tr></table></div></body>';

// 모든 외부 요청을 가로채므로 기관 서버에 테스트 요청이나 계정이 전달되지 않습니다.
async function mockSites(page, options = {}) {
  const calls = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4188') return route.continue();
    if (!['prm.iniwedding.com', 'prm.s-wed.co.kr'].includes(url.hostname)) return route.abort();
    const params = new URLSearchParams(request.postData() || '');
    calls.push({ host: url.hostname, path: url.pathname, method: request.method(), params });
    if (options.networkError) return route.abort('failed');
    if (options.httpError) return route.fulfill({ status: options.httpError, body: '오류' });
    let body = '<title>기관 로그인</title>';
    if (url.pathname === '/bbs/login_check.php') body = options.loginFail
      ? '<script>alert("계정 오류");</script>'
      : '<script>location.replace("/home");</script>';
    if (url.pathname === '/home/') body = '<title>' + (options.expired ? '기관 로그인' : url.hostname.includes('iniwedding') ? '아이니웨딩 PRM' : 'S웨딩 PRM') + '</title>';
    if (url.pathname === '/Order/OrderList.php') {
      body = list();
      if (request.method() === 'POST') {
        const pageNo = Number(params.get('pages'));
        body = options.repeat ? list(orderRow('반복코드')) : list(options.pages?.[pageNo - 1] || '');
      }
    }
    if (url.pathname === '/Order/ContractOptionFax_Fixed.php') {
      const code = params.get('ContractPlacing_Code');
      if (options.holdCode === code) await options.hold;
      if (options.detailNetworkCode === code) return route.abort('failed');
      body = options.details?.[code] ?? contract();
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
  return calls;
}

async function fillForm(page, { both = false, type = 'WMON' } = {}) {
  await page.goto('/');
  await page.locator('#ini-id').fill('가상계정+아이니');
  await page.locator('#ini-password').fill('가상비밀번호&=123');
  if (both) {
    await page.locator('input[value="swed"]').check();
    await page.locator('#swed-id').fill('가상계정+에스');
    await page.locator('#swed-password').fill('가상암호&=456');
  }
  await page.locator('#order-type').selectOption(type);
  await page.locator('#start-date').fill('2026-09-12');
  await page.locator('#end-date').fill('2026-09-12');
}

async function readDownload(page, testInfo) {
  const pending = page.waitForEvent('download');
  await page.locator('#download-button').click();
  const download = await pending;
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return { workbook, name: download.suggestedFilename() };
}

test('일반·다크모드, 모바일 배치, 단일 글꼴과 초기 요청 없음', async ({ page }, testInfo) => {
  const calls = await mockSites(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#swed-id')).toBeDisabled();
  await expect(page.locator('#logs')).toContainText('준비되었습니다');
  expect(calls).toHaveLength(0);
  expect(await page.locator('.header').evaluate(el => el.getBoundingClientRect().height)).toBe(62);
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--accent').trim())).toBe('#b9e0fd');
  await page.screenshot({ path: testInfo.outputPath('일반모드.png'), fullPage: true });
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('다크모드.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const styles = await page.evaluate(() => [...document.querySelectorAll('body *')].map(el => {
    const style = getComputedStyle(el);
    return { font: style.fontFamily, animation: style.animationName, id: el.id };
  }));
  expect([...new Set(styles.map(x => x.font))]).toEqual(['system-ui']);
  expect(styles.filter(x => x.animation !== 'none').every(x => x.id === 'start-spinner')).toBe(true);
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#start-button')).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath('모바일.png'), fullPage: true });
});

test('두 기관 본식 수집과 엑셀의 실제 값·시트·파일명', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const calls = await mockSites(page, { pages: [orderRow('본식01') + orderRow('확인01', '확인')] });
  await fillForm(page, { both: true });
  expect(calls).toHaveLength(0);
  await page.locator('#start-button').click();
  await expect(page.locator('#run-status')).toHaveText('수집 완료');
  await expect(page.locator('#row-count')).toHaveText('수집 2건');
  const log = await page.locator('#logs').innerText();
  expect(log).not.toContain('가상계정');
  expect(log).not.toContain('가상비밀번호');
  await expect(page.locator('#ini-password')).toHaveValue('');
  await expect(page.locator('#swed-password')).toHaveValue('');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  const logins = calls.filter(x => x.path === '/bbs/login_check.php');
  expect(logins).toHaveLength(2);
  expect(logins[0].params.get('mb_id')).toBe('가상계정+아이니');
  expect(logins[0].params.get('mb_password')).toBe('가상비밀번호&=123');
  expect(logins[1].params.get('mb_id')).toBe('가상계정+에스');
  const query = calls.find(x => x.path === '/Order/OrderList.php' && x.method === 'POST');
  expect(Object.fromEntries(query.params)).toMatchObject({ SearchMon: 'WMON', SDAY: '2026-09-12', EDAY: '2026-09-12' });
  expect(calls.filter(x => x.path.includes('Fixed'))).toHaveLength(2);
  const { workbook, name } = await readDownload(page, testInfo);
  expect(name).toBe('예식일_2026-09-12_to_2026-09-12.xlsx');
  expect(workbook.worksheets.map(x => x.name)).toEqual(['아이니', 'S웨딩']);
  for (const sheet of workbook.worksheets) {
    expect(sheet.getRow(2).values.slice(1)).toEqual(['본식01', '가상플래너', '가상신부', '가상배송지', '', '본식 부케 - 90,000원', '', '가상 메모 & 안내\n=SUM(1,2)', '가상예식장', '13:00']);
    expect(sheet.getCell('H2').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getRow(1).font.bold).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('촬영 필터·페이지 순회·중복 제외와 촬영 엑셀', async ({ page }, testInfo) => {
  const calls = await mockSites(page, {
    pages: [orderRow('촬영01') + orderRow('본식01', '미확인', '본식'), orderRow('촬영01') + orderRow('제외01')],
    details: { '촬영01': contract('촬영 부케', '개별'), '제외01': contract('본식 부케') },
  });
  await fillForm(page, { type: 'RMON' });
  await page.locator('#start-button').click();
  await expect(page.locator('#run-status')).toHaveText('수집 완료');
  await expect(page.locator('#row-count')).toHaveText('수집 1건');
  expect(calls.filter(x => x.path.includes('Fixed')).map(x => x.params.get('ContractPlacing_Code'))).toEqual(['촬영01', '제외01']);
  expect(calls.filter(x => x.path.includes('OrderList') && x.method === 'POST').map(x => x.params.get('pages'))).toEqual(['1', '2', '3']);
  await expect(page.locator('#logs')).toContainText('겹치는 목록 행');
  await expect(page.locator('#logs')).toContainText('촬영 상품이 아니어서 제외');
  const { workbook, name } = await readDownload(page, testInfo);
  expect(name).toBe('촬영용_2026-09-12_to_2026-09-12.xlsx');
  expect(workbook.worksheets[0].getRow(2).values.slice(1)).toEqual(['촬영01', '09/12(토)', '가상플래너', '가상신부', '가상배송지(확인필요)', '', '촬영 부케 - 90,000원', '가상 메모 & 안내\n=SUM(1,2)', '가상스튜디오', '10:30']);
});

test('확인 완료 발주 포함 설정', async ({ page }) => {
  const calls = await mockSites(page, { pages: [orderRow('확인01', '확인')] });
  await fillForm(page);
  await page.locator('#only-unconfirmed').uncheck();
  await page.locator('#start-button').click();
  await expect(page.locator('#run-status')).toHaveText('수집 완료');
  expect(calls.filter(x => x.path.includes('Fixed'))).toHaveLength(1);
});

for (const [name, options, message] of [
  ['로그인 거절', { loginFail: true }, '로그인 실패'],
  ['세션 실패', { expired: true }, '세션 쿠키 차단'],
  ['HTTP 오류', { httpError: 503 }, 'HTTP 503'],
  ['네트워크 오류', { networkError: true }, 'CORS·쿠키 정책'],
  ['반복 목록', { repeat: true }, '같은 목록 페이지가 반복'],
]) {
  test(name + '의 원인 표시와 입력 복구', async ({ page }) => {
    await mockSites(page, options);
    await fillForm(page);
    await page.locator('#start-button').click();
    await expect(page.locator('#run-status')).toHaveText('수집 실패');
    await expect(page.locator('#logs')).toContainText(message);
    await expect(page.locator('#start-button')).toBeEnabled();
    await expect(page.locator('#ini-password')).toHaveValue('');
    await expect(page.locator('#result-panel')).toBeHidden();
  });
}

test('빈 결과는 정상 완료로 표시하고 파일을 만들지 않음', async ({ page }) => {
  await mockSites(page);
  await fillForm(page);
  await page.locator('#start-button').click();
  await expect(page.locator('#run-status')).toHaveText('수집 완료');
  await expect(page.locator('#logs')).toContainText('조회 조건에 해당하는 발주가 없어');
  await expect(page.locator('#result-panel')).toBeHidden();
});

test('날짜 및 기관 선택 검증과 기본 날짜 계산', async ({ page }) => {
  const calls = await mockSites(page);
  await fillForm(page);
  await page.locator('#date-preset').selectOption('today');
  const today = await page.evaluate(() => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  });
  await expect(page.locator('#start-date')).toHaveValue(today);
  await expect(page.locator('#end-date')).toHaveValue(today);
  await page.locator('#start-date').fill('2026-09-13');
  await page.locator('#end-date').fill('2026-09-12');
  await expect(page.locator('#date-preset')).toHaveValue('custom');
  await page.locator('#start-button').click();
  await expect(page.locator('#form-error')).toContainText('올바른 순서');
  await page.locator('input[value="ini"]').uncheck();
  await page.locator('#start-button').click();
  await expect(page.locator('#form-error')).toContainText('하나 이상');
  expect(calls).toHaveLength(0);
});

test('발주서 구조 오류는 일부 결과와 수집현황 시트에 표시', async ({ page }, testInfo) => {
  await mockSites(page, { pages: [orderRow('정상01') + orderRow('오류01')], details: { '오류01': '<p>변경된 화면</p>' } });
  await fillForm(page);
  await page.locator('#start-button').click();
  await expect(page.locator('#run-status')).toHaveText('일부 수집');
  await expect(page.locator('#logs')).toContainText('상세 발주서 형식이 아닙니다');
  const { workbook, name } = await readDownload(page, testInfo);
  expect(name).toContain('_일부수집.xlsx');
  expect(workbook.getWorksheet('수집현황').getCell('B2').value).toBe('일부 실패');
  expect(workbook.getWorksheet('수집현황').getCell('C2').value).toBe(1);
});

test('통신 실패 이후 상세 요청 중단과 기존 수집 결과 보존', async ({ page }, testInfo) => {
  const calls = await mockSites(page, {
    pages: [orderRow('정상01') + orderRow('통신02') + orderRow('대기03')],
    detailNetworkCode: '통신02',
  });
  await fillForm(page);
  await page.locator('#start-button').click();
  await expect(page.locator('#run-status')).toHaveText('일부 수집');
  expect(calls.filter(x => x.path.includes('Fixed')).map(x => x.params.get('ContractPlacing_Code'))).toEqual(['정상01', '통신02']);
  const { workbook } = await readDownload(page, testInfo);
  expect(workbook.getWorksheet('아이니').rowCount).toBe(2);
  expect(workbook.getWorksheet('수집현황').getCell('B2').value).toBe('실패');
});

test('실시간 로그·로딩·중지와 일부 결과 다운로드', async ({ page }, testInfo) => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const calls = await mockSites(page, {
    pages: [orderRow('정상01') + orderRow('대기02')], holdCode: '대기02', hold,
  });
  await fillForm(page, { both: true });
  await page.locator('#start-button').click();
  await expect(page.locator('#logs')).toContainText('상세 발주서 2/2');
  await expect(page.locator('#row-count')).toHaveText('수집 1건');
  await expect(page.locator('#start-spinner')).toBeVisible();
  await expect(page.locator('#ini-id')).toBeDisabled();
  await expect(page.locator('#cancel-button')).toBeEnabled();
  await page.locator('#cancel-button').click();
  await expect(page.locator('#run-status')).toHaveText('수집 중지');
  release();
  await expect(page.locator('#start-spinner')).toBeHidden();
  await expect(page.locator('#ini-id')).toBeEnabled();
  expect(calls.some(x => x.host === 'prm.s-wed.co.kr')).toBe(false);
  await expect(page.locator('#swed-password')).toHaveValue('');
  const { workbook } = await readDownload(page, testInfo);
  expect(workbook.getWorksheet('수집현황').getCell('B3').value).toBe('대기');
  await page.locator('#clear-logs').click();
  await expect(page.locator('#logs')).toBeEmpty();
  await expect(page.locator('#log-count')).toHaveText('0');
});
