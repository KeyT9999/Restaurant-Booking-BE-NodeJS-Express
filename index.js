const dns = require('dns');
// Thiết lập DNS để tránh lỗi querySrv ECONNREFUSED trên một số mạng Windows
dns.setServers(['8.8.8.8', '1.1.1.1']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');

// Load env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf?.toString('utf8') || '';
  },
}));
app.use(express.urlencoded({ extended: true }));

// Passport — cần khởi tạo trước khi dùng routes
const { passport } = require('./src/config/passport.config');
app.use(passport.initialize());

// CORS — cho phép FE (Vite :5173) gọi API
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',');
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
}));

// ─────────────────────────────────────────────
// Kết nối MongoDB
// ─────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB connected successfully');

    if (process.env.AI_KNOWLEDGE_AUTO_SEED !== 'false') {
      try {
        const { seedDefaultKnowledge } = require('./src/services/ai/ai-knowledge.service');
        const result = await seedDefaultKnowledge();
        const upserted = result?.upsertedCount || result?.nUpserted || 0;
        if (upserted > 0) {
          console.log(`✅ AI knowledge seed inserted ${upserted} document(s)`);
        }
      } catch (error) {
        console.warn(`⚠️ AI knowledge seed skipped: ${error.message}`);
      }
    }
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────
// Health check — FE dùng để kiểm tra BE đang chạy
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: '🍽️ BookEat API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// Base route
app.get('/', (req, res) => {
  res.json({ message: '🍽️ Welcome to BookEat API', version: '1.0.0' });
});

// API routes (sẽ thêm dần)
const apiRouter = express.Router();
app.use('/api/v1', apiRouter);

// Routes
apiRouter.use('/auth',  require('./src/routes/auth.routes'));
apiRouter.use('/users', require('./src/routes/user.routes'));
apiRouter.use('/admin', require('./src/routes/admin.routes'));
apiRouter.use('/owner', require('./src/routes/owner.routes'));
apiRouter.use('/owner', require('./src/routes/owner.menu.routes'));
apiRouter.use('/owner', require('./src/routes/owner.table.routes'));
apiRouter.use('/owner', require('./src/routes/owner.service.routes'));
apiRouter.use('/owner', require('./src/routes/owner.waitlist.routes'));
apiRouter.use('/upload', require('./src/routes/upload.routes'));
apiRouter.use('/chat', require('./src/routes/chat.routes'));
apiRouter.use('/restaurants', require('./src/routes/restaurant.routes'));
apiRouter.use('/bookings',    require('./src/routes/booking.routes'));
apiRouter.use('/waitlists',   require('./src/routes/waitlist.routes'));
apiRouter.use('/owner',       require('./src/routes/owner.booking.routes'));
apiRouter.use('/owner',       require('./src/routes/owner.billing.routes'));
apiRouter.use('/payments',    require('./src/routes/payment.routes'));
apiRouter.use('/webhooks',    require('./src/routes/webhook.routes'));
apiRouter.use('/refunds',     require('./src/routes/refund.routes'));
apiRouter.use('/vouchers',    require('./src/routes/voucher.routes'));
apiRouter.use('/reviews',     require('./src/routes/review.routes'));
apiRouter.use('/notifications', require('./src/routes/notification.routes'));
apiRouter.use('/customer/favorites', require('./src/routes/customer.favorite.routes'));
apiRouter.use('/ai', require('./src/routes/ai.routes'));

// Test route
apiRouter.get('/ping', (req, res) => {
  res.json({ message: 'pong 🏓', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.url} not found` });
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
const { createSocketServer } = require('./src/socket');
const io = createSocketServer(server, allowedOrigins);
app.set('io', io);

server.listen(PORT, () => {
  console.log(`🚀 BookEat API running at: http://localhost:${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📡 API base: http://localhost:${PORT}/api/v1`);

  // Validate PayOS config
  const { validatePayosConfig } = require('./src/config/payos.config');
  validatePayosConfig();

  // Start subscription expiry cron job
  const { startSubscriptionExpiryJob } = require('./src/services/subscription.service');
  startSubscriptionExpiryJob();

  // Start booking cron jobs
  const { startCronJobs, setSocketIO } = require('./src/cron');
  setSocketIO(io);
  startCronJobs();

  // Start waitlist expiry cron job
  const { startWaitlistExpiryJob } = require('./src/services/waitlist-expiry.service');
  startWaitlistExpiryJob(io);
});
