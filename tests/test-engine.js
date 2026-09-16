import { ScrapeSession } from '../api/_engine.js';

async function test() {
  console.log('--- 1. 아이니웨딩 연결 테스트 ---');
  const iniSession = new ScrapeSession('ini');
  const iniConn = await iniSession.testConnection('bus151a00009', 'xkdla');
  console.log('아이니 결과:', iniConn);

  console.log('--- 2. S웨딩 연결 테스트 ---');
  const swedSession = new ScrapeSession('swed');
  const swedConn = await swedSession.testConnection('bus151a00009', 'xkdla');
  console.log('S웨딩 결과:', swedConn);

  console.log('--- 3. 아이니웨딩 소량 수집 테스트 (RMON) ---');
  const orders = await iniSession.collectOrders({
    orderType: 'RMON',
    startDate: '2026-09-09',
    endDate: '2026-09-16',
    onlyUnconfirmed: true,
    onLog: (level, msg) => console.log(`[LOG:${level}] ${msg}`),
  });
  console.log(`아이니 수집 완료: ${orders.length}건`);
  if (orders.length > 0) {
    console.log('첫 번째 데이터 샘플:', orders[0]);
  }
}

test().catch(err => {
  console.error('테스트 실패:', err);
  process.exit(1);
});
