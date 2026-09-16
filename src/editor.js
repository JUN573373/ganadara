import { aggregateOrders, cleanBouquetName, cleanBrideName, generateDeliveryMessage } from './formatter.js';

let currentRows = [];
let currentOptions = {};
let filterNeedsCheckOnly = false;
let activeSmsRow = null;

const resultPanel = document.querySelector('#result-panel');
const resultBadges = document.querySelector('#result-badges');
const resultSummary = document.querySelector('#result-summary');
const previewTbody = document.querySelector('#preview-tbody');
const filterNeedsCheckBtn = document.querySelector('#filter-needs-check');

// 모달 요소
const smsModal = document.querySelector('#sms-modal');
const smsModalClose = document.querySelector('#sms-modal-close');
const smsModalTitle = document.querySelector('#sms-modal-title');
const smsIncludeSangwon = document.querySelector('#sms-include-sangwon');
const smsText = document.querySelector('#sms-text');
const smsCopyBtn = document.querySelector('#sms-copy-btn');
const smsCopyStatus = document.querySelector('#sms-copy-status');

const aggModal = document.querySelector('#agg-modal');
const aggModalClose = document.querySelector('#agg-modal-close');
const aggModalConfirm = document.querySelector('#agg-modal-confirm');
const aggModalTitle = document.querySelector('#agg-modal-title');
const aggModalList = document.querySelector('#agg-modal-list');

/**
 * 에디터 초기화 이벤트 등록
 */
