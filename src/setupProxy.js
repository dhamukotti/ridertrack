// src/setupProxy.js
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'https://uat.zippyrideuserapi.projectpulse360.com',
      changeOrigin: true,
      secure: false,
      pathRewrite: {
        '^/api': '/api', // optional: keeps /api prefix intact
      },
    })
  );
};
