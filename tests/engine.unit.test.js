import assert from 'node:assert';
import { ScrapeSession } from '../api/_engine.js';

// 가상 HTML 픽스처
const sampleDetailHtmlRMON = `
<!DOCTYPE html>
<html>
<body>
<div>
  <table><tr><td>발   주   서</td></tr></table>
  <table>
    <tr><td class="tdEndLine">김플래너 / 010-1234-5678</td></tr>
    <tr><td>신부</td><td>홍길순</td></tr>
  </table>
  <table>
    <tr><td class="tdLine">스튜디오A</td></tr>
    <tr><td class="tdLine">2026-09-20 14:00</td></tr>
  </table>
  <table>
    <tr><td>1</td><td>헤더</td><td>구분</td></tr>
    <tr><td>2</td><td>강남메이크업샵</td><td>[촬영부케] 화이트로즈 수임료차감포함</td></tr>
    <tr><td>3</td><td>스튜디오A</td><td>토탈스튜디오</td></tr>
  </table>
  <table>
    <tr><td>요청사항: 13시까지 도착 요망</td></tr>
  </table>
</div>
</body>
</html>
`;

const sampleDetailHtmlWMON = `
<!DOCTYPE html>
<html>
<body>
<div>
  <table><tr><td>발   주   서</td></tr></table>
  <table>
    <tr><td class="tdEndLine">이플래너 / 010-9876-5432</td></tr>
    <tr><td>신부</td><td>김영희</td></tr>
  </table>
  <table>
    <tr><td class="tdEndLine">더채플앳논현</td></tr>
    <tr><td class="tdEndLine">2026-10-15 12:30:00</td></tr>
  </table>
  <table>
    <tr><td>1</td><td>헤더</td><td>구분</td></tr>
    <tr><td>2</td><td></td><td>[본식부케] 카라믹스</td></tr>
    <tr><td>3</td><td>메이크업샵B</td><td>토탈</td></tr>
  </table>
  <table>
    <tr><td>혼주 코사지 6개 포함</td></tr>
  </table>
</div>
</body>
</html>
`;

function runUnitTests() {
  console.log('--- ScrapeSession 단위 파싱 테스트 시작 ---');

  const session = new ScrapeSession('ini');

  // 1. RMON 파싱 테스트
  const rmonResult = session.parseContractDetail(sampleDetailHtmlRMON, { contCd: 'CP269001', price: '120,000' }, 'RMON');
  assert.strictEqual(rmonResult['발주코드'], 'CP269001');
  assert.strictEqual(rmonResult['담당플래너'], '김플래너');
  assert.strictEqual(rmonResult['신부명'], '홍길순');
  assert.strictEqual(rmonResult['배송지'], '스튜디오A');
  assert.strictEqual(rmonResult['리허설장소'], '스튜디오A');
  assert.strictEqual(rmonResult['리허설시간'], '14:00');
  assert.strictEqual(rmonResult['발주부케'], '[촬영부케] 화이트로즈 - 120,000원');
  assert.strictEqual(rmonResult['특이사항(기타사항)'], '요청사항: 13시까지 도착 요망');
  console.log('✓ RMON 상세 파싱 검증 통과');

  // 2. WMON 파싱 테스트
  const wmonResult = session.parseContractDetail(sampleDetailHtmlWMON, { contCd: 'CP269002', price: '250,000' }, 'WMON');
  assert.strictEqual(wmonResult['발주코드'], 'CP269002');
  assert.strictEqual(wmonResult['담당플래너'], '이플래너');
  assert.strictEqual(wmonResult['신부명'], '김영희');
  assert.strictEqual(wmonResult['배송지'], '메이크업샵B');
  assert.strictEqual(wmonResult['예식장소'], '더채플앳논현');
  assert.strictEqual(wmonResult['예식시간'], '12:30:00');
  assert.strictEqual(wmonResult['발주부케'], '[본식부케] 카라믹스 - 250,000원');
  assert.strictEqual(wmonResult['부토니에'], '');
  assert.strictEqual(wmonResult['특이사항(기타사항)'], '혼주 코사지 6개 포함');
  console.log('✓ WMON 상세 파싱 검증 통과');

  console.log('--- 모든 단위 파싱 검증 성공! ---');
}

runUnitTests();
