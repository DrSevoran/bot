// bot/engine.js — ядро торгового бота
const exchange  = require('../exchange/connector');
const { getSignal } = require('../indicators');
const logger    = require('../utils/logger');
const EventEmitter = require('events');

class TradingBot extends EventEmitter {
  constructor() {
    super();
    this.running    = false;
    this.config     = {};
    this.trades     = [];        // Всі угоди сесії
    this.openTrades = [];        // Активні позиції
    this.stats      = { pnl: 0, wins: 0, losses: 0, dailyCount: 0 };
    this.interval   = null;
    this.startTime  = null;
    this._lastDay   = new Date().toDateString();
  }

  // ── Конфігурація ──────────────────────────────────────
  configure(cfg) {
    this.config = {
      pair:       cfg.pair        || 'BTC/USDT',
      timeframe:  cfg.timeframe   || '15m',
      strategy:   cfg.strategy    || 'macd',
      posSize:    parseFloat(cfg.posSize)   || 100,
      sl:         parseFloat(cfg.sl)        || 2.0,
      tp:         parseFloat(cfg.tp)        || 4.0,
      maxTrades:  parseInt(cfg.maxTrades)   || 3,
      dayLimit:   parseInt(cfg.dayLimit)    || 20,
      trailStop:  cfg.trailStop  === true,
      bothSides:  cfg.bothSides  === true,
    };
    logger.info('Конфігурацію збережено', this.config);
  }

  // ── Запуск ────────────────────────────────────────────
  async start() {
    if (this.running) return;
    if (!exchange.isConnected()) throw new Error('Спочатку підключіться до API');

    this.running   = true;
    this.startTime = Date.now();
    this.stats     = { pnl: 0, wins: 0, losses: 0, dailyCount: 0 };

    const tfMs = this._tfToMs(this.config.timeframe);
    this.interval = setInterval(() => this._tick(), tfMs);

    this.emit('started');
    logger.info(`Бот запущено | ${this.config.pair} | ${this.config.strategy.toUpperCase()} | ${this.config.timeframe}`);
    await this._tick(); // перший тік одразу
  }

  // ── Зупинка ───────────────────────────────────────────
  stop() {
    if (!this.running) return;
    clearInterval(this.interval);
    this.running = false;
    this.emit('stopped');
    logger.info('Бот зупинено');
  }

  // ── Головний тік ──────────────────────────────────────
  async _tick() {
    try {
      // Скидаємо денний лічильник о новому дні
      const today = new Date().toDateString();
      if (today !== this._lastDay) { this.stats.dailyCount = 0; this._lastDay = today; }

      // Перевіряємо ліміт денних угод
      if (this.stats.dailyCount >= this.config.dayLimit) {
        logger.warn('Денний ліміт угод досягнуто');
        return;
      }

      // Оновлюємо відкриті позиції (перевіряємо TP/SL)
      await this._checkOpenTrades();

      // Ліміт одночасних позицій
      if (this.openTrades.length >= this.config.maxTrades) return;

      // Отримуємо свічки та сигнал
      const candles = await exchange.getOHLCV(this.config.pair, this.config.timeframe, 120);
      const signal  = getSignal(this.config.strategy, candles);

      if (!signal) return;
      if (signal === 'sell' && !this.config.bothSides) return; // Spot: тільки BUY

      const ticker = await exchange.getTicker(this.config.pair);
      const price  = ticker.last;

      await this._openTrade(signal, price);

    } catch (err) {
      logger.error('Помилка у тіку бота', { message: err.message });
      this.emit('error', err.message);
    }
  }

  // ── Відкриття угоди ───────────────────────────────────
  async _openTrade(side, price) {
    const order = await exchange.marketOrder(this.config.pair, side, this.config.posSize, price);

    const tpSl = await exchange.setTpSl(
      this.config.pair, side,
      order.amount,
      price,
      this.config.tp,
      this.config.sl
    );

    const trade = {
      id:         order.id,
      pair:       this.config.pair,
      side:       side.toUpperCase(),
      entryPrice: price,
      amount:     order.amount,
      posSize:    this.config.posSize,
      tpPrice:    tpSl.tpPrice,
      slPrice:    tpSl.slPrice,
      tpOrderId:  tpSl.tpOrder?.id,
      slOrderId:  tpSl.slOrder?.id,
      openTime:   Date.now(),
      status:     'OPEN',
      pnl:        null
    };

    this.openTrades.push(trade);
    this.trades.unshift(trade);
    this.stats.dailyCount++;

    this.emit('trade_opened', trade);
    logger.info('Угоду відкрито', { id: trade.id, side, price, tp: tpSl.tpPrice, sl: tpSl.slPrice });
  }

