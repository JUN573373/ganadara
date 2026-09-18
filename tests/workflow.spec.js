import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';

test('수집 후 이동하고 브라우저를 다시 열어 수정받은 엑셀로 배송문자를 만든다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/scrape', route => route.fulfill({
    status: 200, contentType: 'text/event-stream',
    body: 'event: done\ndata: ' + JSON.stringify({ ok: true, results: { ini: [{
      발주코드: 'TEST-1', 날짜: '10/03(토)', 예식일: '2026-10-03', 담당플래너: '테스트플래너',
      신부명: '테스트신부', 배송지: '테스트샵', 배송시간: '9시', 발주부케: 'S-303 - 90,000원', 금액: '90,000',
    }] } }) + '\n\n',
  }));
  await page.goto('/');
  await expect(page.locator('#collect-page')).toBeVisible();
  await expect(page.locator('#review-page')).toBeHidden();
  await page.locator('#ini-id').fill('테스트계정');
  await page.locator('#ini-password').fill('테스트비밀번호');
  await page.locator('#start-button').click();
  await expect(page).toHaveURL(/#review$/);
  await expect(page.locator('#collect-page')).toBeHidden();
  await expect(page.locator('.col-mycomment')).toHaveCount(0);
  await page.locator('.col-additional').fill('A가 전달할 사항');
  await page.reload();
  await expect(page.locator('.col-additional')).toHaveValue('A가 전달할 사항');
  const stored = await page.evaluate(() => localStorage.getItem('ozic-workspace-v1'));
  expect(stored).not.toContain('테스트비밀번호');
  expect(JSON.parse(stored).rows[0]._sources[0].orderCode).toBe('TEST-1');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-button').click();
  const download = await downloadPromise;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await download.path());
  wb.getWorksheet('10.3(토)').getCell('K3').value = 'B가 추가한 사항';
  wb.getWorksheet('10.3(토)').getCell('E3').value = '10시 30분';
  // 이전 브라우저 작업 없이도 받은 파일만으로 복원이 가능해야 합니다.
  await page.evaluate(() => localStorage.removeItem('ozic-workspace-v1'));
  await page.reload();
  await page.locator('#workspace-file').setInputFiles({ name: '수정받은발주.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await wb.xlsx.writeBuffer()) });
  await expect(page.locator('.col-additional')).toHaveValue('B가 추가한 사항');
  await expect(page.locator('.col-shipping-time')).toHaveValue('10시 30분');
  await page.locator('.btn-open-sms').click();
  await page.locator('#sms-include-additional').check();
  await expect(page.locator('#sms-text')).toHaveValue(/B가 추가한 사항/);
  await expect(page.locator('#sms-text')).toHaveValue(/10시 30분 테스트샵/);
  await page.locator('#sms-text').fill('직접 수정한 배송문자');
  await page.locator('#sms-modal-close').click();
  await page.reload();
  await page.locator('.btn-open-sms').click();
  await expect(page.locator('#sms-text')).toHaveValue('직접 수정한 배송문자');
  await page.locator('#sms-modal-close').click();
  await page.screenshot({ path: 'test-results/workflow-review.png', fullPage: true });
  expect(errors).toEqual([]);
});
