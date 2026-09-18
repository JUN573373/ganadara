import { aggregateOrders, cleanBouquetName, cleanBrideName, generateDeliveryMessage } from './formatter.js';
import { loadConfig, saveConfig, resetConfig, DEFAULT_CONFIG } from './config.js';

let currentRows = [];
const manualEdits = new Map();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
let currentOptions = {};
let rawScrapedResults = [];
let originalData = [];
let filterNeedsCheckOnly = false;
let activeSmsRow = null;
let currentConfig = loadConfig();

const resultPanel = document.querySelector('#result-panel');
const resultBadges = document.querySelector('#result-badges');
const resultSummary = document.querySelector('#result-summary');
const previewTbody = document.querySelector('#preview-tbody');
const filterNeedsCheckBtn = document.querySelector('#filter-needs-check');

// 모달 요소
const smsModal = document.querySelector('#sms-modal');
const smsModalClose = document.querySelector('#sms-modal-close');
const smsModalTitle = document.querySelector('#sms-modal-title');
const smsIncludeAdditional = document.querySelector('#sms-include-additional');
const smsText = document.querySelector('#sms-text');
const smsCopyBtn = document.querySelector('#sms-copy-btn');
const smsCopyStatus = document.querySelector('#sms-copy-status');

// 세부 설정 패널 요소
const toggleRulesBtn = document.querySelector('#toggle-rules-btn');
const rulesBody = document.querySelector('#rules-body');
const cfgEnableAgg = document.querySelector('#cfg-enable-agg');
const cfgEnableOut = document.querySelector('#cfg-enable-out');
const cfgSmsTemplate = document.querySelector('#cfg-sms-template');
const cfgResetSmsBtn = document.querySelector('#cfg-reset-sms-btn');
const cfgAddRuleBtn = document.querySelector('#cfg-add-rule-btn');
const cfgRulesTbody = document.querySelector('#cfg-rules-tbody');

/**
 * 에디터 및 세부 설정 패널 초기화
 */
