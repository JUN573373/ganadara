import { getWorkspace, restoreWorkspace } from './editor.js';

const STORAGE_KEY = 'ozic-workspace-v1';

export function initWorkflow() {
  const status = document.querySelector('#workspace-status');
  const upload = document.querySelector('#workspace-file');
  const download = document.querySelector('#download-button');
  let restoring = false;
  document.querySelector('#open-workspace').addEventListener('click', () => upload.click());

  const showPage = () => {
    const review = location.hash === '#review';
    document.querySelector('#collect-page').hidden = review;
    document.querySelector('#review-page').hidden = !review;
    document.querySelector('.page-heading h1').textContent = review ? '엑셀 확인 · 배송문자' : '필요한 발주를 한 번에.';
    for (const link of document.querySelectorAll('[data-page]')) {
      if (link.dataset.page === (review ? 'review' : 'collect')) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  };
  window.addEventListener('hashchange', showPage);
  showPage();
  document.addEventListener('workspace-change', () => {
    if (restoring) return;
    try {
      const workspace = getWorkspace();
      if (!workspace.rows.length) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
      status.dataset.error = 'false';
      status.textContent = '현재 작업 자동 저장됨 · ' + new Date().toLocaleTimeString('ko-KR') + ' · 이 브라우저에서 다시 열 수 있습니다.';
    } catch {
      status.dataset.error = 'true';
      status.textContent = '브라우저에 저장하지 못했습니다. 페이지를 닫기 전에 작업 JSON을 저장해 주세요.';
    }
  });
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      restoring = true;
      restoreWorkspace(JSON.parse(saved));
      status.textContent = '이 브라우저에 저장된 이전 작업을 복원했습니다.';
    }
  } catch {
    status.dataset.error = 'true';
    status.textContent = '저장된 작업을 복원하지 못했습니다. 엑셀 또는 JSON 파일을 열어 주세요.';
  } finally { restoring = false; }

  upload.addEventListener('change', async () => {
    const file = upload.files[0];
    if (!file) return;
    upload.disabled = true;
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('25MB 이하의 파일을 선택해 주세요.');
      let workspace;
      if (/\.json$/i.test(file.name)) workspace = JSON.parse(await file.text());
      else if (/\.xlsx$/i.test(file.name)) {
        const { importWorkbook } = await import('./workbook-io.js');
        workspace = await importWorkbook(await file.arrayBuffer());
      } else throw new Error('.xlsx 또는 작업 .json 파일을 선택해 주세요.');
      restoreWorkspace(workspace);
      location.hash = 'review';
      status.textContent += ' · ' + file.name + ' 불러옴. ' + (workspace.importNotice || '');
    } catch (error) {
      status.dataset.error = 'true';
      status.textContent = error.message;
    } finally { upload.disabled = false; upload.value = ''; }
  });
  document.querySelector('#backup-workspace').addEventListener('click', () => {
    const workspace = getWorkspace();
    if (!workspace.rows.length) { status.textContent = '먼저 발주 데이터를 수집하거나 파일을 열어 주세요.'; return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '발주작업_' + new Date().toISOString().slice(0, 10) + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.querySelector('#clear-workspace').addEventListener('click', () => {
    if (!confirm('이 브라우저에 저장된 작업을 지울까요? 필요한 작업은 먼저 JSON으로 저장해 주세요.')) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      restoreWorkspace({ format: 'ozic-workspace', version: 1, rows: [] });
      status.textContent = '저장된 작업을 지웠습니다.';
    } catch (error) { status.textContent = '삭제 실패: ' + error.message; }
  });
  download.addEventListener('click', async () => {
    const workspace = getWorkspace();
    if (!workspace.rows.length) return;
    download.disabled = true;
    try {
      const { downloadBaljuExcel } = await import('./excel-export.js');
      await downloadBaljuExcel(workspace.rows, { orderType: workspace.options.type || 'WMON', workspaceOptions: workspace.options, config: workspace.config });
      status.textContent = '엑셀을 저장했습니다. 상대방이 추가사항을 적은 뒤 돌려준 파일을 다시 열 수 있습니다.';
    } catch (error) { status.dataset.error = 'true'; status.textContent = '엑셀 생성 실패: ' + error.message; }
    finally { download.disabled = false; }
  });
}
