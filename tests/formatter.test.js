import assert from 'node:assert';
import {
  cleanBouquetName,
  extractOutTime,
  formatNotes,
  aggregateOrders,
  getWeeklyPresetDates,
  generateDeliveryMessage,
} from '../src/formatter.js';

function runFormatterTests() {
  console.log('--- Formatter 단위 테스트 시작 ---');

  // 1. 부케 등급/코드 추출 검증
  assert.strictEqual(cleanBouquetName('[본식9/1-] VS플러스 -5 (수임료차감포함)'), 'VS+');
  assert.strictEqual(cleanBouquetName('[서비스 본식부케] VS 플러스 (수임료차감-15만원)'), 'VS+');
  assert.strictEqual(cleanBouquetName('Vs+512 화이트장미그린'), 'VS+512');
  assert.strictEqual(cleanBouquetName('VS+573 마르샤그린'), 'VS+573');
  assert.strictEqual(cleanBouquetName('[본식 9/1-] BL-15 (수임료차감포함)'), 'BL-15');
  assert.strictEqual(cleanBouquetName('[본식 9/1-] BL-16(수임료차감포함)'), 'BL-16');
  assert.strictEqual(cleanBouquetName('BL-1228블랑카베어'), 'BL-1228');
  assert.strictEqual(cleanBouquetName('[본식9/1-] VVS-6 (수임료차감포함)'), 'VVS-6');
  assert.strictEqual(cleanBouquetName('[서비스 본식부케] S'), 'S');
  assert.strictEqual(cleanBouquetName('[촬영부케] S 10만원'), 'S');
  assert.strictEqual(cleanBouquetName('S-303화이트장미보리사초'), 'S-303');
  assert.strictEqual(cleanBouquetName('[촬영부케] 8만원 - 80,000원'), '8만원');
  assert.strictEqual(cleanBouquetName('[본식추가] 10만원 - 100,000원'), '[추가] 10만원');
  console.log('✓ 부케명 정제 및 등급/코드 추출 통과');

  // 2. 아웃 시간 추출 검증
  assert.strictEqual(extractOutTime('11시 30분 아웃 / 싱싱하게'), '11시 30분 아웃');
  assert.strictEqual(extractOutTime('7시 아웃 / 카톡 시안'), '7시 아웃');
  assert.strictEqual(extractOutTime('14:00 아웃'), '14시 아웃');
  assert.strictEqual(extractOutTime('9:30 아웃'), '9시 30분 아웃');
  assert.strictEqual(extractOutTime('메이크업샵 도착 요청'), '');
  console.log('✓ 아웃 시간 추출 통과');

  // 3. 특이사항 포맷 검증
  assert.strictEqual(formatNotes('11시 30분 아웃 / 싱싱하게'), '11시 30분 아웃 / 싱싱하게');
  assert.strictEqual(formatNotes('싱싱하게 / 11시 30분 아웃'), '11시 30분 아웃 / 싱싱하게');
  console.log('✓ 특이사항 표준화 통과');

  // 4. 주문 합산 검증
  const sampleOrders = [
    { 담당플래너: '강현영', 신부명: '김일지', 날짜: '09/12(토)', 발주부케: 'S-303', '특이사항(기타사항)': '11시 아웃' },
    { 담당플래너: '강현영', 신부명: '김일지', 날짜: '09/12(토)', 발주부케: '[추가] 10만원', '특이사항(기타사항)': '부토니에 추가' },
    { 담당플래너: '다른플래너', 신부명: '박신부', 날짜: '09/12(토)', 발주부케: 'VS+', '특이사항(기타사항)': '' },
  ];
  const aggregated = aggregateOrders(sampleOrders, 'ini');
  assert.strictEqual(aggregated.length, 2);
  assert.strictEqual(aggregated[0]._isAggregated, true);
  assert.strictEqual(aggregated[0]['발주부케'], 'S-303 + [추가] 10만원');
  assert.strictEqual(aggregated[0]['특이사항'], '11시 아웃 / 부토니에 추가');
  console.log('✓ 동일 고객 주문 합산 통과');

  // 5. 배송안내 문자 생성 검증
  const msg = generateDeliveryMessage(aggregated[0]);
  assert.ok(msg.includes('【OZIC BLOSSOM 배송안내】'));
  assert.ok(msg.includes('9월 12일 (토) 김일지신부님'));
  assert.ok(msg.includes('배송예정입니다.'));
  console.log('✓ 배송안내 문자 양식 생성 통과');

  // 6. 주간 조회 일자 계산 검증
  const weekly = getWeeklyPresetDates(new Date('2026-09-16')); // 수요일
  console.log('주간 프리셋 테스트 결과:', weekly);
  assert.ok(weekly.startDate && weekly.endDate);

  console.log('--- 모든 Formatter 검증 성공! ---');
}

runFormatterTests();