export function initEditor() {
  initRulesPanel();
  document.querySelector('#view-original').addEventListener('click', () => openOriginalWindow());
  const table = document.querySelector('#preview-table');
  const expand = document.querySelector('#sheet-expand');
  const widths = [54, 120, 150, 130, 210, 140, 280, 140, 300, 200, 130, 300, 140];
  const columns = document.createElement('colgroup');
  widths.forEach(width => {
    const col = document.createElement('col');
    col.style.width = width + 'px';
    columns.append(col);
  });
  table.prepend(columns);
  const resizeColumns = () => {
    table.style.width = widths.reduce((sum, width) => sum + width, 0) + 'px';
    table.style.setProperty('--number-width', widths[0] + 'px');
  };
  resizeColumns();
  table.querySelectorAll('thead th').forEach((header, index) => {
    const handle = document.createElement('span');
    handle.className = 'column-resizer';
    handle.title = '드래그하여 열 너비 조절';
    header.append(handle);
    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const start = event.clientX;
      const width = widths[index];
      const move = e => {
        widths[index] = Math.max(70, width + e.clientX - start);
        columns.children[index].style.width = widths[index] + 'px';
        resizeColumns();
      };
      const stop = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    });
  });
  expand.addEventListener('click', () => {
    const expanded = resultPanel.classList.toggle('sheet-expanded');
    document.body.classList.toggle('sheet-open', expanded);
    expand.textContent = expanded ? '전체 보기 닫기 (Esc)' : '화면 전체 보기';
    expand.setAttribute('aria-pressed', String(expanded));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && resultPanel.classList.contains('sheet-expanded') && !document.querySelector('dialog[open]')) expand.click();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash !== '#review' && resultPanel.classList.contains('sheet-expanded')) expand.click();
  });
  document.querySelector('#sheet-zoom').addEventListener('change', event => {
    table.style.setProperty('--sheet-font', 14 * Number(event.target.value) / 100 + 'px');
  });
  previewTbody.addEventListener('focusin', event => {
    const cell = event.target.closest('td');
    if (!cell) return;
    document.querySelector('#sheet-position').textContent =
      String.fromCharCode(65 + cell.cellIndex) + cell.parentElement.rowIndex + ' · ' +
      table.tHead.rows[0].cells[cell.cellIndex].textContent.trim();
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  previewTbody.addEventListener('keydown', event => {
    if (event.isComposing || !event.target.matches('.cell-input')) return;
    if (!['Enter', 'Tab'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const input = event.target;
    const cells = [...previewTbody.querySelectorAll('.cell-input')];
    let next;
    if (event.key === 'Tab') next = cells[cells.indexOf(input) + (event.shiftKey ? -1 : 1)];
    else {
      const row = input.closest('tr');
      const nextRow = event.shiftKey ? row.previousElementSibling : row.nextElementSibling;
      next = nextRow?.cells[input.closest('td').cellIndex]?.querySelector('.cell-input');
    }
    if (next) {
      event.preventDefault();
      next.focus();
      next.select();
    } else if (event.key === 'Enter') event.preventDefault();
  });


  if (filterNeedsCheckBtn) {
    filterNeedsCheckBtn.addEventListener('click', () => {
      filterNeedsCheckOnly = !filterNeedsCheckOnly;
      filterNeedsCheckBtn.textContent = filterNeedsCheckOnly ? '전체 보기' : '확인필요만 보기';
      filterNeedsCheckBtn.classList.toggle('primary', filterNeedsCheckOnly);
      filterNeedsCheckBtn.classList.toggle('secondary', !filterNeedsCheckOnly);
      renderTable();
    });
  }

  // 배송문자 모달 이벤트
  if (smsModalClose) {
    smsModalClose.addEventListener('click', () => smsModal.close());
  }
  if (smsIncludeAdditional) {
    smsIncludeAdditional.addEventListener('change', () => {
      if (!activeSmsRow) return;
      smsText.value = generateDeliveryMessage(activeSmsRow, {
        includeAdditional: smsIncludeAdditional.checked,
        template: currentConfig.smsTemplate,
      });
      activeSmsRow._deliveryDraft = smsText.value;
      activeSmsRow._includeAdditional = smsIncludeAdditional.checked;
      document.dispatchEvent(new Event('workspace-change'));
    });
  }
  if (smsCopyBtn) {
    smsCopyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(smsText.value);
        smsCopyStatus.hidden = false;
        setTimeout(() => {
          smsCopyStatus.hidden = true;
        }, 2000);
      } catch (err) {
        alert('클립보드 복사 권한이 필요합니다: ' + err.message);
      }
    });
  }

  smsText.addEventListener('input', () => {
    if (!activeSmsRow) return;
    activeSmsRow._deliveryDraft = smsText.value;
    document.dispatchEvent(new Event('workspace-change'));
  });


}

/**
 * 세부 변환 설정 패널 이벤트 및 동기화
 */