  // ── Перевірка відкритих позицій ───────────────────────
  async _checkOpenTrades() {
    if (!this.openTrades.length) return;

    const ticker = await exchange.getTicker(this.config.pair);
    const price  = ticker.last;

    for (let i = this.openTrades.length - 1; i >= 0; i--) {
      const t = this.openTrades[i];
      const isBuy  = t.side === 'BUY';

      const hitTp = isBuy ? price >= t.tpPrice : price <= t.tpPrice;
      const hitSl = isBuy ? price <= t.slPrice : price >= t.slPrice;

      // Trailing stop: підтягуємо SL за ціною
      if (this.config.trailStop && isBuy && price > t.entryPrice) {
        t.slPrice = Math.max(t.slPrice, price * (1 - this.config.sl / 100));
      }

      if (hitTp || hitSl) {
        const exitPrice = hitTp ? t.tpPrice : t.slPrice;
        const pnl = isBuy
          ? (exitPrice - t.entryPrice) / t.entryPrice * t.posSize
          : (t.entryPrice - exitPrice) / t.entryPrice * t.posSize;

        t.exitPrice = exitPrice;
        t.pnl       = parseFloat(pnl.toFixed(4));
        t.status    = hitTp ? 'TP_HIT' : 'SL_HIT';
        t.closeTime = Date.now();

        // Скасовуємо протилежний ордер
        try {
          const cancelId = hitTp ? t.slOrderId : t.tpOrderId;
          if (cancelId) await exchange.cancelOrder(cancelId, this.config.pair);
        } catch { /* ордер вже закрито */ }

        this.stats.pnl += t.pnl;
        if (t.pnl > 0) this.stats.wins++; else this.stats.losses++;

        this.openTrades.splice(i, 1);
        this.emit('trade_closed', t);
        logger.info(`Угоду закрито (${t.status})`, { pnl: t.pnl, exitPrice });
      }
    }
  }

  // ── Статистика ────────────────────────────────────────
  getStats() {
    const total = this.stats.wins + this.stats.losses;
    return {
      running:    this.running,
      pnl:        parseFloat(this.stats.pnl.toFixed(4)),
      wins:       this.stats.wins,
      losses:     this.stats.losses,
      winRate:    total ? Math.round(this.stats.wins / total * 100) : 0,
      totalTrades: this.trades.length,
      openTrades:  this.openTrades.length,
      dailyCount:  this.stats.dailyCount,
      uptimeMs:    this.startTime ? Date.now() - this.startTime : 0
    };
  }

  // ── Хелпер: таймфрейм → мілісекунди ──────────────────
  _tfToMs(tf) {
    const map = { '1m':60e3,'5m':5*60e3,'15m':15*60e3,'1h':60*60e3,'4h':4*60*60e3,'1d':24*60*60e3 };
    return map[tf] || 15*60e3;
  }
}

module.exports = new TradingBot();

// bot/engine.js — у циклі моніторингу позицій
async monitorPositions() {
  for (const position of this.openPositions) {
    if (position.exchange === 'mexc' && position.type === 'spot') {
      const ticker = await this.connector.fetchTicker(position.symbol);
      const currentPrice = ticker.last;
      
      // Ручна перевірка Stop-Loss
      if (position.stopLossPrice && currentPrice <= position.stopLossPrice) {
        logger.info(`MEXC SL triggered: ${position.symbol} @ ${currentPrice}`);
        await this.connector.createOrder(
          position.symbol, 'market', 'sell', position.amount
        );
        await this.closePosition(position.id, 'SL_HIT');
      }
      
      // Ручна перевірка Take-Profit
      if (position.takeProfitPrice && currentPrice >= position.takeProfitPrice) {
        logger.info(`MEXC TP triggered: ${position.symbol} @ ${currentPrice}`);
        await this.connector.createOrder(
          position.symbol, 'market', 'sell', position.amount
        );
        await this.closePosition(position.id, 'TP_HIT');
      }
    }
  }
}
