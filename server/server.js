'use strict';

require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const config = require('./config/config');
const connectDB = require('./config/db');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/error');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const groupRoutes = require('./routes/groups');
const storyRoutes = require('./routes/stories');
const channelRoutes = require('./routes/channels');
const channelPostRoutes = require('./routes/channelPosts');
const mediaRoutes = require('./routes/media');
const { startSweeper } = require('./services/storyService');
const { bootstrapOwner } = require('./services/ownerService');
const blockRoutes = require('./routes/blocks');
const reportRoutes = require('./routes/reports');
const ownerRoutes = require('./routes/owner');
const callRoutes = require('./routes/calls');
const Call = require('./models/Call');
const initSockets = require('./sockets');

const app = express();
const server = http.createServer(app);
app.set('io', initSockets(server));

app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    }
  })
);

if (config.corsOrigins.length) {
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
}

// Update profil boleh membawa foto kecil (data URL); route lain tetap 10 KB.
app.use('/api/users/me', express.json({ limit: '120kb' }));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.use('/api', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/channel-posts', channelPostRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/blocks', blockRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/calls', callRoutes);
app.use('/api', notFound);

const clientDir = path.join(__dirname, '..', 'client');
app.use(express.static(clientDir));

// Routing sisi client (SPA): path aplikasi dilayani index.html. Aset memakai path absolut.
const SPA_PATHS = ['/app', '/stories', '/channels', '/channels/*', '/calls', '/chat/*', '/profile', '/profile/*', '/settings', '/settings/*', '/owner', '/owner/*', '/groups', '/groups/*', '/join/*', '/channel/*'];
app.get(SPA_PATHS, (req, res) => res.sendFile(path.join(clientDir, 'index.html')));

app.use(errorHandler);

connectDB()
  .then(() => bootstrapOwner())
  .then(() => {
    startSweeper();
    Call.updateMany({ status: 'ringing' }, { $set: { status: 'failed', endedAt: new Date() } }).catch(() => {}); // sisa panggilan sebelum restart
    server.listen(config.port, () => console.log(`[server] XenChat berjalan di http://localhost:${config.port}`));
  })
  .catch((err) => {
    console.error('[server] Gagal terhubung ke MongoDB:', err.message);
    process.exit(1);
  });