function initRulesPanel() {
  currentConfig = loadConfig();

  // 패널 토글
  if (toggleRulesBtn && rulesBody) {
    toggleRulesBtn.addEventListener('click', () => {
      const isHidden = rulesBody.hidden;
      rulesBody.hidden = !isHidden;
      toggleRulesBtn.textContent = isHidden ? '설정 접기 ✕' : '설정 펼치기 ⚙';
      toggleRulesBtn.setAttribute('aria-expanded', String(isHidden));
    });
  }

  // 체크박스 옵션 동기화
  if (cfgEnableAgg) {
    cfgEnableAgg.checked = currentConfig.enableAggregation !== false;
    cfgEnableAgg.addEventListener('change', () => {
      currentConfig.enableAggregation = cfgEnableAgg.checked;
      saveConfig(currentConfig);
      reapplyConfig();
    });
  }

  if (cfgEnableOut) {
    cfgEnableOut.checked = currentConfig.enableOutTime !== false;
    cfgEnableOut.addEventListener('change', () => {
      currentConfig.enableOutTime = cfgEnableOut.checked;
      saveConfig(currentConfig);
      reapplyConfig();
    });
  }

  // 배송문자 템플릿
  if (cfgSmsTemplate) {
    cfgSmsTemplate.value = currentConfig.smsTemplate || DEFAULT_CONFIG.smsTemplate;
    cfgSmsTemplate.addEventListener('input', () => {
      currentConfig.smsTemplate = cfgSmsTemplate.value;
      currentRows.forEach(row => { delete row._deliveryDraft; });
      saveConfig(currentConfig);
      document.dispatchEvent(new Event('workspace-change'));
    });
  }

  if (cfgResetSmsBtn) {
    cfgResetSmsBtn.addEventListener('click', () => {
      currentConfig.smsTemplate = DEFAULT_CONFIG.smsTemplate;
      currentRows.forEach(row => { delete row._deliveryDraft; });
      if (cfgSmsTemplate) cfgSmsTemplate.value = DEFAULT_CONFIG.smsTemplate;
      saveConfig(currentConfig);
      document.dispatchEvent(new Event('workspace-change'));
      alert('배송안내 문자 양식이 기본값으로 복원되었습니다.');
    });
  }

  // 규칙 표 렌더링 및 추가
  renderRulesTable();

  if (cfgAddRuleBtn) {
    cfgAddRuleBtn.addEventListener('click', () => {
      currentConfig.bouquetRules.push({ pattern: '', replacement: '' });
      saveConfig(currentConfig);
      renderRulesTable();
    });
  }
}

/**
 * 규칙 테이블 렌더링
 */
