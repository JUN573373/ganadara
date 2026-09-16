import { ScrapeSession, SITES } from './_engine.js';

export default async function handler(req, res) {
  // CORS 헤더 설정 (자체 도메인 또는 동일 오리진)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const startTime = Date.now();

  try {
    const params = req.method === 'POST' ? req.body : req.query;
    const { site, id, password } = params || {};

    if (!site || !SITES[site]) {
      return res.status(400).json({
        ok: false,
        error: 'site 파라미터가 올바르지 않습니다 (ini 또는 swed).',
      });
    }

    if (!id || !password) {
      return res.status(400).json({
        ok: false,
        error: 'id와 password를 제공해 주세요.',
      });
    }

    const session = new ScrapeSession(site);
    const result = await session.testConnection(id, password);
    const elapsedMs = Date.now() - startTime;

    return res.status(200).json({
      ok: true,
      site,
      status: 'connected',
      elapsedMs,
      message: result.message,
    });
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    return res.status(200).json({
      ok: false,
      status: 'error',
      elapsedMs,
      error: err.message || '연결 테스트 중 오류 발생',
    });
  }
}
