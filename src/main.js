import './style.css';
import { SITES, scrapeSite } from './scraper.js';

const form = document.querySelector('#scrape-form');
const settings = document.querySelector('#settings');
const startButton = document.querySelector('#start-button');
const cancelButton = document.querySelector('#cancel-button');
const status = document.querySelector('#run-status');
const progress = document.querySelector('#progress-text');
const logs = document.querySelector('#logs');
const errorBox = document.querySelector('#form-error');
const resultPanel = document.querySelector('#result-panel');
const downloadButton = document.querySelector('#download-button');
const startDate = document.querySelector('#start-date');
const endDate = document.querySelector('#end-date');
let controller = null;
let results = [];
let runOptions = null;
let redactions = [];

function log(level, message) {
  for (const secret of redactions) {
    if (secret) message = message.split(secret).join('[숨김]');
  }
  const line = document.createElement('div');
  line.className = 'log-line';
  line.dataset.level = level;
  const time = document.createElement('span');
  time.className = 'log-time';
  const now = new Date();
  time.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()].map(value => String(value).padStart(2, '0')).join(':');
  const tag = document.createElement('span');
  tag.className = 'log-level';
  tag.textContent = { info: '안내', success: '완료', warn: '주의', error: '오류' }[level];
  const text = document.createElement('span');
  text.className = 'log-message';
  text.textContent = message;
  line.append(time, tag, text);
  logs.append(line);
  if (logs.children.length > 1000) logs.firstElementChild.remove();
  document.querySelector('#log-count').textContent = String(logs.children.length);
  progress.textContent = message;
  if (document.querySelector('#auto-scroll').checked) logs.scrollTop = logs.scrollHeight;
}

function setPreset() {
  const preset = document.querySelector('#date-preset').value;
  if (preset === 'custom') return;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  if (preset === 'legacy' || preset === 'week') start.setDate(start.getDate() - 6);
  if (preset === 'legacy') end.setDate(end.getDate() + 1);
  for (const [input, date] of [[startDate, start], [endDate, end]]) {
    input.value = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }
}
setPreset();
document.querySelector('#date-preset').addEventListener('change', setPreset);
for (const input of [startDate, endDate]) {
  input.addEventListener('input', () => { document.querySelector('#date-preset').value = 'custom'; });
}

const themeToggle = document.querySelector('#theme-toggle');
themeToggle.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'dark'));
document.querySelector('#theme-label').textContent = document.documentElement.dataset.theme === 'dark' ? '일반 모드' : '다크 모드';
themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
  document.querySelector('#theme-label').textContent = theme === 'dark' ? '일반 모드' : '다크 모드';
  try { localStorage.setItem('balju-theme', theme); } catch { /* 저장소가 없어도 화면에는 적용합니다. */ }
});

for (const checkbox of document.querySelectorAll('input[name="site"]')) {
  checkbox.addEventListener('change', () => {
    const card = checkbox.closest('.account-card');
    card.classList.toggle('is-unselected', !checkbox.checked);
    card.querySelector('.credentials').disabled = !checkbox.checked;
    card.querySelector('.site-tag').textContent = checkbox.checked ? '선택됨' : '선택 안 함';
  });
}