export function initEditor() {
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
  if (smsIncludeSangwon) {
    smsIncludeSangwon.addEventListener('change', () => {
      if (!activeSmsRow) return;
      smsText.value = generateDeliveryMessage(activeSmsRow, {
        includeSangwonComment: smsIncludeSangwon.checked,
      });
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

  // 합산 모달 이벤트
  if (aggModalClose) {
    aggModalClose.addEventListener('click', () => aggModal.close());
  }
  if (aggModalConfirm) {
    aggModalConfirm.addEventListener('click', () => aggModal.close());
  }
}

/**
 * 수집된 원본 데이터를 받아서 합산 정제 후 미리보기 렌더링
 */
export function setScrapedData(results, options) {
  currentOptions = options || {};
  let combined = [];

  for (const item of results) {
    const siteKey = item.site.id;
    const rawRows = item.rows || [];
    const siteAggregated = aggregateOrders(rawRows, siteKey);
    combined = combined.concat(siteAggregated);
  }

  currentRows = combined;
  renderTable();
  resultPanel.hidden = false;
}

/**
 * 테이블 및 뱃지 렌더링
 */
function renderTable() {
  if (!previewTbody) return;
  previewTbody.innerHTML = '';

  const totalCount = currentRows.length;
  const aggCount = currentRows.filter(r => r._isAggregated).length;
  const needsCheckCount = currentRows.filter(r => (r['배송지'] || '').includes('확인필요')).length;

  if (resultBadges) {
    resultBadges.innerHTML = `
      <span class="badge">총 ${totalCount}건</span>
      ${aggCount > 0 ? `<span class="badge agg">합산 ${aggCount}건</span>` : ''}
      ${needsCheckCount > 0 ? `<span class="badge warn">확인필요 ${needsCheckCount}건</span>` : ''}
    `;
  }

  if (resultSummary) {
    resultSummary.textContent = `날짜별 시트가 자동 분리되며, 셀의 값을 직접 수정하면 엑셀과 배송문자에 즉시 반영됩니다.`;
  }

  const rowsToDisplay = filterNeedsCheckOnly
    ? currentRows.filter(r => (r['배송지'] || '').includes('확인필요'))
    : currentRows;

  if (rowsToDisplay.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="14" style="text-align: center; padding: 32px; color: var(--muted);">조회된 발주 데이터가 없습니다.</td>`;
    previewTbody.appendChild(tr);
    return;
  }

  rowsToDisplay.forEach((row, idx) => {
    const tr = document.createElement('tr');
    const isNeedsCheck = (row['배송지'] || '').includes('확인필요');
    if (isNeedsCheck) tr.classList.add('needs-check');

    const plannerName = row._site === 'swed' && !row['담당플래너']?.includes('S웨딩')
      ? `${row['담당플래너']}-S웨딩`
      : row['담당플래너'] || '';

    const cleanedBouquet = row._cleanedBouquet || cleanBouquetName(row['발주부케']);
    const rawBouquet = row['발주부케'] || '';

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${row['날짜'] || row['예식일'] || ''}</td>
      <td><strong>${plannerName}</strong></td>
      <td>${cleanBrideName(row['신부명'])}</td>
      <td>
        <input class="cell-input col-shipping" value="${row['배송지'] || ''}" data-idx="${idx}" />
        ${isNeedsCheck ? `<span class="badge warn" style="font-size: 9px; padding: 1px 5px;">확인필요</span>` : ''}
      </td>
      <td>
        <input class="cell-input col-shipping-time" placeholder="배송시간" value="${row['배송시간'] || ''}" data-idx="${idx}" style="width: 80px;" />
      </td>
      <td>
        <input class="cell-input col-bouquet bouquet-clean" value="${cleanedBouquet}" data-idx="${idx}" />
        <span class="bouquet-raw" title="${rawBouquet}">${rawBouquet}</span>
        ${row._isAggregated ? `<button type="button" class="badge agg btn-view-agg" data-idx="${idx}">합산 ${row._originalOrders.length}건 보기</button>` : ''}
      </td>
      <td>${row['부토니에'] || ''}</td>
      <td>
        <input class="cell-input col-notes" value="${row['특이사항'] || row['특이사항(기타사항)'] || ''}" data-idx="${idx}" style="min-width: 180px;" />
      </td>
      <td>${row['예식장소'] || row['리허설장소'] || ''}</td>
      <td>${row['예식시간'] || row['리허설시간'] || ''}</td>
      <td>
        <input class="cell-input col-mycomment" placeholder="내 메모" value="${row.myComment || ''}" data-idx="${idx}" style="min-width: 100px;" />
      </td>
      <td>
        <input class="cell-input col-sangwoncomment" placeholder="코멘트" value="${row.sangwonComment || ''}" data-idx="${idx}" style="min-width: 100px;" />
      </td>
      <td style="text-align: center;">
        <button type="button" class="button secondary small btn-open-sms" data-idx="${idx}">배송문자 ✉</button>
      </td>
    `;

    // 인라인 입력 변경 이벤트 바인딩
    tr.querySelector('.col-shipping').addEventListener('input', (e) => {
      row['배송지'] = e.target.value;
      e.target.classList.add('modified');
    });
    tr.querySelector('.col-shipping-time').addEventListener('input', (e) => {
      row['배송시간'] = e.target.value;
      e.target.classList.add('modified');
    });
    tr.querySelector('.col-bouquet').addEventListener('input', (e) => {
      row._cleanedBouquet = e.target.value;
      e.target.classList.add('modified');
    });
    tr.querySelector('.col-notes').addEventListener('input', (e) => {
      row['특이사항'] = e.target.value;
      row['특이사항(기타사항)'] = e.target.value;
      e.target.classList.add('modified');
    });
    tr.querySelector('.col-mycomment').addEventListener('input', (e) => {
      row.myComment = e.target.value;
      e.target.classList.add('modified');
    });
    tr.querySelector('.col-sangwoncomment').addEventListener('input', (e) => {
      row.sangwonComment = e.target.value;
      e.target.classList.add('modified');
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
  smsIncludeSangwon.checked = !!row.sangwonComment;
  smsText.value = generateDeliveryMessage(row, {
    includeSangwonComment: smsIncludeSangwon.checked,
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
        <span>#${idx + 1} 발주코드: ${orig['발주코드'] || '-'}</span>
        <span>금액: ${orig.price || '-'}원</span>
      </div>
      <div><strong>상품명:</strong> ${orig['발주부케'] || '-'}</div>
      <div style="font-size: 11px; color: var(--muted); margin-top: 4px;"><strong>특이사항:</strong> ${orig['특이사항(기타사항)'] || orig['특이사항'] || '없음'}</div>
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
