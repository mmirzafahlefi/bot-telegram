const TelegramBot = require('node-telegram-bot-api');
const ccxt = require('ccxt');

// Ganti dengan token API bot Telegram Anda
const token = '7462089524:AAHTs939Z-dwM7hh6KPbbMY1k0vj77FhbYA';

// Inisialisasi bot Telegram
const bot = new TelegramBot(token, { polling: true });

// Inisialisasi exchange (misalnya Binance)
const exchange = new ccxt.binance();

// Fungsi untuk membulatkan harga ke dua desimal
function roundToTwo(num) {
    return Math.round(num * 100) / 100;
}

// Fungsi untuk mendapatkan sinyal trading dengan alasan
async function getTradingSignal(symbol) {
    const ohlcv = await exchange.fetchOHLCV(symbol, '15m', undefined, 100);
    const closes = ohlcv.map(candle => candle[4]);

    const shortMA = closes.slice(-10).reduce((acc, val) => acc + val, 0) / 10;
    const longMA = closes.slice(-50).reduce((acc, val) => acc + val, 0) / 50;

    let signal, reason, level;

    // Menentukan support dan resistance
    const support = Math.min(...closes.slice(-20)); // Contoh sederhana untuk support
    const resistance = Math.max(...closes.slice(-20)); // Contoh sederhana untuk resistance

    if (shortMA > longMA) {
        signal = 'buy';
        level = support;
        reason = `Short-term moving average is above long-term moving average, indicating an upward trend. Consider buying near the support level of ${roundToTwo(support)}`;
    } else if (shortMA < longMA) {
        signal = 'sell';
        level = resistance;
        reason = `Short-term moving average is below long-term moving average, indicating a downward trend. Consider selling near the resistance level of ${roundToTwo(resistance)}`;
    } else {
        signal = 'hold';
        reason = 'Short-term moving average is equal to long-term moving average, indicating no clear trend.';
    }

    return { signal, reason, level };
}

// Fungsi untuk menghitung target profit dan stoploss
function calculateTargets(price, signal, ratio = 2) {
    let targetProfit, stopLoss;
    if (signal === 'buy') {
        targetProfit = roundToTwo(price * (1 + 0.01 * ratio));
        stopLoss = roundToTwo(price * (1 - 0.01));
    } else if (signal === 'sell') {
        targetProfit = roundToTwo(price * (1 - 0.01 * ratio));
        stopLoss = roundToTwo(price * (1 + 0.01));
    }
    return { targetProfit, stopLoss };
}

// Respon ke command /signal
bot.onText(/\/signal (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const symbol = match[1].toUpperCase() + '/USD';

    try {
        const { signal, reason, level } = await getTradingSignal(symbol);
        const ticker = await exchange.fetchTicker(symbol);
        const currentPrice = roundToTwo(ticker.last);
        const { targetProfit, stopLoss } = calculateTargets(currentPrice, signal);

        if (signal === 'hold') {
            bot.sendMessage(chatId, `Sinyal untuk ${symbol}: Hold\nAlasan: ${reason}`);
        } else {
            bot.sendMessage(chatId, 
                `Sinyal untuk ${symbol}: ${signal.toUpperCase()}\n\n` +
                `Perkiraan Harga untuk ${signal.toUpperCase()}: ${currentPrice}\n\n s/d ${roundToTwo(level)}\n\n` +
                `Target Profit: ${targetProfit}\n\n` +
                `Stoploss: ${stopLoss}\n\n` +
                `Alasan: ${reason}`
            );
        }
    } catch (error) {
        bot.sendMessage(chatId, `Terjadi kesalahan: ${error.message}`);
    }
});

