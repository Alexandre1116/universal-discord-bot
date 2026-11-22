const { getConfig } = require('../utils/config');

// Middleware simples de autenticação local
function authMiddleware(req, res, next) {
  // Permitir rotas públicas
  const publicPaths = ['/api/auth/login', '/api/auth/status'];
  if (publicPaths.includes(req.path)) {
    return next();
  }

  // Verificar sessão
  if (req.session && req.session.user) {
    return next();
  }

  return res.status(401).json({ success: false, error: 'Não autenticado.' });
}

function setupAuthRoutes(app, loginLimiter) {
  // GET /api/auth/status
  app.get('/api/auth/status', (req, res) => {
    res.json({
      loggedIn: !!(req.session && req.session.user),
      user: req.session?.user || null
    });
  });

  // POST /api/auth/login
  app.post('/api/auth/login', loginLimiter || ((req, res, next) => next()), (req, res) => {
    const { username, password } = req.body;
    const config = getConfig();
    
    if (!config.webAuth) {
      return res.status(500).json({ success: false, error: 'Credenciais não configuradas no servidor.' });
    }

    // Comparação em tempo constante: `===` pára ao primeiro byte diferente e
    // filtra informação a quem consegue medir o tempo do pedido. Os dois lados
    // são resumidos com SHA-256 para terem sempre o mesmo comprimento.
    const crypto = require('crypto');
    const safeEqual = (a, b) => {
      const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
      const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
      return crypto.timingSafeEqual(ha, hb);
    };

    if (safeEqual(username, config.webAuth.username) && safeEqual(password, config.webAuth.password)) {
      req.session.user = {
        username: username,
        isAdmin: true
      };
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, error: 'Credenciais inválidas.' });
    }
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });
}

module.exports = { authMiddleware, setupAuthRoutes };