document.querySelector('#clear-logs').addEventListener('click', () => {
  logs.replaceChildren();
  document.querySelector('#log-count').textContent = '0';
});
document.querySelector('#auto-scroll').addEventListener('change', (event) => {
  if (event.target.checked) logs.scrollTop = logs.scrollHeight;
});
cancelButton.addEventListener('click', () => {
  if (!controller) return;
  cancelButton.disabled = true;
  controller.abort(new DOMException('사용자가 수집을 중지했습니다.', 'AbortError'));
  log('warn', '중지 요청을 처리하고 있습니다.');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (controller) return;
  const selected = SITES.filter((site) => form.querySelector('input[name="site"][value="' + site.id + '"]').checked);
  errorBox.hidden = true;
  if (!selected.length || !startDate.value || !endDate.value || startDate.value > endDate.value) {
    errorBox.textContent = !selected.length ? '수집할 기관을 하나 이상 선택해 주세요.' : '시작일과 종료일을 올바른 순서로 입력해 주세요.';
    errorBox.hidden = false;
    log('warn', errorBox.textContent);
    return;
  }
  const accounts = selected.map((site) => ({
    id: document.getElementById(site.id + '-id').value.trim(),
    password: document.getElementById(site.id + '-password').value,
  }));
  if (accounts.some((account) => !account.id || !account.password)) {
    errorBox.textContent = '선택한 기관의 아이디와 비밀번호를 입력해 주세요.';
    errorBox.hidden = false;
    log('warn', errorBox.textContent);
    return;
  }
  // 실제 계정의 유효성은 별도 검증하지 않고 바로 수집 흐름을 실행합니다.
  redactions = accounts.flatMap((account) => [account.id, account.password]);
  runOptions = {
    type: document.querySelector('#order-type').value,
    startDate: startDate.value,
    endDate: endDate.value,
    onlyUnconfirmed: document.querySelector('#only-unconfirmed').checked,
  };
  results = selected.map((site) => ({ site, rows: [], status: '대기', reason: '', failed: 0 }));
  controller = new AbortController();
  settings.disabled = true;
  cancelButton.disabled = false;
  resultPanel.hidden = true;
  document.querySelector('#start-spinner').hidden = false;
  document.querySelector('#start-label').textContent = '발주 수집 중';
  document.querySelector('#row-count').textContent = '수집 0건';
  status.dataset.state = 'running';
  status.textContent = '수집 중';
  log('info', '수집 시작 · ' + selected.map((site) => site.label).join(', ') + ' · ' + runOptions.startDate + ' ~ ' + runOptions.endDate);
  try {
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      if (controller.signal.aborted) break;
      result.status = '수집 중';
      try {
        const detail = await scrapeSite({
          site: result.site,
          account: accounts[index],
          options: runOptions,
          signal: controller.signal,
          log,
          onRow: (row) => {
            result.rows.push(row);
            document.querySelector('#row-count').textContent = '수집 ' + results.reduce((sum, item) => sum + item.rows.length, 0) + '건';
          },
        });
        result.failed = detail.failed;
        result.status = detail.failed ? '일부 실패' : '완료';
        result.reason = detail.failed ? '상세 발주서 ' + detail.failed + '건 처리 실패' : '';
        log(detail.failed ? 'warn' : 'success', result.site.label + ' · 수집 ' + result.rows.length + '건' + (detail.failed ? ', 실패 ' + detail.failed + '건' : ' 완료'));
      } catch (error) {
        result.status = controller.signal.aborted ? '중지' : '실패';
        result.reason = controller.signal.aborted ? '사용자 중지' : error.message;
        for (const secret of redactions) {
          if (secret) result.reason = result.reason.split(secret).join('[숨김]');
        }
        log(controller.signal.aborted ? 'warn' : 'error', result.reason);
        if (controller.signal.aborted) break;
      } finally {
        accounts[index].password = '';
        document.getElementById(result.site.id + '-password').value = '';
      }
    }
    const cancelled = controller.signal.aborted;
    const incomplete = cancelled || results.some((item) => item.status !== '완료');
    const total = results.reduce((sum, item) => sum + item.rows.length, 0);
    status.dataset.state = cancelled ? 'idle' : incomplete ? (total ? 'partial' : 'error') : 'complete';
    status.textContent = cancelled ? '수집 중지' : incomplete ? (total ? '일부 수집' : '수집 실패') : '수집 완료';
    if (total) {
      resultPanel.hidden = false;
      document.querySelector('#result-title').textContent = incomplete ? '일부 수집 결과' : '수집 결과';
      document.querySelector('#result-summary').textContent = results.map((item) => item.site.label + ' ' + item.rows.length + '건 · ' + item.status).join(' / ');
      downloadButton.textContent = incomplete ? '일부 결과 엑셀 다운로드 ↓' : '엑셀 다운로드 ↓';
      log(incomplete ? 'warn' : 'success', '총 ' + total + '건을 내려받을 수 있습니다.' + (incomplete ? ' 완료되지 않은 기관·항목이 포함된 일부 결과입니다.' : ''));
    } else {
      log(incomplete ? 'warn' : 'info', incomplete ? '수집이 완료되지 않았습니다. 위 오류 로그를 확인해 주세요.' : '조회 조건에 해당하는 발주가 없어 파일을 생성하지 않습니다.');
    }
  } finally {
    for (let index = 0; index < accounts.length; index++) {
      accounts[index].password = '';
      document.getElementById(selected[index].id + '-password').value = '';
    }
    redactions = [];
    controller = null;
    settings.disabled = false;
    cancelButton.disabled = true;
    document.querySelector('#start-spinner').hidden = true;
    document.querySelector('#start-label').textContent = '발주 수집 시작';
  }
});

downloadButton.addEventListener('click', async () => {
  if (!runOptions || !results.some((item) => item.rows.length) || controller) return;
  downloadButton.disabled = true;
  startButton.disabled = true;
  try {
    log('info', '엑셀 파일을 준비하고 있습니다.');
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const isRehearsal = runOptions.type === 'RMON';
    const headers = isRehearsal
      ? ['발주코드', '날짜', '담당플래너', '신부명', '배송지', '배송시간', '발주부케', '특이사항(기타사항)', '리허설장소', '리허설시간']
      : ['발주코드', '담당플래너', '신부명', '배송지', '배송시간', '발주부케', '부토니에', '특이사항(기타사항)', '예식장소', '예식시간'];
    for (const result of results) {
      const sheet = workbook.addWorksheet(result.site.name);
      sheet.columns = headers.map((header) => ({
        header, key: header, width: header.includes('특이사항') ? 55 : header === '발주부케' ? 35 : header.includes('장소') || header === '배송지' ? 25 : 16,
      }));
      for (const row of result.rows) sheet.addRow(row);
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.eachRow((row) => { row.alignment = { vertical: 'top', wrapText: true }; });
    }
    const incomplete = results.some((item) => item.status !== '완료');
    if (incomplete) {
      const sheet = workbook.addWorksheet('수집현황');
      sheet.columns = [
        { header: '기관', key: 'site', width: 16 },
        { header: '상태', key: 'status', width: 16 },
        { header: '수집 건수', key: 'count', width: 14 },
        { header: '확인 사항', key: 'reason', width: 70 },
      ];
      for (const item of results) sheet.addRow({ site: item.site.label, status: item.status, count: item.rows.length, reason: item.reason || (item.status === '대기' ? '중지로 인해 실행하지 않음' : '') });
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = (isRehearsal ? '촬영용_' : '예식일_') + runOptions.startDate + '_to_' + runOptions.endDate + (incomplete ? '_일부수집' : '') + '.xlsx';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    log('success', '엑셀 파일 다운로드를 요청했습니다.');
  } catch {
    log('error', '엑셀 생성에 실패했습니다. 수집 결과는 유지되므로 다시 다운로드해 주세요.');
  } finally {
    downloadButton.disabled = false;
    startButton.disabled = false;
  }
});

log('info', '준비되었습니다. 기관 계정과 조회 조건을 입력한 뒤 수집을 시작해 주세요.');