function renderRulesTable() {
  if (!cfgRulesTbody) return;
  cfgRulesTbody.innerHTML = '';

  currentConfig.bouquetRules.forEach((rule, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="rules-input rule-pattern" value="${escapeHtml(rule.pattern)}" placeholder="예: VS플러스" data-idx="${idx}" /></td>
      <td style="text-align: center; color: var(--muted); font-size: 13px;">➔</td>
      <td><input class="rules-input rule-replacement" value="${escapeHtml(rule.replacement)}" placeholder="예: VS+" data-idx="${idx}" /></td>
      <td style="text-align: center;"><button type="button" class="rules-del-btn" data-idx="${idx}" title="삭제">✕</button></td>
    `;

    tr.querySelector('.rule-pattern').addEventListener('input', (e) => {
      currentConfig.bouquetRules[idx].pattern = e.target.value;
      saveConfig(currentConfig);
      reapplyConfig();
    });

    tr.querySelector('.rule-replacement').addEventListener('input', (e) => {
      currentConfig.bouquetRules[idx].replacement = e.target.value;
      saveConfig(currentConfig);
      reapplyConfig();
    });

    tr.querySelector('.rules-del-btn').addEventListener('click', () => {
      currentConfig.bouquetRules.splice(idx, 1);
      saveConfig(currentConfig);
      renderRulesTable();
      reapplyConfig();
    });

    cfgRulesTbody.appendChild(tr);
  });
}

/**
 * 수집된 원본 데이터에 현재 설정을 재적용하여 리렌더링
 */
function reapplyConfig() {
  if (!rawScrapedResults || rawScrapedResults.length === 0) return;
  setScrapedData(rawScrapedResults, currentOptions);
}

/**
 * 수집된 원본 데이터를 받아서 합산 정제 후 미리보기 렌더링
 */
export function setScrapedData(results, options) {
  document.querySelector('#transform-note').textContent = '수집 원본에 합산·부케 규칙을 적용합니다. 직접 수정한 값은 유지됩니다.';
  cfgEnableAgg.disabled = false;
  cfgEnableOut.disabled = false;
  document.querySelector('#cfg-add-rule-btn').disabled = false;
  document.querySelector('#cfg-rules-tbody').closest('table').inert = false;
  if (results !== rawScrapedResults) {
    manualEdits.clear();
    originalData = results.map(item => ({
      siteId: item.site.id, origin: 'scraped',
      rows: JSON.parse(JSON.stringify(item.rows || [])),
    }));
  }
  rawScrapedResults = results || [];
  currentOptions = options || {};
  let combined = [];

  for (const item of rawScrapedResults) {
    const siteKey = item.site.id;
    const rawRows = item.rows || [];
    const siteAggregated = aggregateOrders(rawRows, siteKey, currentConfig);
    combined = combined.concat(siteAggregated);
  }

  currentRows = combined.map(row => {
    Object.assign(row, manualEdits.get(row._key));
    row._rowId = row._key;
    row._sources = row._originalOrders.map(order => ({
      siteId: row._site, orderCode: order['발주코드'] || '',
      // 확인 기능 추가 시 서버에서 대상 요청을 검증하고 구성합니다. 현재는 실행하지 않습니다.
      confirmation: { status: 'notRequested', request: null },
    }));
    return row;
  });
  renderTable();
  if (resultPanel) resultPanel.hidden = false;
  document.dispatchEvent(new Event('workspace-change'));
}

/**
 * 테이블 및 뱃지 렌더링 (깨짐 완벽 방지)
 */
function renderTable() {
  if (!previewTbody) return;
  previewTbody.innerHTML = '';

  const totalCount = currentRows.length;
  const sourceCount = currentRows.reduce((sum, row) => sum + (row._originalOrders?.length || 0), 0);
  const aggCount = currentRows.filter(r => r._isAggregated).length;
  const needsCheckCount = currentRows.filter(r => r._needsCheck).length;

  if (resultBadges) {
    resultBadges.innerHTML = `
      <span class="badge">발주코드 ${sourceCount}건 → 결과 ${totalCount}행</span>
      ${aggCount > 0 ? `<span class="badge agg">합산 고객 ${aggCount}명</span>` : ''}
      ${needsCheckCount > 0 ? `<span class="badge warn">확인필요 ${needsCheckCount}건</span>` : ''}
    `;
  }

  if (resultSummary) {
    resultSummary.textContent = `발주코드 중복은 제외합니다. 합산 금액은 부케 아래와 엑셀에 표시되며, 배송문자는 각 행의 최종 수정값으로 생성합니다.`;
  }

  const rowsToDisplay = filterNeedsCheckOnly
    ? currentRows.filter(r => r._needsCheck)
    : currentRows;

  if (rowsToDisplay.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="13" style="text-align: center; padding: 36px; color: var(--muted);">조회 조건에 해당하는 발주 데이터가 없습니다.</td>`;
    previewTbody.appendChild(tr);
    return;
  }

  rowsToDisplay.forEach((row, idx) => {
    const tr = document.createElement('tr');
    if (row._needsCheck) tr.classList.add('needs-check');

    const plannerName = row._site === 'swed' && !row['담당플래너']?.includes('S웨딩')
      ? `${row['담당플래너']}-S웨딩`
      : row['담당플래너'] || '';

    const cleanedBouquet = row._cleanedBouquet ?? cleanBouquetName(row['발주부케'], currentConfig.bouquetRules);
    const rawBouquet = row['발주부케'] || '';

    tr.innerHTML = `
      <td style="text-align: center; font-weight: bold;">${idx + 1}</td>
      <td style="text-align: center;">${escapeHtml(row['날짜'] || row['예식일'] || '')}</td>
      <td><strong>${escapeHtml(plannerName)}</strong></td>
      <td>${escapeHtml(cleanBrideName(row['신부명']))}</td>
      <td>
        <div class="cell-shipping-box">
          <input class="cell-input col-shipping" value="${escapeHtml(row['배송지'] || '')}" data-idx="${idx}" />
          ${row._needsCheck ? `<span class="badge warn">확인필요</span>` : ''}
        </div>
      </td>
      <td>
        <input class="cell-input col-shipping-time" placeholder="배송시간" value="${escapeHtml(row['배송시간'] || '')}" data-idx="${idx}" style="min-width: 85px;" />
      </td>
      <td>
        <div class="bouquet-cell-box">
          <input class="cell-input col-bouquet bouquet-clean" value="${escapeHtml(cleanedBouquet)}" data-idx="${idx}" />
          <strong class="bouquet-total">${row._isAggregated ? '합계 ' : '금액 '}${escapeHtml(row._amountText)}</strong>
          <span class="bouquet-raw" title="${escapeHtml(rawBouquet)}">${escapeHtml(rawBouquet)}</span>
          ${row._originalOrders.length ? `<button type="button" class="badge agg btn-view-agg" data-idx="${idx}" style="margin-top: 2px;">원본 ${row._originalOrders.length}건 보기</button>` : ''}
        </div>
      </td>
      <td style="text-align: center;">${escapeHtml(row['부토니에'] || '')}</td>
      <td>
        <input class="cell-input col-notes" value="${escapeHtml(row['특이사항'] || row['특이사항(기타사항)'] || '')}" data-idx="${idx}" style="min-width: 220px;" />
      </td>
      <td>${escapeHtml(row['예식장소'] || row['리허설장소'] || '')}</td>
      <td style="text-align: center;">${escapeHtml(row['예식시간'] || row['리허설시간'] || '')}</td>
      <td>
        <textarea class="cell-input col-additional" placeholder="전달받은 추가사항" style="min-width: 220px;">${escapeHtml(row['추가사항'] || '')}</textarea>
      </td>
      <td style="text-align: center;">
        <button type="button" class="button secondary small btn-open-sms" data-idx="${idx}">배송문자 ✉</button>
      </td>
    `;

    for (const input of tr.querySelectorAll('.cell-input')) {
      input.closest('td').classList.add('editable-cell');
      const header = document.querySelector('#preview-table').tHead.rows[0].cells[input.closest('td').cellIndex];
      input.setAttribute('aria-label', (idx + 1) + '행 ' + header.textContent.trim());
    }
    // 인라인 입력 변경 이벤트 바인딩
    tr.querySelector('.col-shipping').addEventListener('input', (e) => {
      row['배송지'] = e.target.value;
      manualEdits.set(row._key, { ...manualEdits.get(row._key), '배송지': e.target.value });
      e.target.classList.add('modified');
    });
    tr.querySelector('.col-shipping-time').addEventListener('input', (e) => {
      row['배송시간'] = e.target.value;
      manualEdits.set(row._key, { ...manualEdits.get(row._key), '배송시간': e.target.value });
      e.target.classList.add('modified');
    });
    tr.querySelector('.col-bouquet').addEventListener('input', (e) => {
      row._cleanedBouquet = e.target.value;
      manualEdits.set(row._key, { ...manualEdits.get(row._key), '_cleanedBouquet': e.target.value });
      e.target.classList.add('modified');
    });
    tr.querySelector('.col-notes').addEventListener('input', (e) => {
      row['특이사항'] = e.target.value;
      manualEdits.set(row._key, { ...manualEdits.get(row._key), '특이사항': e.target.value });
      row['특이사항(기타사항)'] = e.target.value;
      e.target.classList.add('modified');
    });
    tr.querySelector('.col-additional').addEventListener('input', (e) => {
      row['추가사항'] = e.target.value;
      manualEdits.set(row._key, { ...manualEdits.get(row._key), 추가사항: e.target.value });
      e.target.classList.add('modified');
    });
    tr.addEventListener('input', () => {
      delete row._deliveryDraft;
      document.dispatchEvent(new Event('workspace-change'));
    });

    // 배송문자 버튼
    tr.querySelector('.btn-open-sms').addEventListener('click', () => {
      openSmsModal(row);
    });

    // 합산 보기 버튼
    const aggBtn = tr.querySelector('.btn-view-agg');
    if (aggBtn) {
      aggBtn.addEventListener('click', () => {
        openOriginalWindow(row);
      });
    }

    previewTbody.appendChild(tr);
  });
}

/**
 * 배송문자 모달 열기
 */
function openSmsModal(row) {
  activeSmsRow = row;
  const bride = cleanBrideName(row['신부명']);
  const date = row['날짜'] || row['예식일'] || '';
  smsModalTitle.textContent = `${bride}신부님 배송안내 문자 (${date})`;
  smsIncludeAdditional.checked = !!row._includeAdditional;
  smsText.value = row._deliveryDraft ?? generateDeliveryMessage(row, {
    includeAdditional: smsIncludeAdditional.checked,
    template: currentConfig.smsTemplate,
  });
  smsCopyStatus.hidden = true;
  smsModal.showModal();
}

/**
 * 원본 데이터를 독립된 읽기 전용 창으로 표시합니다.
 */
function openOriginalWindow(row) {
  const codes = new Set(row?._originalOrders?.map(order => order['발주코드']) || []);
  let groups = originalData.map(group => ({
    ...group, rows: row ? group.rows.filter(order =>
      group.siteId === row._site && codes.has(order['발주코드'])) : group.rows,
  })).filter(group => group.rows.length);
  if (row && !groups.length && row._originalOrders?.length) {
    groups = [{ siteId: row._site || '', origin: 'legacy', rows: row._originalOrders }];
  }
  const popup = window.open('', '_blank', 'popup,width=1000,height=800,resizable=yes,scrollbars=yes');
  if (!popup) {
    alert('원본 창을 열 수 없습니다. 브라우저에서 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.');
    return;
  }
  popup.opener = null;
  const doc = popup.document;
  doc.documentElement.lang = 'ko';
  doc.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
  doc.title = row ? '이 행의 수집 원본 · 읽기 전용' : '전체 수집 원본 · 읽기 전용';
  for (const source of document.querySelectorAll('link[rel="stylesheet"]')) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = source.href;
    doc.head.append(link);
  }
  const style = doc.createElement('style');
  style.textContent = 'body{margin:0;padding:24px;font-family:system-ui;background:var(--canvas,#f7f8fa);color:var(--text,#202124)}main{max-width:1000px;margin:auto}h1{font-size:22px;margin-bottom:12px}.original-list{display:grid;gap:16px;margin-top:24px}.original-record{padding:18px;border:1px solid var(--line,#ddd);border-radius:10px;background:var(--surface,#fff)}dl{display:grid;grid-template-columns:130px minmax(0,1fr);gap:10px;margin:0}dt{color:var(--muted,#555)}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}';
  doc.head.append(style);
  const main = doc.createElement('main');
  const title = doc.createElement('h1');
  title.textContent = doc.title;
  const note = doc.createElement('p');
  note.textContent = '창을 연 시점의 수집 원본입니다. 편집 화면과 나란히 놓고 비교할 수 있습니다.';
  const originalList = doc.createElement('div');
  originalList.className = 'original-list';
  main.append(title, note, originalList);
  doc.body.append(main);
  if (!groups.length) originalList.textContent = '이 파일에는 수집 원본이 없습니다. 수정된 값을 원본으로 대신 표시하지 않습니다.';
  for (const group of groups) {
    const heading = doc.createElement('p');
    heading.textContent = (group.siteId === 'swed' ? 'S웨딩' : group.siteId === 'ini' ? '아이니웨딩' : '기관 미상') +
      ' · ' + group.rows.length + '건' + (group.origin === 'legacy' ? ' · 이전 파일에 남아 있는 원본 내역' : '');
    originalList.append(heading);
    for (const orig of group.rows) {
      const div = doc.createElement('div');
      div.className = 'agg-item original-record';
      const list = doc.createElement('dl');
      for (const [key, value] of Object.entries(orig)) {
        if (key.startsWith('_')) continue;
        const term = doc.createElement('dt');
        const content = doc.createElement('dd');
        term.textContent = key;
        content.textContent = value == null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        list.append(term, content);
      }
      div.append(list);
      originalList.append(div);
    }
  }
  popup.focus();
}

