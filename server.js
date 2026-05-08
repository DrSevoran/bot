// server.js — REST API + WebSocket для dashboard
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const { WebSocketServer } = require('ws');
const path       = require('path');

const exchange   = require('./exchange/connector');
const bot        = require('./bot/engine');
const logger     = require('./utils/logger');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // dashboard HTML

// ════════════════════════════════════════════════════════
//  WebSocket — push-оновлення до дашборду
// ════════════════════════════════════════════════════════
const broadcast = (type, data) => {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
};

wss.on('connection', (ws) => {
  logger.info('WebSocket: новий клієнт підключився');
  ws.send(JSON.stringify({ type: 'init', data: { stats: bot.getStats(), trades: bot.trades.slice(0,20) } }));
});

// Прокидаємо події бота у WebSocket
bot.on('started',      ()  => broadcast('status',  { running: true }));
bot.on('stopped',      ()  => broadcast('status',  { running: false }));
bot.on('trade_opened', (t) => broadcast('trade_opened', t));
bot.on('trade_closed', (t) => broadcast('trade_closed', t));
bot.on('error',        (e) => broadcast('error', { message: e }));

// Статистика кожні 5 секунд
setInterval(() => {
  if (bot.running) broadcast('stats', bot.getStats());
}, 5000);

// ════════════════════════════════════════════════════════
//  REST API
// ════════════════════════════════════════════════════════

// ── POST /api/connect — підключити API ────────────────
app.post('/api/connect', async (req, res) => {
  try {
    const { exchange: ex, apiKey, apiSecret, passphrase } = req.body;
    if (!ex || !apiKey || !apiSecret)
      return res.status(400).json({ ok: false, error: 'Вкажіть exchange, apiKey, apiSecret' });

    await exchange.init(ex, apiKey, apiSecret, passphrase);
    const bal = await exchange.getBalance('USDT');

    logger.info('API підключено', { exchange: ex, balance: bal.free });
    res.json({ ok: true, exchange: ex, balance: bal });
  } catch (err) {
    logger.error('Помилка підключення', { message: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── GET /api/balance — поточний баланс ───────────────
app.get('/api/balance', async (req, res) => {
  try {
    const bal = await exchange.getBalance('USDT');
    res.json({ ok: true, balance: bal });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── GET /api/ticker/:symbol — тікер ──────────────────
app.get('/api/ticker/:symbol', async (req, res) => {
  try {
    const ticker = await exchange.getTicker(req.params.symbol.replace('-', '/'));
    res.json({ ok: true, ticker });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── POST /api/bot/config — налаштувати бота ───────────
app.post('/api/bot/config', (req, res) => {
  try {
    bot.configure(req.body);
    res.json({ ok: true, config: bot.config });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── POST /api/bot/start — запустити бота ─────────────
app.post('/api/bot/start', async (req, res) => {
  try {
    if (req.body && Object.keys(req.body).length) bot.configure(req.body);
    await bot.start();
    res.json({ ok: true, message: 'Бот запущено', stats: bot.getStats() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── POST /api/bot/stop — зупинити бота ───────────────
app.post('/api/bot/stop', (req, res) => {
  bot.stop();
  res.json({ ok: true, message: 'Бот зупинено', stats: bot.getStats() });
});

// ── GET /api/bot/stats — статистика ──────────────────
app.get('/api/bot/stats', (req, res) => {
  res.json({ ok: true, stats: bot.getStats() });
});

// ── GET /api/bot/trades — список угод ────────────────
app.get('/api/bot/trades', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ ok: true, trades: bot.trades.slice(0, limit) });
});

// ── GET /api/candles/:symbol — OHLCV ─────────────────
app.get('/api/candles/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.replace('-', '/');
    const tf     = req.query.tf || '15m';
    const limit  = parseInt(req.query.limit) || 100;
    const candles = await exchange.getOHLCV(symbol, tf, limit);
    res.json({ ok: true, candles });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── 404 ───────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ ok: false, error: 'Маршрут не знайдено' }));

// ════════════════════════════════════════════════════════
//  Запуск сервера
// ════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`AutoTrader сервер запущено на http://localhost:${PORT}`);

  // Автопідключення з .env (якщо є ключі)
  if (process.env.API_KEY && process.env.API_SECRET) {
    exchange
      .init(process.env.EXCHANGE || 'binance', process.env.API_KEY, process.env.API_SECRET, process.env.API_PASSPHRASE)
      .then(() => {
        logger.info('Автопідключення з .env успішне');
        bot.configure({
          pair:      process.env.TRADE_PAIR      || 'BTC/USDT',
          timeframe: process.env.TIMEFRAME       || '15m',
          strategy:  process.env.STRATEGY        || 'macd',
          posSize:   process.env.POSITION_SIZE_USDT || 100,
          sl:        process.env.STOP_LOSS_PCT   || 2.0,
          tp:        process.env.TAKE_PROFIT_PCT || 4.0,
          maxTrades: process.env.MAX_OPEN_TRADES || 3,
          dayLimit:  process.env.MAX_DAILY_TRADES|| 20,
          trailStop: process.env.TRAILING_STOP === 'true',
          bothSides: process.env.BOTH_SIDES === 'true',
        });
      })
      .catch(e => logger.error('Автопідключення не вдалось', { message: e.message }));
  }
});

module.exports = server;
