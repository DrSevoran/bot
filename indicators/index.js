// indicators/index.js — технічний аналіз (MACD, RSI, BB, Grid, DCA)
const {
  MACD, RSI, BollingerBands, EMA, SMA
} = require('technicalindicators');

// ── Витягуємо масив close-цін ─────────────────────────
const closes = (candles) => candles.map(c => c.close);

// ─────────────────────────────────────────────────────────
//  MACD Crossover
//  Сигнал BUY:  MACD перетинає Signal знизу вгору
//  Сигнал SELL: MACD перетинає Signal зверху вниз
// ─────────────────────────────────────────────────────────
function macdSignal(candles) {
  if (candles.length < 50) return null;
  const values = closes(candles);

  const result = MACD.calculate({
    values,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });

  if (result.length < 2) return null;
  const prev = result[result.length - 2];
  const curr = result[result.length - 1];
  if (!prev || !curr) return null;

  if (prev.MACD < prev.signal && curr.MACD > curr.signal) return 'buy';
  if (prev.MACD > prev.signal && curr.MACD < curr.signal) return 'sell';
  return null;
}

// ─────────────────────────────────────────────────────────
//  RSI Reversal
//  BUY:  RSI < 30 (перепродано) → вхід у лонг
//  SELL: RSI > 70 (перекуплено) → вхід у шорт / вихід
// ─────────────────────────────────────────────────────────
function rsiSignal(candles) {
  if (candles.length < 20) return null;
  const values = closes(candles);

  const result = RSI.calculate({ values, period: 14 });
  if (!result.length) return null;
  const rsi = result[result.length - 1];

  if (rsi < 30) return 'buy';
  if (rsi > 70) return 'sell';
  return null;
}

// ─────────────────────────────────────────────────────────
//  Bollinger Bands Breakout
//  BUY:  ціна пробиває нижню смугу знизу вгору
//  SELL: ціна пробиває верхню смугу зверху вниз
// ─────────────────────────────────────────────────────────
function bbSignal(candles) {
  if (candles.length < 25) return null;
  const values = closes(candles);

  const bands = BollingerBands.calculate({ values, period: 20, stdDev: 2 });
  if (bands.length < 2) return null;

  const prev = bands[bands.length - 2];
  const curr = bands[bands.length - 1];
  const prevClose = values[values.length - 2];
  const currClose = values[values.length - 1];

  if (prevClose < prev.lower && currClose > curr.lower) return 'buy';
  if (prevClose > prev.upper && currClose < curr.upper) return 'sell';
  return null;
}

// ─────────────────────────────────────────────────────────
//  Grid Trading
//  Ділить діапазон ціни на N рівних сіток
//  Купує на кожному рівні вниз, продає вгору
// ─────────────────────────────────────────────────────────
class GridStrategy {
  constructor(levels = 10, rangePct = 5) {
    this.levels = levels;
    this.rangePct = rangePct;
    this.gridPrices = [];
    this.lastPrice = null;
  }

  setup(currentPrice) {
    const half = (this.rangePct / 2) / 100;
    const low  = currentPrice * (1 - half);
    const high = currentPrice * (1 + half);
    const step = (high - low) / this.levels;
    this.gridPrices = Array.from({ length: this.levels + 1 }, (_, i) => low + i * step);
    this.lastPrice = currentPrice;
  }

  signal(currentPrice) {
    if (!this.gridPrices.length) this.setup(currentPrice);
    if (!this.lastPrice) { this.lastPrice = currentPrice; return null; }

    for (let i = 0; i < this.gridPrices.length - 1; i++) {
      const lower = this.gridPrices[i];
      const upper = this.gridPrices[i + 1];
      // Ціна перетнула рівень сітки вниз → купуємо
      if (this.lastPrice >= lower && currentPrice < lower) {
        this.lastPrice = currentPrice;
        return 'buy';
      }
      // Ціна перетнула рівень вгору → продаємо
      if (this.lastPrice <= upper && currentPrice > upper) {
        this.lastPrice = currentPrice;
        return 'sell';
      }
    }
    this.lastPrice = currentPrice;
    return null;
  }
}

// ─────────────────────────────────────────────────────────
//  DCA (Dollar Cost Averaging)
//  Купує кожного разу, коли ціна падає на dip%
//  Продає при досягненні profit%
// ─────────────────────────────────────────────────────────
class DCAStrategy {
  constructor(dipPct = 2, profitPct = 3) {
    this.dipPct = dipPct;
    this.profitPct = profitPct;
    this.avgEntry = null;
    this.lastBuy = null;
  }

  signal(currentPrice) {
    if (!this.lastBuy) {
      this.lastBuy = currentPrice;
      this.avgEntry = currentPrice;
      return 'buy';
    }

    const dropFromLast = (this.lastBuy - currentPrice) / this.lastBuy * 100;
    if (dropFromLast >= this.dipPct) {
      this.avgEntry = (this.avgEntry + currentPrice) / 2;
      this.lastBuy = currentPrice;
      return 'buy';
    }

    if (this.avgEntry && (currentPrice - this.avgEntry) / this.avgEntry * 100 >= this.profitPct) {
      this.avgEntry = null;
      this.lastBuy = null;
      return 'sell';
    }
    return null;
  }
}

// ── Головна функція: отримати сигнал за обраною стратегією ──
const gridInstance = new GridStrategy();
const dcaInstance  = new DCAStrategy();

function getSignal(strategy, candles) {
  const price = candles[candles.length - 1].close;
  switch (strategy) {
    case 'macd':  return macdSignal(candles);
    case 'rsi':   return rsiSignal(candles);
    case 'bb':    return bbSignal(candles);
    case 'grid':  return gridInstance.signal(price);
    case 'dca':   return dcaInstance.signal(price);
    default:      return macdSignal(candles);
  }
}

module.exports = { getSignal, macdSignal, rsiSignal, bbSignal, GridStrategy, DCAStrategy };
