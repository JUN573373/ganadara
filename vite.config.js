import { defineConfig } from 'vite';

function vercelDevApiPlugin() {
  return {
    name: 'vercel-dev-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname.startsWith('/api/')) {
          // Vercel 런타임 헬퍼 주입
          if (!res.status) {
            res.status = (code) => {
              res.statusCode = code;
              return res;
            };
          }
          if (!res.json) {
            res.json = (data) => {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify(data));
            };
          }

          // Body 파싱
          req.query = Object.fromEntries(url.searchParams);
          if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
            const buffers = [];
            for await (const chunk of req) buffers.push(chunk);
            const rawBody = Buffer.concat(buffers).toString();
            try {
              req.body = JSON.parse(rawBody);
            } catch {
              req.body = rawBody;
            }
          }

          try {
            if (url.pathname === '/api/health') {
              const { default: handler } = await import('./api/health.js');
              return await handler(req, res);
            }
            if (url.pathname === '/api/scrape') {
              const { default: handler } = await import('./api/scrape.js');
              return await handler(req, res);
            }
          } catch (err) {
            console.error('Local API Error:', err);
            return res.status(500).json({ error: err.message });
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [vercelDevApiPlugin()],
  server: {
    host: '127.0.0.1',
    watch: {
      ignored: [
        '**/otvengine/**',
        '**/otvengine-raw/**',
        '**/sg_pj-main/**',
        '**/참고/**',
        '**/참고/**',
      ],
    },
  },
  preview: {
    host: '127.0.0.1',
  },
});
