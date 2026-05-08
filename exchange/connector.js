// exchange/connector.js — підключення до бірж через CCXT
const ccxt = require('ccxt');
const logger = require('../utils/logger');

class ExchangeConnector {
  constructor(config) {
    this.config = config;
    this.exchange = null;
  }

  // ── Ініціалізація ──────────────────────────────────────
  async init(exchangeId, apiKey, apiSecret, passphrase) {
    const ExchangeClass = ccxt[exchangeId];
    if (!ExchangeClass) throw new Error(`Біржа "${exchangeId}" не підтримується`);

    const params = {
      apiKey,
      secret: apiSecret,
      enableRateLimit: true,
      options: { defaultType: 'spot' }
    };
    if (passphrase) params.password = passphrase;

    this.exchange = new ExchangeClass(params);

    // Перевірка з'єднання
    await this.exchange.loadMarkets();
    logger.info(`Підключено до ${exchangeId.toUpperCase()}`);
    return true;
  }

  // ── Баланс ────────────────────────────────────────────
  async getBalance(currency = 'USDT') {
    if (!this.exchange) throw new Error('API не підключено. Введіть ключі у Конфігурації.');
    const bal = await this.exchange.fetchBalance();
    return {
      free:  bal[currency]?.free  ?? 0,
      used:  bal[currency]?.used  ?? 0,
      total: bal[currency]?.total ?? 0
    };
  }

  // ── Тікер ─────────────────────────────────────────────
  // Тікер — працює навіть БЕЗ API ключів (публічний endpoint)
  async getTicker(symbol) {
    if (this.exchange) {
      return await this.exchange.fetchTicker(symbol);
    }
    const exName = (process.env.EXCHANGE || 'binance').toLowerCase();
    const ExClass = ccxt[exName] || ccxt.binance;
    const pub = new ExClass({ enableRateLimit: true });
    return await pub.fetchTicker(symbol);
  }

  // ── OHLCV свічки ──────────────────────────────────────
  async getOHLCV(symbol, timeframe = '15m', limit = 100) {
    const raw = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    return raw.map(([ts, o, h, l, c, v]) => ({ ts, open:o, high:h, low:l, close:c, volume:v }));
  }

  // ── Відкриття ринкового ордеру ────────────────────────
  async marketOrder(symbol, side, amountUsdt, currentPrice) {
    const amount = parseFloat((amountUsdt / currentPrice).toFixed(6));
    logger.info(`Відкриваємо ${side.toUpperCase()} ${symbol} | ${amount} @ ~${currentPrice}`);
    const order = await this.exchange.createMarketOrder(symbol, side, amount);
    logger.info('Ордер відкрито', { id: order.id, status: order.status });
    return order;
  }

  // ── Встановлення TP / SL через limit-ордери ──────────
  async setTpSl(symbol, side, amount, entryPrice, tpPct, slPct) {
    const isBuy = side === 'buy';
    const tpPrice = entryPrice * (1 + (isBuy ? 1 : -1) * tpPct / 100);
    const slPrice = entryPrice * (1 - (isBuy ? 1 : -1) * slPct / 100);

    const closeSide = isBuy ? 'sell' : 'buy';

    // Take Profit
    const tp = await this.exchange.createLimitOrder(symbol, closeSide, amount, tpPrice);
    // Stop Loss (якщо біржа підтримує stopLoss)
    let sl = null;
    try {
      sl = await this.exchange.createOrder(symbol, 'stop_market', closeSide, amount, undefined, {
        stopPrice: slPrice,
        reduceOnly: true
      });
    } catch {
      // Fallback: звичайний limit SL
      sl = await this.exchange.createLimitOrder(symbol, closeSide, amount, slPrice);
    }

    logger.info(`TP встановлено @ ${tpPrice.toFixed(4)} | SL @ ${slPrice.toFixed(4)}`);
    return { tpOrder: tp, slOrder: sl, tpPrice, slPrice };
  }

  // ── Скасування ордеру ────────────────────────────────
  async cancelOrder(orderId, symbol) {
    return await this.exchange.cancelOrder(orderId, symbol);
  }

  // ── Відкриті позиції / ордери ─────────────────────────
  async getOpenOrders(symbol) {
    return await this.exchange.fetchOpenOrders(symbol);
  }

  // ── Історія угод ─────────────────────────────────────
  async getTradeHistory(symbol, limit = 50) {
    return await this.exchange.fetchMyTrades(symbol, undefined, limit);
  }

  isConnected() { return !!this.exchange; }
}

module.exports = new ExchangeConnector();
