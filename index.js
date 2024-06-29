const TelegramBot = require('node-telegram-bot-api');
const ccxt = require('ccxt');
const fs = require('fs');

// Ganti dengan token API bot Telegram Anda
const token = '7462089524:AAGlAHc5UUIQM8TJWQZQlXW8YrYmgYVDNG8';

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

// Fungsi untuk menghitung target profit dan stoploss dengan rasio yang lebih kecil
function calculateTargets(price, signal, profitRatio = 2, lossRatio = 0.5) {
    let targetProfit, stopLoss;
    if (signal === 'buy') {
        targetProfit = roundToTwo(price * (1 + 0.01 * profitRatio));
        stopLoss = roundToTwo(price * (1 - 0.01 * lossRatio));
    } else if (signal === 'sell') {
        targetProfit = roundToTwo(price * (1 - 0.01 * profitRatio));
        stopLoss = roundToTwo(price * (1 + 0.01 * lossRatio));
    }
    return { targetProfit, stopLoss };
}

// Fungsi untuk menghitung risiko
function calculateRisk(price, stopLoss) {
    const riskPercentage = Math.abs((price - stopLoss) / price) * 100;
    if (riskPercentage > 1) {
        return { risk: 'high', percentage: riskPercentage };
    } else {
        return { risk: 'low', percentage: riskPercentage };
    }
}

// Fungsi untuk menghitung ukuran posisi
function calculatePositionSize(modal, stopLoss, currentPrice, riskPercentage = 1) {
    const riskAmount = modal * (riskPercentage / 100);
    const positionSize = riskAmount / Math.abs(currentPrice - stopLoss);
    return roundToTwo(positionSize);
}

// Fungsi untuk menyimpan riwayat sinyal
function saveSignalHistory(signalData) {
    const filePath = 'signal_history.json';
    let history = [];

    // Baca riwayat sinyal jika file sudah ada
    if (fs.existsSync(filePath)) {
        try {
            const rawHistory = fs.readFileSync(filePath);
            history = JSON.parse(rawHistory);
        } catch (error) {
            console.error('Error reading or parsing existing signal history:', error);
            // Jika terjadi kesalahan, mulai dengan riwayat kosong
            history = [];
        }
    }

    // Tambah data sinyal baru ke riwayat
    history.push(signalData);

    // Simpan kembali ke file
    try {
        fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
    } catch (error) {
        console.error('Error saving signal history:', error);
    }
}

// Fungsi untuk menghitung winrate
function calculateWinrate() {
    const filePath = 'signal_history.json';
    if (!fs.existsSync(filePath)) {
        return { total: 0, wins: 0, winrate: 0 };
    }

    try {
        const rawHistory = fs.readFileSync(filePath);
        const history = JSON.parse(rawHistory);

        const total = history.length;
        const wins = history.filter(signal => signal.result === 'win').length;
        const winrate = total === 0 ? 0 : (wins / total) * 100;

        return { total, wins, winrate };
    } catch (error) {
        console.error('Error reading or parsing signal history:', error);
        // Jika terjadi kesalahan, kembalikan nilai default
        return { total: 0, wins: 0, winrate: 0 };
    }
}

// Fungsi untuk mendapatkan sinyal berdasarkan modal
async function getSignalWithModal(symbol, modal) {
    const { signal, reason, level } = await getTradingSignal(symbol);
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = roundToTwo(ticker.last);
    const { targetProfit, stopLoss } = calculateTargets(currentPrice, signal);
    const positionSize = calculatePositionSize(modal, stopLoss, currentPrice);

    if (signal === 'hold') {
        return { signal, reason, level, currentPrice, targetProfit, stopLoss, positionSize, risk: 'hold', riskPercentage: 0 };
    }

    const { risk, percentage } = calculateRisk(currentPrice, stopLoss);

    return {
        signal,
        reason,
        currentPrice,
        targetProfit,
        stopLoss,
        positionSize,
        risk,
        riskPercentage: roundToTwo(percentage)
    };
}

// Fungsi untuk menyimpan modal trading
function saveTradingCapital(chatId, modal) {
    const filePath = 'trading_capital.json';
    let capitalData = {};

    // Baca data modal jika file sudah ada
    if (fs.existsSync(filePath)) {
        try {
            const rawCapital = fs.readFileSync(filePath);
            capitalData = JSON.parse(rawCapital);
        } catch (error) {
            console.error('Error reading or parsing trading capital file:', error);
        }
    }

    // Simpan modal untuk user tertentu
    capitalData[chatId] = modal;

    // Simpan kembali ke file
    try {
        fs.writeFileSync(filePath, JSON.stringify(capitalData, null, 2));
    } catch (error) {
        console.error('Error saving trading capital:', error);
    }
}

// Fungsi untuk mendapatkan modal trading user
function getTradingCapital(chatId) {
    const filePath = 'trading_capital.json';
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const rawCapital = fs.readFileSync(filePath);
        const capitalData = JSON.parse(rawCapital);
        return capitalData[chatId] || null;
    } catch (error) {
        console.error('Error reading trading capital file:', error);
        return null;
    }
}

// Respon ke command /signal
bot.onText(/\/signal (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const symbol = match[1].toUpperCase() + '/USD';

    // Dapatkan modal trading user
    const modal = getTradingCapital(chatId);
    if (!modal) {
        bot.sendMessage(chatId, 'Mohon set modal terlebih dahulu dengan perintah /modal.');
        return;
    }

    try {
        const { signal, reason, currentPrice, targetProfit, stopLoss, positionSize, risk, riskPercentage } = await getSignalWithModal(symbol, modal);

        if (signal === 'hold') {
            bot.sendMessage(chatId, `Sinyal untuk ${symbol}: Hold\nAlasan: ${reason}`);
        } else {
            const signalData = {
                symbol,
                signal,
                currentPrice,
                targetProfit,
                stopLoss,
                positionSize,
                reason,
                risk,
                riskPercentage,
                timestamp: new Date().toISOString(),
                result: 'pending'
            };

            saveSignalHistory(signalData);

            bot.sendMessage(chatId, 
                `Sinyal untuk ${symbol}: ${signal.toUpperCase()}\n\n` +
                `Harga Entry: ${currentPrice}\n\n` + 
                `Target Profit: ${targetProfit}\n\n` +
                `Stoploss: ${stopLoss}\n\n` +
                `Alasan: ${reason}\n\n` +
                `Risk: ${risk.toUpperCase()} (${riskPercentage}%)`
            );
        }
    } catch (error) {
        bot.sendMessage(chatId, `Terjadi kesalahan: ${error.message}`);
    }
});

// Respon ke command /modal
bot.onText(/\/modal (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const modal = parseFloat(match[1]);

    if (isNaN(modal) || modal <= 0) {
        bot.sendMessage(chatId, 'Mohon masukkan modal yang valid.');
    } else {
        saveTradingCapital(chatId, modal);
        bot.sendMessage(chatId, `Modal trading telah diset ke ${modal} USD.`);
    }
});

// Respon ke command /winrate
bot.onText(/\/winrate/, (msg) => {
    const chatId = msg.chat.id;
    const { total, wins, winrate } = calculateWinrate();
    bot.sendMessage(chatId, 
        `Total Sinyal: ${total}\n` +
        `Jumlah Kemenangan: ${wins}\n` +
        `Winrate: ${winrate.toFixed(2)}%`
    );
});
