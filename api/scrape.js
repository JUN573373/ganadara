import { ScrapeSession, SITES } from './_engine.js';

export const config = {
  maxDuration: 60, // 최대 60초 허용
};

export default async function handler(req, res) {
  // CORS 및 프리플라이트
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
  }

  const { sites = [], accounts = {}, options = {} } = req.body || {};

  if (!Array.isArray(sites) || sites.length === 0) {
    return res.status(400).json({ error: '수집할 기관(sites)을 하나 이상 선택해 주세요.' });
  }

  const { orderType = 'WMON', startDate, endDate, onlyUnconfirmed = true } = options;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: '시작일과 종료일을 지정해 주세요.' });
  }

  // SSE 스트리밍 헤더 설정
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('log', { level: 'info', message: 'Vercel 서버리스 수집 환경 시작' });

  const finalResults = {};
  let hasPartialError = false;

  // 클라이언트 연결 종료 감지
  let isClientClosed = false;
  req.on('close', () => {
    isClientClosed = true;
  });

  try {
    for (const siteKey of sites) {
      if (isClientClosed) {
        sendEvent('log', { level: 'warn', message: '클라이언트 연결이 종료되어 수집을 중단합니다.' });
        break;
      }

      const siteDef = SITES[siteKey];
      if (!siteDef) continue;

      const account = accounts[siteKey];
      if (!account || !account.id || !account.password) {
        sendEvent('log', { level: 'error', message: `${siteDef.label} · 계정 정보(아이디/비밀번호)가 누락되었습니다.` });
        continue;
      }

      const session = new ScrapeSession(siteDef);

      try {
        sendEvent('log', { level: 'info', message: `${siteDef.label} · 로그인 진행 중...` });
        await session.login(account.id, account.password);
        sendEvent('log', { level: 'success', message: `${siteDef.label} · 로그인 성공` });

        const siteOrders = await session.collectOrders({
          orderType,
          startDate,
          endDate,
          onlyUnconfirmed,
          onLog: (level, message) => {
            sendEvent('log', { level, message });
          },
        });

        finalResults[siteKey] = siteOrders;
      } catch (siteErr) {
        hasPartialError = true;
        sendEvent('log', { level: 'error', message: `${siteDef.label} 수집 실패: ${siteErr.message}` });
        finalResults[siteKey] = [];
      }
    }

    sendEvent('done', {
      ok: !hasPartialError || Object.values(finalResults).some(arr => arr && arr.length > 0),
      hasPartialError,
      results: finalResults,
    });
  } catch (globalErr) {
    sendEvent('error', { message: globalErr.message || '서버 내부 오류' });
  } finally {
    res.end();
  }
}
