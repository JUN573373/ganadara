import assert from 'node:assert';
import { createBaljuWorkbook } from '../src/excel-export.js';
import { aggregateOrders } from '../src/formatter.js';

async function runExcelTests() {
  console.log('--- 엑셀 생성 모듈 단위 테스트 시작 ---');

  const mockOrders = [
    {
      담당플래너: '강현영',
      신부명: '김일지',
      날짜: '09/12(토)',
      배송지: '라메종뷰티',
      배송시간: '',
      발주부케: 'S-303화이트장미보리사초 - 90,000원',
      부토니에: '',
      '특이사항(기타사항)': '11시 30분 아웃 / 싱싱하게',
      예식장소: '더컨벤션 잠실점',
      예식시간: '14:00',
    },
    {
      담당플래너: '곽다유',
      신부명: '황지현',
      날짜: '09/12(토)',
      배송지: '라메종뷰티 (확인필요)',
      배송시간: '',
      발주부케: 'Vs+512 화이트장미그린 - 140,000원',
      부토니에: '',
      '특이사항(기타사항)': '시안 비슷하게',
      예식장소: 'PJ호텔',
      예식시간: '11:30',
    },
    {
      담당플래너: '고혜빈',
      신부명: '조소현',
      날짜: '09/13(일)',
      배송지: '요닝',
      배송시간: '',
      발주부케: 'S-303 - 90,000원',
      부토니에: '',
      '특이사항(기타사항)': '11시 아웃',
      예식장소: '더 마리포사',
      예식시간: '14:00',
    },
  ];

  const aggregated = aggregateOrders(mockOrders, 'ini');
  const wb = await createBaljuWorkbook(aggregated, { orderType: 'WMON' });

  // 시트 확인
  const sheetNames = wb.worksheets.filter(s => s.state !== 'veryHidden').map(s => s.name);
  console.log('생성된 시트 목록:', sheetNames);
  assert.ok(sheetNames.includes('9.12(토)'), '9.12(토) 시트 존재 확인');
  assert.ok(sheetNames.includes('9.13(일)'), '9.13(일) 시트 존재 확인');

  const s1 = wb.getWorksheet('9.12(토)');
  assert.strictEqual(s1.getCell('A1').value, '9/12(토)');
  assert.strictEqual(s1.getCell('A2').value, 'NO');
  assert.strictEqual(s1.getCell('B2').value, '담당플래너');
  assert.strictEqual(s1.getCell('A3').value, 1);
  assert.strictEqual(s1.getCell('B3').value, '강현영');
  assert.strictEqual(s1.getCell('C3').value, '김일지');
  assert.strictEqual(s1.getCell('F3').value, 'S-303'); // 정제된 부케명!
  assert.strictEqual(s1.getCell('H3').value, '11시 30분 아웃 / 싱싱하게');

  console.log('✓ WMON 날짜별 시트 분리 및 서식 생성 검증 통과');

  // 촬영용 시트 테스트
  const shootOrders = [
    {
      담당플래너: '김소미',
      신부명: '장수민',
      날짜: '09/09(수)',
      배송지: '멥시',
      배송시간: '',
      발주부케: '촬영 부케 - 80,000원',
      '특이사항(기타사항)': '노랑 / 3시 아웃',
      리허설장소: '어바웃제인',
      리허설시간: '15:30',
    },
  ];
  const shootAgg = aggregateOrders(shootOrders, 'swed');
  const shootWb = await createBaljuWorkbook(shootAgg, { orderType: 'RMON' });
  assert.strictEqual(shootWb.worksheets.filter(s => s.state !== 'veryHidden').length, 1);
  assert.strictEqual(shootWb.worksheets[0].name, '촬영');
  assert.strictEqual(shootWb.worksheets[0].getCell('B2').value, '김소미-S웨딩'); // S웨딩 플래너 표기!
  console.log('✓ RMON 촬영용 단일 시트 및 서식 생성 검증 통과');

  console.log('--- 모든 엑셀 단위 테스트 성공! ---');
}

runExcelTests().catch(err => {
  console.error(err);
  process.exit(1);
});
