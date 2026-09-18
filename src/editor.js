import { aggregateOrders, cleanBouquetName, cleanBrideName, generateDeliveryMessage } from './formatter.js';
import { loadConfig, saveConfig, resetConfig, DEFAULT_CONFIG } from './config.js';

let currentRows = [];
const manualEdits = new Map();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
let currentOptions = {};
let rawScrapedResults = [];
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

const aggModal = document.querySelector('#agg-modal');
const aggModalClose = document.querySelector('#agg-modal-close');
const aggModalConfirm = document.querySelector('#agg-modal-confirm');
const aggModalTitle = document.querySelector('#agg-modal-title');
const aggModalList = document.querySelector('#agg-modal-list');

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

  // 합산 모달 이벤트
  if (aggModalClose) {
    aggModalClose.addEventListener('click', () => aggModal.close());
  }
  if (aggModalConfirm) {
    aggModalConfirm.addEventListener('click', () => aggModal.close());
  }
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
  if (results !== rawScrapedResults) manualEdits.clear();
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
          ${row._isAggregated ? `<button type="button" class="badge agg btn-view-agg" data-idx="${idx}" style="margin-top: 2px;">합산 ${row._originalOrders.length}건 보기</button>` : ''}
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
        openAggModal(row);
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
 * 합산 주문 상세 모달 열기
 */
function openAggModal(row) {
  const bride = cleanBrideName(row['신부명']);
  aggModalTitle.textContent = `${bride}신부님 합산 주문 상세 (${row._originalOrders.length}건)`;
  aggModalList.innerHTML = '';

  row._originalOrders.forEach((orig, idx) => {
    const div = document.createElement('div');
    div.className = 'agg-item';
    div.innerHTML = `
      <div class="agg-item-header">
        <span>#${idx + 1} 발주코드: ${escapeHtml(orig['발주코드'] || '-')}</span>
        <span>금액: ${orig['금액'] === null ? '확인필요' : Number(orig['금액']).toLocaleString('ko-KR') + '원'}</span>
      </div>
      <div><strong>상품명:</strong> ${escapeHtml(orig['발주부케'] || '-')}</div>
      <div style="font-size: 13px; color: var(--muted); margin-top: 4px;"><strong>특이사항:</strong> ${escapeHtml(orig['특이사항(기타사항)'] || orig['특이사항'] || '없음')}</div>
    `;
    aggModalList.appendChild(div);
  });

  aggModal.showModal();
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
    options: currentOptions, rows: currentRows, config: currentConfig };
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