/**
 * 사용자가 편집한 최종 데이터 배열 반환
 */
export function getCurrentRows() {
  return currentRows;
}


// 수집 원본은 최초 변환에만 사용하고, 저장·업로드된 작업은 재합산하지 않습니다.
export function getWorkspace() {
  return { format: 'ozic-workspace', version: 1, savedAt: new Date().toISOString(),
    options: currentOptions, originalData, rows: currentRows, config: currentConfig };
}

export function restoreWorkspace(workspace) {
  if (workspace?.format !== 'ozic-workspace' || workspace.version !== 1 ||
      !Array.isArray(workspace.rows) || workspace.rows.length > 20000 ||
      workspace.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('지원하는 발주 작업 파일이 아닙니다.');
  }
  const textFields = ['담당플래너','신부명','날짜','예식일','배송지','배송시간','발주부케','특이사항','추가사항','_cleanedBouquet'];
  if (workspace.rows.some(row => textFields.some(key => row[key] != null && typeof row[key] !== 'string')) ||
      (workspace.config && (typeof workspace.config.smsTemplate !== 'string' ||
        !Array.isArray(workspace.config.bouquetRules) ||
        workspace.config.bouquetRules.some(rule => !rule || typeof rule.pattern !== 'string' || typeof rule.replacement !== 'string')))) {
    throw new Error('작업 파일의 데이터 형식을 확인해 주세요.');
  }
  if (workspace.originalData != null && (!Array.isArray(workspace.originalData) ||
      workspace.originalData.some(group => !group || !Array.isArray(group.rows) ||
        group.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))))) {
    throw new Error('원본 데이터 형식을 확인해 주세요.');
  }
  originalData = JSON.parse(JSON.stringify(workspace.originalData || []));
  if (!workspace.originalData) {
    const groups = new Map();
    for (const row of workspace.rows) {
      if (!Array.isArray(row._originalOrders) || !row._originalOrders.length) continue;
      const siteId = row._site || '';
      if (!groups.has(siteId)) groups.set(siteId, { siteId, origin: 'legacy', rows: [] });
      const group = groups.get(siteId);
      for (const original of row._originalOrders) {
        if (!original || typeof original !== 'object') continue;
        if (!original['발주코드'] || !group.rows.some(item => item['발주코드'] === original['발주코드'])) {
          group.rows.push(JSON.parse(JSON.stringify(original)));
        }
      }
    }
    originalData = [...groups.values()];
  }
  rawScrapedResults = [];
  manualEdits.clear();
  currentOptions = workspace.options || {};
  currentRows = workspace.rows.map((row, index) => ({
    ...row, _key: row._key || row._rowId || String(index),
    _originalOrders: Array.isArray(row._originalOrders) ? row._originalOrders : [],
    _sources: Array.isArray(row._sources) ? row._sources : [],
  }));
  if (workspace.config) {
    currentConfig = { ...DEFAULT_CONFIG, ...workspace.config };
    if (!Array.isArray(currentConfig.bouquetRules)) currentConfig.bouquetRules = DEFAULT_CONFIG.bouquetRules;
    cfgSmsTemplate.value = currentConfig.smsTemplate;
    cfgEnableAgg.checked = currentConfig.enableAggregation !== false;
    cfgEnableOut.checked = currentConfig.enableOutTime !== false;
    renderRulesTable();
    saveConfig(currentConfig);
  }
  document.querySelector('#transform-note').textContent = '불러온 작업은 엑셀 수정값을 유지하기 위해 자동 재합산·재변환하지 않습니다. 아래 표에서 값을 직접 수정할 수 있습니다.';
  cfgEnableAgg.disabled = true;
  cfgEnableOut.disabled = true;
  document.querySelector('#cfg-add-rule-btn').disabled = true;
  document.querySelector('#cfg-rules-tbody').closest('table').inert = true;
  filterNeedsCheckOnly = false;
  filterNeedsCheckBtn.textContent = '확인필요만 보기';
  renderTable();
  resultPanel.hidden = currentRows.length === 0;
  document.dispatchEvent(new Event('workspace-change'));
}
