# 🤖 AutoTrader Bot

Автоматичний торговий бот для криптовалютних бірж з Node.js + CCXT.

## Підтримувані біржі
Binance · Bybit · OKX · KuCoin · Gate.io (і 100+ через CCXT)

## Стратегії
| ID | Назва | Опис |
|---|---|---|
| `macd` | MACD Crossover | Перетин MACD та Signal лінії |
| `rsi` | RSI Reversal | Вхід при RSI < 30 або > 70 |
| `bb` | Bollinger Bands | Пробій верхньої/нижньої смуги |
| `grid` | Grid Trading | Купівля/продаж по рівнях сітки |
| `dca` | DCA | Усереднення при падінні ціни |

---

## Встановлення

```bash
# 1. Клонуємо / розпаковуємо проект
cd trading-bot

# 2. Встановлюємо залежності
npm install

# 3. Налаштовуємо змінні середовища
cp .env.example .env
nano .env   # вставте API ключі та параметри

# 4. Запускаємо
npm start
# або в режимі розробки:
npm run dev
```

Дашборд відкриється на **http://localhost:3000**

---

## Структура проекту

```
trading-bot/
├── server.js              # Express + WebSocket сервер
├── bot/
│   └── engine.js          # Ядро бота (цикл, відкриття/закриття угод)
├── exchange/
│   └── connector.js       # CCXT: підключення, ордери, баланс
├── indicators/
│   └── index.js           # MACD, RSI, BB, Grid, DCA
├── utils/
│   └── logger.js          # Winston логування
├── public/
│   └── index.html         # Dashboard (trading-bot.html)
├── logs/                  # Автоматично створюється
├── .env.example           # Шаблон конфігурації
└── package.json
```

---

## REST API

| Метод | Маршрут | Опис |
|---|---|---|
| POST | `/api/connect` | Підключити API біржі |
| GET | `/api/balance` | Поточний баланс USDT |
| GET | `/api/ticker/:symbol` | Ціна активу (напр. `BTC-USDT`) |
| POST | `/api/bot/config` | Зберегти конфігурацію |
| POST | `/api/bot/start` | Запустити бота |
| POST | `/api/bot/stop` | Зупинити бота |
| GET | `/api/bot/stats` | Статистика сесії |
| GET | `/api/bot/trades` | Список угод |
| GET | `/api/candles/:symbol` | OHLCV свічки |

### Приклад — підключення

```bash
curl -X POST http://localhost:3000/api/connect \
  -H "Content-Type: application/json" \
  -d '{"exchange":"binance","apiKey":"xxx","apiSecret":"yyy"}'
```

### Приклад — запуск бота

```bash
curl -X POST http://localhost:3000/api/bot/start \
  -H "Content-Type: application/json" \
  -d '{
    "pair": "BTC/USDT",
    "strategy": "macd",
    "timeframe": "15m",
    "posSize": 100,
    "sl": 2.0,
    "tp": 4.0,
    "maxTrades": 3
  }'
```

---

## WebSocket (реальний час)

Підключіться до `ws://localhost:3000` — сервер надсилає:

```json
{ "type": "trade_opened", "data": { "pair":"BTC/USDT", "side":"BUY", "entryPrice":67420 } }
{ "type": "trade_closed",  "data": { "pnl": 3.21, "status": "TP_HIT" } }
{ "type": "stats",         "data": { "pnl": 12.5, "winRate": 68 } }
```

---

## Підключення дашборду до бекенду

Відкрийте `public/index.html` і замініть рядок конфігурації:

```js
const API_BASE = 'http://localhost:3000';  // адреса вашого сервера
const WS_URL   = 'ws://localhost:3000';
```

---

## ⚠️ Важливо

- Спочатку тестуйте на **Testnet** (Binance Testnet: `https://testnet.binance.vision`)
- Ніколи не зберігайте реальні API ключі у коді
- Для Binance Futures змініть `defaultType: 'future'` у connector.js
- Встановіть лімити позиції відповідно до вашого капіталу

---

## Безпека

```bash
# Захистіть .env
chmod 600 .env

# Для продакшену — використовуйте менеджер секретів
# (AWS Secrets Manager, HashiCorp Vault тощо)
```
