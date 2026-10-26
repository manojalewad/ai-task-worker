require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const { configureCloudinary } = require('./config/cloudinary');
const { authenticate } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const invoiceRoutes = require('./routes/invoices');
const taskRoutes = require('./routes/tasks');
const companyRoutes = require('./routes/company');
const llm = require('./llm');
const { recoverStuckTasks } = require('./agent');
const HttpError = require('./utils/httpError');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' }, contentSecurityPolicy: false }));
app.use(cors({ origin: (origin, cb) => {
  if (!origin || process.env.NODE_ENV !== 'production') return cb(null, true);
  const configured = (process.env.CLIENT_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
  const allowed = [...configured, process.env.RENDER_EXTERNAL_URL].filter(Boolean);
  return allowed.includes(origin) ? cb(null, true) : cb(new Error('Origin is not allowed by CORS'));
}, credentials: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
const noLimit = (req, res, next) => next();
app.use('/api', process.env.NODE_ENV === 'test' ? noLimit : rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false }));
app.get('/api/health', (req, res) => res.json({ success: true, service: 'company-ai-worker', status: 'ok', timestamp: new Date().toISOString(), planner: llm.isConfigured() ? 'llm' : 'rules', integrations: { gemini: llm.isConfigured(), storage: require('./services/storage').provider(), database: require('mongoose').connection.readyState === 1 } }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }), authRoutes);
app.use('/api/invoices', authenticate, invoiceRoutes);
app.use('/api/tasks', authenticate, taskRoutes);
app.use('/api/company', authenticate, companyRoutes);
app.use('/api/*', (req, res, next) => next(new HttpError(404, 'API endpoint not found.', 'API_NOT_FOUND')));
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(clientDist, 'index.html')));
}
app.use(errorHandler);
async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters. Copy .env.example and set a secure secret.');
  configureCloudinary();
  await connectDB();
  const { Company } = require('./models');
  if (process.env.AUTO_SEED === 'true' || (process.env.__MEMORY_DB && !(await Company.countDocuments()))) { await require('./services/seedService').seed({ log: () => {} }); console.log('Demo data seeded: admin@acme.demo / DemoPass123!'); }
  const port = Number(process.env.PORT) || 5000;
  app.listen(port, async () => { console.log(`Company AI Worker listening on port ${port} · planner: ${llm.isConfigured() ? 'Gemini (' + llm.modelName() + ') with rules fallback' : 'deterministic rules (no GEMINI_API_KEY)'}`); const n = await recoverStuckTasks().catch(() => 0); if (n) console.log(`Resumed ${n} interrupted task(s).`); });
}
if (require.main === module) start().catch(err => { console.error('Server startup failed:', err.message); process.exit(1); });
module.exports = app;
