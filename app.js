// State Management
const APP_VERSION = '2.0.0-stability';
const core = window.DividendCore;
if (!core) throw new Error('data-core.js must be loaded before app.js');

let state = {
    schemaVersion: core.SCHEMA_VERSION,
    accounts: [],
    portfolio: [],
    dividendLogs: [],
    shareHistory: [], // [{ id, portfolioId, date, shares }]
    exchangeRateCache: {}, // Date YYYY-MM-DD -> { rate, requestedDate, rateDate, source }
    stockPrices: {},        // { "TICKER|CURRENCY": { price, quoteTimestamp, fetchedAt, ... } }
    lastPriceUpdate: null,  // Backward-compatible alias of last successful price fetch
    priceUpdateStatus: { lastAttemptAt: null, lastSuccessAt: null, successCount: 0, failCount: 0 },
    activeCurrency: 'KRW', // Display currency: KRW or USD
    currentExchangeRate: null, // Last successfully validated KRW/USD rate
    currentExchangeRateMeta: { status: 'idle', rate: null, provider: null, asOf: null, fetchedAt: null, nextUpdateAt: null, error: null },
    lastBackupMonth: '', // YYYY-MM to track auto backups
    syncMeta: { localRevision: 0, updatedAt: null }
};

let currentExchangeRatePromise = null;
let priceUpdatePromise = null;
let historicalRateRequestSequence = 0;
let storageWriteBlocked = false;

// Chart Instances
let monthlyChart = null;
let allocationChart = null;
let cumulativeChart = null;

// Edit State Variables
let editingAccountId = null;
let editingPortfolioId = null;
let editingDividendId = null;



// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupEventListeners();
    renderAll();
    checkMonthlyBackup();
    setupAIChat(); // Initialize AI Chatbot
    setupVersionUI();
    void refreshMarketData({ automatic: true });
});

// Load State from LocalStorage
function loadState() {
    const savedState = localStorage.getItem('dividend_tracker_state');
    if (savedState) {
        try {
            const parsedState = JSON.parse(savedState);
            const migratedState = core.migrateState(parsedState, state);
            if ((Number(parsedState.schemaVersion) || 0) < core.SCHEMA_VERSION && !localStorage.getItem('dividend_tracker_state_pre_v2')) {
                localStorage.setItem('dividend_tracker_state_pre_v2', savedState);
            }
            state = migratedState;
            persistLocalState();
        } catch (e) {
            console.error("Error parsing saved state:", e);
            storageWriteBlocked = true;
            try {
                if (!localStorage.getItem('dividend_tracker_state_load_error')) {
                    localStorage.setItem('dividend_tracker_state_load_error', savedState);
                }
            } catch (_) {}
            showToast("���� �곗씠�곕� �쎌� 紐삵빐 �먮룞 ���κ낵 Drive �숆린�붾� 李⑤떒�덉뒿�덈떎. JSON 諛깆뾽 蹂듭썝 �먮뒗 珥덇린�붽� �꾩슂�⑸땲��.", "danger");
        }
    } else {
        // Load mock data if empty to give user a nice first impression
        loadMockData();
    }
}

// Save State to LocalStorage
function persistLocalState() {
    if (storageWriteBlocked) return false;
    try {
        localStorage.setItem('dividend_tracker_state', JSON.stringify(state));
        return true;
    } catch (error) {
        storageWriteBlocked = true;
        console.error('Local state write failed:', error);
        return false;
    }
}

function saveState({ sync = true } = {}) {
    if (sync) {
        state.syncMeta = state.syncMeta || { localRevision: 0, updatedAt: null };
        state.syncMeta.localRevision = (Number(state.syncMeta.localRevision) || 0) + 1;
        state.syncMeta.updatedAt = new Date().toISOString();
    }
    if (!persistLocalState()) return false;
    // Trigger GDrive auto-save if authenticated
    if (sync && typeof queueGDrivePush === 'function') {
        queueGDrivePush();
    }
    return true;
}

// Automatic Monthly Backup Checker
function checkMonthlyBackup() {
    // Avoid backing up empty data on very first launch
    if (state.accounts.length === 0 && state.portfolio.length === 0) return;
    
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    if (state.lastBackupMonth !== currentMonthStr) {
        // Trigger auto backup file download
        exportDataJSON();
        showToast("�덈줈�� �ъ씠 �쒖옉�섏뼱 �대쾲 �� �곗씠�� 諛깆뾽 �뚯씪�� �먮룞�쇰줈 �ㅼ슫濡쒕뱶�덉뒿�덈떎.", "success");
        
        state.lastBackupMonth = currentMonthStr;
        saveState();
    }
}

// Mock Data for First Impression
function loadMockData() {
    state.accounts = [
        { id: 'acc-1', name: '�쇰컲 二쇱떇怨꾩쥖', type: 'General', accountNumber: '110-123-45678' },
        { id: 'acc-2', name: 'ISA �덉꽭怨꾩쥖', type: 'ISA', accountNumber: '230-987-65432' },
        { id: 'acc-3', name: '�곌툑��異뺢퀎醫�', type: 'Pension', accountNumber: '340-111-22222' }
    ];

    state.portfolio = [
        { id: 'port-1', accountId: 'acc-1', name: '由ъ뼹�곗씤而�', ticker: 'O', shares: 150, avgPrice: 55.4, currency: 'USD', annualDividend: 3.12, frequency: 'Monthly', exMonths: [1,2,3,4,5,6,7,8,9,10,11,12] },
        { id: 'port-2', accountId: 'acc-2', name: 'SCHD', ticker: 'SCHD', shares: 100, avgPrice: 78.2, currency: 'USD', annualDividend: 2.88, frequency: 'Quarterly', exMonths: [3,6,9,12] },
        { id: 'port-3', accountId: 'acc-2', name: '�쇱꽦�꾩옄��', ticker: '005935', shares: 200, avgPrice: 62000, currency: 'KRW', annualDividend: 1444, frequency: 'Quarterly', exMonths: [4,5,8,11] }, // Samsung Ele Pref payout months roughly
        { id: 'port-4', accountId: 'acc-3', name: '留μ옘由ъ씤�꾨씪', ticker: '088980', shares: 500, avgPrice: 12100, currency: 'KRW', annualDividend: 760, frequency: 'Semi-Annual', exMonths: [2, 8] }
    ];

    // Log history (past 6 months)
    state.dividendLogs = [
        // Jan 2026
        { id: 'log-1', date: '2026-01-15', portfolioId: 'port-1', amount: 39.00, currency: 'USD', exchangeRate: 1320, amountKRW: 51480, tax: 5.85 },
        // Feb 2026
        { id: 'log-2', date: '2026-02-15', portfolioId: 'port-1', amount: 39.00, currency: 'USD', exchangeRate: 1330, amountKRW: 51870, tax: 5.85 },
        { id: 'log-3', date: '2026-02-27', portfolioId: 'port-4', amount: 380000, currency: 'KRW', exchangeRate: 1, amountKRW: 380000, tax: 58520 },
        // Mar 2026
        { id: 'log-4', date: '2026-03-15', portfolioId: 'port-1', amount: 39.00, currency: 'USD', exchangeRate: 1340, amountKRW: 52260, tax: 5.85 },
        { id: 'log-5', date: '2026-03-25', portfolioId: 'port-2', amount: 72.00, currency: 'USD', exchangeRate: 1342, amountKRW: 96624, tax: 10.80 },
        // Apr 2026
        { id: 'log-6', date: '2026-04-15', portfolioId: 'port-1', amount: 39.00, currency: 'USD', exchangeRate: 1335, amountKRW: 52065, tax: 5.85 },
        { id: 'log-7', date: '2026-04-20', portfolioId: 'port-3', amount: 72200, currency: 'KRW', exchangeRate: 1, amountKRW: 72200, tax: 11110 },
        // May 2026
        { id: 'log-8', date: '2026-05-15', portfolioId: 'port-1', amount: 39.00, currency: 'USD', exchangeRate: 1350, amountKRW: 52650, tax: 5.85 },
        { id: 'log-9', date: '2026-05-20', portfolioId: 'port-3', amount: 72200, currency: 'KRW', exchangeRate: 1, amountKRW: 72200, tax: 11110 },
        // Jun 2026
        { id: 'log-10', date: '2026-06-15', portfolioId: 'port-1', amount: 39.00, currency: 'USD', exchangeRate: 1355, amountKRW: 52845, tax: 5.85 },
        { id: 'log-11', date: '2026-06-25', portfolioId: 'port-2', amount: 72.00, currency: 'USD', exchangeRate: 1358, amountKRW: 97776, tax: 10.80 }
    ];

    state.shareHistory = [
        { id: 'sh-1', portfolioId: 'port-1', date: '2026-01-01', shares: 100 },
        { id: 'sh-2', portfolioId: 'port-1', date: '2026-03-01', shares: 120 },
        { id: 'sh-3', portfolioId: 'port-1', date: '2026-05-01', shares: 150 },
        { id: 'sh-4', portfolioId: 'port-2', date: '2026-01-01', shares: 80 },
        { id: 'sh-5', portfolioId: 'port-2', date: '2026-04-01', shares: 100 },
        { id: 'sh-6', portfolioId: 'port-3', date: '2026-01-01', shares: 200 },
        { id: 'sh-7', portfolioId: 'port-4', date: '2026-01-01', shares: 500 }
    ];

    saveState();
}

function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = options.signal;
    if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const data = await response.json();
        return { response, data };
    } finally {
        clearTimeout(timeoutId);
    }
}

function unixToIso(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? new Date(number * 1000).toISOString() : null;
}

// Fetch Current Exchange Rate. Failure preserves the last validated value.
async function updateCurrentExchangeRate() {
    if (currentExchangeRatePromise) return currentExchangeRatePromise;
    currentExchangeRatePromise = (async () => {
        try {
            const previousMeta = state.currentExchangeRateMeta || {};
            if (previousMeta.status === 'success' && previousMeta.nextUpdateAt && Date.now() < new Date(previousMeta.nextUpdateAt).getTime()) {
                return { ok: true, cached: true, ...previousMeta };
            }
            const { response, data } = await fetchJsonWithTimeout('https://open.er-api.com/v6/latest/USD', {}, 8000);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const rate = Number(data?.rates?.KRW);
            if (data?.result !== 'success' || !core.isPositiveNumber(rate)) throw new Error('KRW �섏쑉 媛� �꾨씫');
            const fetchedAt = new Date().toISOString();
            state.currentExchangeRate = rate;
            state.currentExchangeRateMeta = {
                status: 'success', rate, provider: 'Open ExchangeRate-API',
                asOf: unixToIso(data.time_last_update_unix),
                fetchedAt,
                nextUpdateAt: unixToIso(data.time_next_update_unix),
                error: null
            };
            saveState({ sync: false });
            return { ok: true, ...state.currentExchangeRateMeta };
        } catch (error) {
            state.currentExchangeRateMeta = {
                ...(state.currentExchangeRateMeta || {}),
                status: 'error', rate: state.currentExchangeRate || null,
                error: error?.name === 'AbortError' ? '�붿껌 �쒓컙 珥덇낵' : (error?.message || '議고쉶 �ㅽ뙣'),
                lastAttemptAt: new Date().toISOString()
            };
            saveState({ sync: false });
            return { ok: false, rate: state.currentExchangeRate || null, error: state.currentExchangeRateMeta.error };
        } finally {
            currentExchangeRatePromise = null;
            updatePriceTimestamp();
        }
    })();
    return currentExchangeRatePromise;
}

// Fetch Historical Exchange Rate. Failure never pretends the current rate is historical.
async function getHistoricalExchangeRate(dateStr) {
    if (!dateStr) return { ok: false, error: '�좎쭨 �놁쓬', requestedDate: dateStr };
    const cached = core.normalizeHistoricalRateEntry(state.exchangeRateCache[dateStr], dateStr);
    if (cached?.basisKnown) return { ok: true, cached: true, ...cached };
    try {
        const { response, data } = await fetchJsonWithTimeout(`https://api.frankfurter.dev/v1/${dateStr}?base=USD&symbols=KRW`, {}, 8000);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rate = Number(data?.rates?.KRW);
        if (!core.isPositiveNumber(rate) || !/^\d{4}-\d{2}-\d{2}$/.test(data?.date || '')) throw new Error('�섏쑉 �먮뒗 湲곗��� �꾨씫');
        const entry = {
            status: 'success', rate, requestedDate: dateStr, rateDate: data.date,
            source: 'Frankfurter v1', basisKnown: true, fetchedAt: new Date().toISOString()
        };
        state.exchangeRateCache[dateStr] = entry;
        saveState({ sync: false });
        return { ok: true, cached: false, ...entry };
    } catch (error) {
        return {
            ok: false, requestedDate: dateStr,
            fallbackRate: core.isPositiveNumber(state.currentExchangeRate) ? state.currentExchangeRate : null,
            error: error?.name === 'AbortError' ? '�붿껌 �쒓컙 珥덇낵' : (error?.message || '議고쉶 �ㅽ뙣')
        };
    }
}

function getConfiguredWorkerUrl() {
    const value = (localStorage.getItem('price_worker_url') || '').trim().replace(/\/$/, '');
    if (!value) return '';
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return '';
        return parsed.origin + parsed.pathname.replace(/\/$/, '');
    } catch (_) {
        return '';
    }
}

function parseYahooQuote(data, requestedCurrency, symbol, route) {
    const meta = data?.chart?.result?.[0]?.meta;
    const validated = core.validatePriceQuote(meta, symbol, requestedCurrency);
    if (!validated) return null;
    const price = validated.price;
    const quoteTimestamp = Number.isFinite(Number(meta?.regularMarketTime))
        ? new Date(Number(meta.regularMarketTime) * 1000).toISOString()
        : null;
    return {
        price,
        currency: requestedCurrency,
        upstreamCurrency: meta?.currency || null,
        symbol,
        provider: 'Yahoo Finance chart',
        route,
        quoteTimestamp,
        fetchedAt: new Date().toISOString()
    };
}

async function fetchViaConfiguredWorker(symbol, currency) {
    const base = getConfiguredWorkerUrl();
    if (!base) return null;
    const { response, data } = await fetchJsonWithTimeout(`${base}/price?symbol=${encodeURIComponent(symbol)}`, {}, 7000);
    if (!response.ok) throw new Error(`Worker HTTP ${response.status}`);
    const price = Number(data?.price);
    if (!core.validatePriceQuote({ price, symbol: data?.symbol, currency: data?.currency }, symbol, currency)) {
        throw new Error('Worker �묐떟 寃�利� �ㅽ뙣');
    }
    return {
        price, currency, upstreamCurrency: data.currency || null, symbol,
        provider: data.provider || '媛쒖씤 �쒖꽭 Worker', route: 'configured-worker',
        quoteTimestamp: data.quoteTimestamp || null, fetchedAt: new Date().toISOString()
    };
}

async function fetchViaPublicProxies(targetUrl, symbol, currency) {
    let routes = [
        {
            name: 'corsproxy.io',
            url: `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`,
            unwrap: data => data
        },
        {
            name: 'AllOrigins',
            url: `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
            unwrap: data => data?.contents ? (typeof data.contents === 'string' ? JSON.parse(data.contents) : data.contents) : null
        },
        {
            name: 'api.cors.lol',
            url: `https://api.cors.lol/?url=${encodeURIComponent(targetUrl)}`,
            unwrap: data => data
        }
    ];

    const preferredRoute = localStorage.getItem('price_proxy_route');
    if (preferredRoute) routes = routes.sort((a, b) => (a.name === preferredRoute ? -1 : b.name === preferredRoute ? 1 : 0));
    const attemptRoute = async (route, timeoutMs) => {
        const { response, data: raw } = await fetchJsonWithTimeout(route.url, {}, timeoutMs);
        if (!response.ok) throw new Error(`${route.name} HTTP ${response.status}`);
        const data = route.unwrap(raw);
        const quote = parseYahooQuote(data, currency, symbol, route.name);
        if (!quote) throw new Error(`${route.name} 媛�寃� �꾨씫`);
        return quote;
    };
    if (preferredRoute && routes[0]?.name === preferredRoute) {
        try {
            return await attemptRoute(routes[0], 4500);
        } catch (_) {
            routes = routes.slice(1);
        }
    }
    const settled = await Promise.allSettled(routes.map(route => attemptRoute(route, 7000)));
    const success = settled.find(result => result.status === 'fulfilled');
    if (success) {
        localStorage.setItem('price_proxy_route', success.value.route);
        return success.value;
    }
    throw new Error(settled.map(result => result.reason?.message).filter(Boolean).join(' / ') || '怨듦컻 寃쎈줈 �ㅽ뙣');
}

// Fetch a single stock's current price.
async function fetchStockPrice(ticker, currency) {
    // 1. Try local server first if running locally
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.protocol === 'file:') {
        try {
            const url = `http://127.0.0.1:5000/api/price?ticker=${encodeURIComponent(ticker)}&currency=${encodeURIComponent(currency)}`;
            const { response, data } = await fetchJsonWithTimeout(url, {}, 4000);
            if (response.ok) {
                if (data.price && data.price > 0) {
                    return {
                        price: Number(data.price), currency: data.currency || currency,
                        upstreamCurrency: data.currency || null, symbol: ticker,
                        provider: data.source || '濡쒖뺄 �쒖꽭 �쒕쾭', route: 'local-server',
                        quoteTimestamp: data.quoteTimestamp || null, fetchedAt: new Date().toISOString()
                    };
                }
            }
        } catch (e) {
            console.log(`Local server price fetch failed for ${ticker}, trying public CORS proxies...`);
        }
    }
    
    // 2. Direct browser-only fetch using public CORS proxies
    // For Korean stocks (6-digit numeric ticker), convert to Yahoo Finance symbols (.KS or .KQ)
    let candidateTickers = [ticker];
    if (currency === 'KRW' && !ticker.includes('.')) {
        candidateTickers = [`${ticker}.KS`, `${ticker}.KQ`];
    }
    
    // Try candidates (.KS first, then .KQ if .KS fails)
    const errors = [];
    for (const t of candidateTickers) {
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=5d`;
        try {
            const workerQuote = await fetchViaConfiguredWorker(t, currency);
            if (workerQuote) return workerQuote;
        } catch (error) {
            errors.push(error.message);
        }
        try {
            return await fetchViaPublicProxies(targetUrl, t, currency);
        } catch (error) {
            errors.push(error.message);
        }
    }
    throw new Error(errors.join(' / ') || '媛�寃� 議고쉶 �ㅽ뙣');
}

async function refreshMarketData({ automatic = false } = {}) {
    if (priceUpdatePromise) return priceUpdatePromise;
    priceUpdatePromise = Promise.allSettled([updateCurrentExchangeRate(), fetchAllStockPrices({ automatic })]);
    try {
        return await priceUpdatePromise;
    } finally {
        priceUpdatePromise = null;
        renderAll();
    }
}

// Fetch prices in small batches while retaining each last successful quote.
async function fetchAllStockPrices({ automatic = false } = {}) {
    if (state.portfolio.length === 0) return { successCount: 0, failCount: 0 };
    const updateBtn = document.getElementById('btnUpdatePrices');
    if (updateBtn) {
        updateBtn.disabled = true;
        updateBtn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;animation:spin 1s linear infinite;"></i> 議고쉶 以�...';
    }

    const tickerMap = new Map();
    state.portfolio.forEach(stock => {
        const key = core.makeStockKey(stock.ticker, stock.currency);
        if (!tickerMap.has(key)) tickerMap.set(key, { ticker: stock.ticker, currency: stock.currency });
    });
    let successCount = 0;
    let failCount = 0;
    const startedAt = new Date().toISOString();
    const entries = Array.from(tickerMap.entries());
    let completed = 0;
    try {
        for (let offset = 0; offset < entries.length; offset += 2) {
            const batch = entries.slice(offset, offset + 2);
            const results = await Promise.allSettled(batch.map(([, item]) => fetchStockPrice(item.ticker, item.currency)));
            results.forEach((result, index) => {
                const [key, item] = batch[index];
                completed++;
                if (result.status === 'fulfilled' && result.value) {
                    state.stockPrices[key] = { ...result.value, lastAttemptAt: startedAt, lastError: null };
                    successCount++;
                } else {
                    state.stockPrices[key] = {
                        ...(state.stockPrices[key] || {}),
                        currency: item.currency,
                        lastAttemptAt: startedAt,
                        lastError: result.reason?.message || '議고쉶 �ㅽ뙣'
                    };
                    failCount++;
                }
            });
            if (updateBtn) updateBtn.textContent = `議고쉶 以� (${completed}/${entries.length})...`;
            saveState({ sync: false });
        }
        const finishedAt = new Date().toISOString();
        state.priceUpdateStatus = {
            lastAttemptAt: finishedAt,
            lastSuccessAt: successCount > 0 ? finishedAt : (state.priceUpdateStatus?.lastSuccessAt || state.lastPriceUpdate || null),
            successCount,
            failCount
        };
        if (successCount > 0) state.lastPriceUpdate = finishedAt;
        saveState({ sync: false });
        if (!automatic) {
            if (failCount > 0 && successCount > 0) showToast(`${successCount}媛� �깃났, ${failCount}媛� �ㅽ뙣. 留덉�留� �뺤긽 媛�寃⑹� 蹂댁〈�덉뒿�덈떎.`, 'warning');
            else if (failCount > 0) showToast('紐⑤뱺 �꾩옱媛� 議고쉶�� �ㅽ뙣�덉뒿�덈떎. 留덉�留� �뺤긽 媛�寃⑹� 蹂댁〈�덉뒿�덈떎.', 'danger');
            else showToast(`${successCount}媛� 醫낅ぉ �꾩옱媛�媛� �낅뜲�댄듃�섏뿀�듬땲��.`, 'success');
        }
        return { successCount, failCount };
    } finally {
        if (updateBtn) {
            updateBtn.disabled = false;
            updateBtn.innerHTML = '<i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> �꾩옱媛� �낅뜲�댄듃';
            if (window.lucide) lucide.createIcons();
        }
        updatePriceTimestamp();
    }
}

function getStockPriceData(stock) {
    const key = core.makeStockKey(stock.ticker, stock.currency);
    const direct = state.stockPrices[key];
    if (direct) return direct;
    const legacy = state.stockPrices[stock.ticker];
    return legacy && (!legacy.currency || legacy.currency === stock.currency) ? legacy : null;
}

// Cost basis is used only as an explicit fallback for calculations that require a number.
function getStockCurrentPrice(stock) {
    const priceData = getStockPriceData(stock);
    if (priceData && priceData.price > 0) {
        return priceData.price;
    }
    return stock.avgPrice; // fallback to cost basis
}

// Check if we have a live price for a stock
function hasLivePrice(stock) {
    const priceData = getStockPriceData(stock);
    const freshness = core.getPriceFreshness(priceData);
    return freshness.available && !freshness.stale;
}

function hasAnyPrice(stock) {
    return core.getPriceFreshness(getStockPriceData(stock)).available;
}

function formatPriceQuoteMeta(stock) {
    const entry = getStockPriceData(stock);
    if (!entry || !core.isPositiveNumber(entry.price)) return entry?.lastError ? '<small class="quote-status failed">議고쉶 �ㅽ뙣</small>' : '';
    const freshness = core.getPriceFreshness(entry);
    const timestamp = entry.quoteTimestamp || entry.fetchedAt || entry.lastUpdated;
    const timeText = timestamp ? new Date(timestamp).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '�쒓컖 誘몄젣怨�';
    const label = freshness.stale ? '�ㅻ옒�� 留덉�留� 媛�寃�' : '留덉�留� �뺤긽 媛�寃�';
    const recentFailure = entry.lastError ? ' 쨌 理쒓렐 議고쉶 �ㅽ뙣' : '';
    return `<small class="quote-status ${freshness.stale ? 'stale' : 'fresh'}">${label} 쨌 �쒖꽭 ${timeText}${recentFailure}</small>`;
}

// Update the price timestamp display
function updatePriceTimestamp() {
    const el = document.getElementById('lastPriceUpdateTime');
    if (!el) return;
    
    const priceStatus = state.priceUpdateStatus || {};
    if (priceStatus.lastAttemptAt || priceStatus.lastSuccessAt) {
        const d = new Date(priceStatus.lastAttemptAt || priceStatus.lastSuccessAt);
        const timeStr = d.toLocaleString('ko-KR', { 
            month: 'short', day: 'numeric', 
            hour: '2-digit', minute: '2-digit' 
        });
        
        const counts = Number.isFinite(priceStatus.successCount) ? ` 쨌 �쒖꽭 ${priceStatus.successCount}�깃났/${priceStatus.failCount || 0}�ㅽ뙣` : '';
        const fxMeta = state.currentExchangeRateMeta || {};
        const rateStr = state.currentExchangeRate
            ? ` 쨌 �섏쑉 ��${state.currentExchangeRate.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}${fxMeta.asOf ? ` (湲곗� ${new Date(fxMeta.asOf).toLocaleDateString('ko-KR')})` : ''}`
            : ' 쨌 �섏쑉 誘몄“��';
        const fxError = fxMeta.status === 'error' ? ' 쨌 �섏쑉 理쒓렐 議고쉶 �ㅽ뙣(留덉�留� �뺤긽媛� �좎�)' : '';
        el.textContent = `留덉�留� �쒕룄: ${timeStr}${counts}${rateStr}${fxError}`;
    } else {
        el.textContent = '';
    }
}

// CSS for spinner animation (injected once)
if (!document.getElementById('spinnerStyle')) {
    const style = document.createElement('style');
    style.id = 'spinnerStyle';
    style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
}

// Event Listeners Setup
function setupEventListeners() {
    // Navigation Tabs
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = item.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    // Theme Toggle
    const themeBtn = document.getElementById('themeToggleBtn');
    themeBtn.addEventListener('click', toggleTheme);

    // Currency Switcher
    const currencyOptions = document.querySelectorAll('.currency-option');
    currencyOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            currencyOptions.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            state.activeCurrency = opt.getAttribute('data-currency');
            saveState();
            renderAll();
        });
    });

    // Modals Close Buttons
    document.querySelectorAll('.modal-close, .btn-modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal-backdrop').forEach(modal => modal.classList.remove('open'));
        });
    });

    // Modals Open Buttons
    document.getElementById('btnAddAccount').addEventListener('click', () => {
        editingAccountId = null;
        document.querySelector('#modalAccount .modal-title').textContent = '�� 怨꾩쥖 �깅줉';
        document.querySelector('#formAccount button[type="submit"]').textContent = '�깅줉�섍린';
        document.getElementById('formAccount').reset();
        openModal('modalAccount');
    });
    document.getElementById('btnAddPortfolio').addEventListener('click', () => {
        editingPortfolioId = null;
        document.querySelector('#modalPortfolio .modal-title').textContent = '蹂댁쑀 二쇱떇 �깅줉';
        document.querySelector('#formPortfolio button[type="submit"]').textContent = '�깅줉�섍린';
        document.getElementById('formPortfolio').reset();
        document.querySelectorAll('.months-selection-grid input[type="checkbox"]').forEach(cb => cb.checked = false);
        populateAccountSelect('portfolioAccount');
        openModal('modalPortfolio');
    });
    document.getElementById('btnAddDividend').addEventListener('click', () => {
        editingDividendId = null;
        document.querySelector('#modalDividend .modal-title').textContent = '諛곕떦 �섎졊 湲곕줉';
        document.querySelector('#formDividend button[type="submit"]').textContent = '�깅줉�섍린';
        document.getElementById('formDividend').reset();
        const rateInput = document.getElementById('dividendExchangeRate');
        rateInput.dataset.manualVersion = '0';
        rateInput.dataset.rateSource = '';
        rateInput.dataset.rateDate = '';
        rateInput.dataset.requestedDate = '';
        document.getElementById('exchangeRateFormGroup').style.display = 'none';
        
        populateAccountSelect('dividendAccountSelect');
        populatePortfolioSelect('dividendStock');
        document.getElementById('dividendStock').disabled = true;
        
        openModal('modalDividend');
        // Set default date to today
        document.getElementById('dividendDate').value = core.localDateString();
    });

    // -------------------------------------------------------
    // Dividend Modal �� Exchange Rate Auto-Fetch Logic
    // -------------------------------------------------------
    const dateInput    = document.getElementById('dividendDate');
    const stockSelect  = document.getElementById('dividendStock');
    const currencyField = document.getElementById('dividendCurrency');
    const rateInput    = document.getElementById('dividendExchangeRate');
    const rateStatus   = document.getElementById('exchangeRateStatus');

    rateInput.addEventListener('input', () => {
        if (rateInput.dataset.programmatic === 'true') return;
        rateInput.dataset.manualVersion = String((Number(rateInput.dataset.manualVersion) || 0) + 1);
        rateInput.dataset.rateSource = 'manual';
        rateInput.dataset.rateDate = dateInput.value;
        if (rateStatus) {
            rateStatus.style.color = 'var(--text-secondary)';
            rateStatus.textContent = '�섎룞 �낅젰媛믪쓣 �ъ슜�⑸땲��.';
        }
    });

    const setRateProgrammatically = (value, metadata = {}) => {
        rateInput.dataset.programmatic = 'true';
        rateInput.value = value;
        rateInput.dataset.rateSource = metadata.source || '';
        rateInput.dataset.rateDate = metadata.rateDate || '';
        rateInput.dataset.requestedDate = metadata.requestedDate || '';
        queueMicrotask(() => { rateInput.dataset.programmatic = 'false'; });
    };

    // Shared helper: fetch rate for a given date and populate the input
    async function fetchAndSetRate(dateStr, { showStatus = true } = {}) {
        if (!dateStr || currencyField.value !== 'USD') return;

        const requestId = ++historicalRateRequestSequence;
        const manualVersion = Number(rateInput.dataset.manualVersion) || 0;

        if (showStatus) {
            rateStatus.style.color = 'var(--text-secondary)';
            rateStatus.textContent = '�� �섏쑉 議고쉶 以�...';
        }

        try {
            const result = await getHistoricalExchangeRate(dateStr);
            const shouldApply = core.shouldApplyHistoricalRateResponse({
                requestId,
                latestRequestId: historicalRateRequestSequence,
                requestedDate: dateStr,
                currentDate: dateInput.value,
                currentCurrency: currencyField.value,
                manualVersionBefore: manualVersion,
                manualVersionNow: Number(rateInput.dataset.manualVersion) || 0
            });
            if (!shouldApply) return;
            if (result.ok) {
                setRateProgrammatically(result.rate.toFixed(2), result);
                if (showStatus) {
                    rateStatus.style.color = '#10b981';
                    const basisText = result.rateDate === result.requestedDate
                        ? `${result.rateDate} 湲곗�`
                        : `${result.requestedDate} �붿껌 쨌 �ㅼ젣 湲곗� ${result.rateDate}`;
                    rateStatus.textContent = `�� ${basisText}: ${result.rate.toFixed(2)}�� (${result.source})`;
                }
            } else {
                if (showStatus) {
                    rateStatus.style.color = 'var(--danger)';
                    const currentHint = result.fallbackRate ? ` 留덉�留� �됯� �섏쑉 ${result.fallbackRate.toFixed(2)}�먯� �먮룞 �곸슜�섏� �딆뒿�덈떎.` : '';
                    rateStatus.textContent = `�� ${dateStr} 怨쇨굅 �섏쑉 議고쉶 �ㅽ뙣.${currentHint} �섎룞 �낅젰�� �꾩슂�⑸땲��.`;
                    showToast('怨쇨굅 �섏쑉�� �뺤젙�섏� 紐삵뻽�듬땲��. 湲곗〈 �섎룞媛믪쓣 蹂댁〈�덉뒿�덈떎.', 'warning');
                }
            }
        } catch (err) {
            if (showStatus) {
                rateStatus.style.color = 'var(--danger)';
                rateStatus.textContent = '�� �ㅽ듃�뚰겕 �ㅻ쪟 �� �섎룞�쇰줈 �섏쑉�� �낅젰�� 二쇱꽭��.';
                showToast('�섏쑉 API �곌껐�� �ㅽ뙣�덉뒿�덈떎. 吏곸젒 �낅젰�� 二쇱꽭��.', 'danger');
            }
        }
    }

    // Trigger rate lookup when date changes
    dateInput.addEventListener('change', () => fetchAndSetRate(dateInput.value));

    // Helper to toggle exchange rate group based on currency
    async function handleCurrencyChange(currency) {
        if (currency === 'USD') {
            document.getElementById('exchangeRateFormGroup').style.display = 'flex';
            if (rateStatus) rateStatus.textContent = '';
            await fetchAndSetRate(dateInput.value);
        } else {
            document.getElementById('exchangeRateFormGroup').style.display = 'none';
            setRateProgrammatically('1', { source: 'not-applicable', rateDate: dateInput.value, requestedDate: dateInput.value });
            if (rateStatus) rateStatus.textContent = '';
        }
    }

    // Trigger rate lookup when currency select changes (for "湲고�" stock manual selection)
    currencyField.addEventListener('change', () => {
        handleCurrencyChange(currencyField.value);
    });

    // Trigger rate lookup when stock selection changes (checking its currency)
    stockSelect.addEventListener('change', async () => {
        const selectedOption = stockSelect.options[stockSelect.selectedIndex];
        if (!selectedOption) return;
        const stockId = selectedOption.value;
        
        if (stockId.startsWith('etc-')) {
            currencyField.disabled = false;
            await handleCurrencyChange(currencyField.value);
        } else {
            const stock = state.portfolio.find(p => p.id === stockId);
            if (stock) {
                currencyField.value = stock.currency;
                currencyField.disabled = true;
                await handleCurrencyChange(stock.currency);
            }
        }
    });

    // Manual refresh button
    document.getElementById('btnRefreshExchangeRate').addEventListener('click', async () => {
        if (!dateInput.value) {
            showToast('�좎쭨瑜� 癒쇱� �좏깮�� 二쇱꽭��.', 'warning');
            return;
        }
        // Force re-fetch by clearing cache for this date
        delete state.exchangeRateCache[dateInput.value];
        await fetchAndSetRate(dateInput.value);
    });

    // Dividend Modal - Account Selection filtering Stock Selection
    document.getElementById('dividendAccountSelect').addEventListener('change', (e) => {
        const selectedAccountId = e.target.value;
        const stockSelectEl = document.getElementById('dividendStock');
        
        if (selectedAccountId) {
            populatePortfolioSelect('dividendStock', selectedAccountId);
            stockSelectEl.disabled = false;
        } else {
            populatePortfolioSelect('dividendStock');
            stockSelectEl.disabled = true;
        }
        
        // Reset stock related fields
        currencyField.value = 'KRW';
        document.getElementById('exchangeRateFormGroup').style.display = 'none';
        setRateProgrammatically('1', { source: 'not-applicable', rateDate: dateInput.value, requestedDate: dateInput.value });
        if (rateStatus) rateStatus.textContent = '';
    });

    // Dividend Modal - Auto calculate Pre-tax from Net + Tax (and vice versa)
    const netInput = document.getElementById('dividendAmountNet');
    const taxInput = document.getElementById('dividendTax');
    const preTaxInput = document.getElementById('dividendAmount');

    let lastEdited = 'preTax'; // 'preTax' or 'net'

    netInput.addEventListener('input', () => {
        lastEdited = 'net';
        const net = parseFloat(netInput.value);
        const tax = parseFloat(taxInput.value) || 0;
        if (!isNaN(net)) {
            preTaxInput.value = parseFloat((net + tax).toFixed(6));
        } else {
            preTaxInput.value = '';
        }
    });

    preTaxInput.addEventListener('input', () => {
        lastEdited = 'preTax';
        const preTax = parseFloat(preTaxInput.value);
        const tax = parseFloat(taxInput.value) || 0;
        if (!isNaN(preTax)) {
            netInput.value = parseFloat((preTax - tax).toFixed(6));
        } else {
            netInput.value = '';
        }
    });

    taxInput.addEventListener('input', () => {
        const tax = parseFloat(taxInput.value) || 0;
        if (lastEdited === 'net') {
            const net = parseFloat(netInput.value);
            if (!isNaN(net)) {
                preTaxInput.value = parseFloat((net + tax).toFixed(6));
            }
        } else {
            const preTax = parseFloat(preTaxInput.value);
            if (!isNaN(preTax)) {
                netInput.value = parseFloat((preTax - tax).toFixed(6));
            }
        }
    });

    // Stock Price Update Button
    document.getElementById('btnUpdatePrices').addEventListener('click', async () => {
        await refreshMarketData();
    });

    // Form Submissions
    document.getElementById('formAccount').addEventListener('submit', handleAccountSubmit);
    document.getElementById('formPortfolio').addEventListener('submit', handlePortfolioSubmit);
    document.getElementById('formDividend').addEventListener('submit', handleDividendSubmit);

    // Excel Upload Trigger (if elements exist)
    const fileInput = document.getElementById('excelFileInput');
    const dropArea = document.getElementById('fileDropArea');
    if (fileInput && dropArea) {
        dropArea.addEventListener('click', () => fileInput.click());
        
        // Drag and Drop
        ['dragenter', 'dragover'].forEach(eventName => {
            dropArea.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropArea.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropArea.classList.remove('dragover');
            }, false);
        });

        dropArea.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length) {
                fileInput.files = files;
                handleFileSelect(files[0]);
            }
        });

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) {
                handleFileSelect(fileInput.files[0]);
            }
        });
    }

    // Reset Data Action
    document.getElementById('btnResetData').addEventListener('click', () => {
        document.getElementById('resetPinInput').value = '';
        openModal('modalReset');
    });

    // Execute Safety Reset
    document.getElementById('btnExecuteReset').addEventListener('click', () => {
        const pin = document.getElementById('resetPinInput').value;
        if (pin !== '0000') {
            showToast("鍮꾨�踰덊샇媛� �쇱튂�섏� �딆뒿�덈떎. (湲곕낯媛�: 0000)", "danger");
            return;
        }
        
        // 1. Auto Backup download first
        exportDataJSON();
        
        // 2. Perform deletion and reload mock data
        localStorage.removeItem('dividend_tracker_state');
        storageWriteBlocked = false;
        loadMockData();
        closeModal('modalReset');
        renderAll();
        showToast("�곗씠�곌� 諛깆뾽 諛� �덉쟾�섍쾶 珥덇린�붾릺�덉뒿�덈떎.", "success");
    });

    // JSON Export / Import
    document.getElementById('btnExportJSON').addEventListener('click', exportDataJSON);
    document.getElementById('btnImportJSON').addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const importedState = JSON.parse(event.target.result);
                        if (importedState.accounts && importedState.portfolio && importedState.dividendLogs) {
                            const recoveredState = core.migrateState(importedState, state);
                            storageWriteBlocked = false;
                            state = recoveredState;
                            if (!saveState()) throw new Error('蹂듭썝 �곗씠�� ���� �ㅽ뙣');
                            renderAll();
                            showToast("�곗씠�� 諛깆뾽�� �깃났�곸쑝濡� 蹂듭썝�섏뿀�듬땲��.", "success");
                        } else {
                            showToast("�щ컮瑜� 諛깆뾽 �뚯씪 �뺤떇�� �꾨떃�덈떎.", "danger");
                        }
                    } catch (err) {
                        showToast("�뚯씪�� �쎈뒗 以� �ㅻ쪟媛� 諛쒖깮�덉뒿�덈떎.", "danger");
                    }
                };
                reader.readAsText(file);
            }
        };
        fileInput.click();
    });

    // Filter and Sort Event Listeners
    document.getElementById('filterAccount').addEventListener('change', () => {
        populateFilterSelects();
        renderDividendLogsTable();
    });
    document.getElementById('filterStock').addEventListener('change', () => {
        renderDividendLogsTable();
    });
    document.getElementById('sortDividend').addEventListener('change', () => {
        renderDividendLogsTable();
    });
    
    // Portfolio Filters
    document.getElementById('filterPortfolioAccount')?.addEventListener('change', () => {
        renderPortfolioTable();
    });
    document.getElementById('sortPortfolio')?.addEventListener('change', () => {
        renderPortfolioTable();
    });

    // Dashboard Dividend Growth Stock Selector
    document.getElementById('dbDivGrowthStockSelect')?.addEventListener('change', () => {
        updateDividendGrowthAnalysis();
    });

    // Forecast Basis Select Change
    document.getElementById('fcBasisSelect')?.addEventListener('change', runTrendForecasting);

    // Share History Form Submit
    document.getElementById('formShareHistory').addEventListener('submit', handleShareHistorySubmit);

    // Reinvestment Tab Stock Select Change
    document.getElementById('reinvestStockSelect').addEventListener('change', handleReinvestStockChange);

    // -------------------------------------------------------
    // Buy More (異붽� 援щℓ) Modal Logic
    // -------------------------------------------------------
    document.getElementById('btnBuyMore').addEventListener('click', () => {
        if (state.portfolio.length === 0) {
            showToast('�깅줉�� 醫낅ぉ�� �놁뒿�덈떎. 癒쇱� 蹂댁쑀 二쇱떇�� �깅줉�� 二쇱꽭��.', 'warning');
            return;
        }
        document.getElementById('formBuyMore').reset();
        document.getElementById('buyMoreCurrentInfo').style.display = 'none';
        document.getElementById('buyMorePreview').style.display = 'none';
        
        populateAccountSelect('buyMoreAccountSelect');
        populatePortfolioSelect('buyMoreStock');
        document.getElementById('buyMoreStock').disabled = true;
        
        document.getElementById('buyMoreDate').value = core.localDateString();
        openModal('modalBuyMore');
    });

    document.getElementById('buyMoreAccountSelect').addEventListener('change', (e) => {
        const selectedAccountId = e.target.value;
        const stockSelectEl = document.getElementById('buyMoreStock');
        
        if (selectedAccountId) {
            populatePortfolioSelect('buyMoreStock', selectedAccountId);
            stockSelectEl.disabled = false;
        } else {
            populatePortfolioSelect('buyMoreStock');
            stockSelectEl.disabled = true;
        }
        
        document.getElementById('buyMoreCurrentInfo').style.display = 'none';
        document.getElementById('buyMorePreview').style.display = 'none';
    });

    document.getElementById('buyMoreStock').addEventListener('change', updateBuyMoreInfo);

    // Cross-calculation: shares �� per-share price �� total price
    const buySharesInput = document.getElementById('buyMoreShares');
    const buyPriceInput  = document.getElementById('buyMorePrice');
    const buyTotalInput  = document.getElementById('buyMoreTotalPrice');

    // When quantity changes �� recalculate total from per-share (if per-share is filled)
    buySharesInput.addEventListener('input', () => {
        const shares = parseFloat(buySharesInput.value);
        const price  = parseFloat(buyPriceInput.value);
        if (shares > 0 && price > 0) {
            buyTotalInput.value = parseFloat((shares * price).toFixed(6));
        }
        updateBuyMorePreview();
    });

    // When per-share price changes �� recalculate total
    buyPriceInput.addEventListener('input', () => {
        const shares = parseFloat(buySharesInput.value);
        const price  = parseFloat(buyPriceInput.value);
        if (shares > 0 && price > 0) {
            buyTotalInput.value = parseFloat((shares * price).toFixed(6));
        }
        updateBuyMorePreview();
    });

    // When total price changes �� back-calculate per-share price
    buyTotalInput.addEventListener('input', () => {
        const shares = parseFloat(buySharesInput.value);
        const total  = parseFloat(buyTotalInput.value);
        if (shares > 0 && total > 0) {
            buyPriceInput.value = parseFloat((total / shares).toFixed(6));
        }
        updateBuyMorePreview();
    });

    document.getElementById('formBuyMore').addEventListener('submit', handleBuyMoreSubmit);

    // GDrive Modal Trigger
    const btnGDriveSetup = document.getElementById('btnGDriveSetup');
    if (btnGDriveSetup) {
        btnGDriveSetup.addEventListener('click', () => {
            openModal('modalGDrive');
        });
    }

    // Mobile Sidebar Drawer Toggle
    const btnMobileMenu = document.getElementById('btnMobileMenu');
    const sidebar = document.querySelector('aside');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');

    if (btnMobileMenu && sidebar && sidebarBackdrop) {
        const closeMobileSidebar = () => {
            sidebar.classList.remove('open');
            sidebarBackdrop.classList.remove('active');
        };

        btnMobileMenu.addEventListener('click', () => {
            sidebar.classList.add('open');
            sidebarBackdrop.classList.add('active');
        });

        sidebarBackdrop.addEventListener('click', closeMobileSidebar);

        // Auto close drawer when any navigation tab or button inside is clicked
        document.querySelectorAll('aside .nav-item, aside button, aside .btn').forEach(item => {
            item.addEventListener('click', closeMobileSidebar);
        });
    }
}

// Toggle Tab Panel
function switchTab(tabId) {
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-tab') === tabId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    document.querySelectorAll('.tab-content').forEach(content => {
        if (content.id === tabId) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });

    // Re-render chart since sizes might adjust
    if (tabId === 'tab-dashboard') {
        renderCharts();
    } else if (tabId === 'tab-reinvestment') {
        populateReinvestStockSelect();
        renderReinvestmentTab();
    }
}

// Toggle Light / Dark Theme
function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme') || 'dark';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', nextTheme);
    
    // Update theme toggle button text/icon
    const themeBtn = document.getElementById('themeToggleBtn');
    if (nextTheme === 'light') {
        themeBtn.innerHTML = '<i data-lucide="moon"></i> �ㅽ겕 紐⑤뱶';
    } else {
        themeBtn.innerHTML = '<i data-lucide="sun"></i> �쇱씠�� 紐⑤뱶';
    }
    
    saveThemePreference(nextTheme);
    lucide.createIcons();
    renderCharts(); // Redraw charts with new colors
    renderReinvestmentTab(); // Redraw reinvestment chart with new colors
}

function saveThemePreference(theme) {
    localStorage.setItem('dividend_tracker_theme', theme);
}

// Modal Helpers
function openModal(modalId) {
    document.getElementById(modalId).classList.add('open');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('open');
}

// Edit Modal Launchers
function openEditAccount(id) {
    const acc = state.accounts.find(a => a.id === id);
    if (!acc) return;
    
    editingAccountId = id;
    
    document.getElementById('accountName').value = acc.name;
    document.getElementById('accountType').value = acc.type;
    document.getElementById('accountNumber').value = acc.accountNumber || '';
    
    document.querySelector('#modalAccount .modal-title').textContent = '怨꾩쥖 �뺣낫 �섏젙';
    document.querySelector('#formAccount button[type="submit"]').textContent = '�섏젙�섍린';
    
    openModal('modalAccount');
}

function openEditPortfolio(id) {
    const stock = state.portfolio.find(p => p.id === id);
    if (!stock) return;
    
    editingPortfolioId = id;
    
    populateAccountSelect('portfolioAccount');
    
    document.getElementById('portfolioAccount').value = stock.accountId;
    document.getElementById('portfolioCurrency').value = stock.currency;
    document.getElementById('portfolioName').value = stock.name;
    document.getElementById('portfolioTicker').value = stock.ticker;
    document.getElementById('portfolioShares').value = stock.shares;
    document.getElementById('portfolioAvgPrice').value = stock.avgPrice;
    document.getElementById('portfolioAnnualDividend').value = stock.annualDividend;
    document.getElementById('portfolioFrequency').value = stock.frequency;
    
    // Check months
    document.querySelectorAll('.months-selection-grid input[type="checkbox"]').forEach(cb => cb.checked = false);
    stock.exMonths.forEach(m => {
        const checkbox = document.getElementById('m' + m);
        if (checkbox) checkbox.checked = true;
    });
    
    document.querySelector('#modalPortfolio .modal-title').textContent = '蹂댁쑀 二쇱떇 �뺣낫 �섏젙';
    document.querySelector('#formPortfolio button[type="submit"]').textContent = '�섏젙�섍린';
    
    openModal('modalPortfolio');
}

function openEditDividend(id) {
    const log = state.dividendLogs.find(l => l.id === id);
    if (!log) return;
    
    editingDividendId = id;
    
    const isEtc = log.portfolioId && log.portfolioId.startsWith('etc-');
    let accountId = '';
    if (isEtc) {
        accountId = log.portfolioId.replace('etc-', '');
    } else {
        const stock = state.portfolio.find(p => p.id === log.portfolioId);
        accountId = stock ? stock.accountId : '';
    }

    populateAccountSelect('dividendAccountSelect');
    document.getElementById('dividendAccountSelect').value = accountId;

    populatePortfolioSelect('dividendStock', accountId);
    document.getElementById('dividendStock').value = log.portfolioId;
    document.getElementById('dividendStock').disabled = false;
    
    document.getElementById('dividendDate').value = log.date;
    
    const currencyField = document.getElementById('dividendCurrency');
    currencyField.value = log.currency;
    currencyField.disabled = !isEtc;
    
    document.getElementById('dividendAmount').value = log.amount;
    document.getElementById('dividendTax').value = log.tax;
    
    // Calculate and populate Net Amount
    const netAmount = (parseFloat(log.amount) - parseFloat(log.tax || 0)).toFixed(6).replace(/\.?0+$/, '');
    document.getElementById('dividendAmountNet').value = netAmount;
    
    if (log.currency === 'USD') {
        document.getElementById('exchangeRateFormGroup').style.display = 'flex';
        const rateInput = document.getElementById('dividendExchangeRate');
        rateInput.value = log.exchangeRate ?? '';
        rateInput.dataset.manualVersion = '0';
        rateInput.dataset.rateSource = log.exchangeRateSource || 'legacy-confirmed';
        rateInput.dataset.rateDate = log.exchangeRateDate || '';
        rateInput.dataset.requestedDate = log.exchangeRateRequestedDate || log.date || '';
    } else {
        document.getElementById('exchangeRateFormGroup').style.display = 'none';
        const rateInput = document.getElementById('dividendExchangeRate');
        rateInput.value = 1;
        rateInput.dataset.manualVersion = '0';
        rateInput.dataset.rateSource = 'not-applicable';
        rateInput.dataset.rateDate = '';
        rateInput.dataset.requestedDate = log.date || '';
    }
    
    document.querySelector('#modalDividend .modal-title').textContent = '諛곕떦 �섎졊 湲곕줉 �섏젙';
    document.querySelector('#formDividend button[type="submit"]').textContent = '�섏젙�섍린';
    
    openModal('modalDividend');
}

function populateAccountSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // If it's the dividend account select, add a placeholder first
    if (selectId === 'dividendAccountSelect') {
        select.innerHTML = '<option value="">怨꾩쥖瑜� 癒쇱� �좏깮�섏꽭��</option>';
    } else {
        select.innerHTML = '';
    }
    
    state.accounts.forEach(acc => {
        const option = document.createElement('option');
        option.value = acc.id;
        const accNumStr = acc.accountNumber ? `[${acc.accountNumber}] ` : '';
        option.textContent = `${accNumStr}${acc.name}`;
        select.appendChild(option);
    });
}

function populatePortfolioSelect(selectId, accountId = null) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    select.innerHTML = '<option value="">-- 醫낅ぉ �좏깮 --</option>';
    
    let filteredPortfolio = state.portfolio;
    if (accountId) {
        filteredPortfolio = state.portfolio.filter(p => p.accountId === accountId);
    }
    
    filteredPortfolio.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        if (accountId) {
            option.textContent = `${p.name} (${p.ticker})`;
        } else {
            const acc = state.accounts.find(a => a.id === p.accountId);
            const accName = acc ? acc.name : '誘몄��� 怨꾩쥖';
            option.textContent = `[${accName}] ${p.name} (${p.ticker})`;
        }
        select.appendChild(option);
    });
    
    // Add virtual "湲고�" stock if account is specified
    if (accountId) {
        const option = document.createElement('option');
        option.value = `etc-${accountId}`;
        option.textContent = `湲고� (ETC)`;
        select.appendChild(option);
    }
}

function populateFilterSelects() {
    const filterAccount = document.getElementById('filterAccount');
    const filterStock = document.getElementById('filterStock');
    
    if (!filterAccount || !filterStock) return;
    
    const selectedAccount = filterAccount.value;
    const selectedStock = filterStock.value;
    
    // 1. Populate Account Filter for Dividend Logs
    filterAccount.innerHTML = '<option value="">�꾩껜 怨꾩쥖</option>';
    state.accounts.forEach(acc => {
        const option = document.createElement('option');
        option.value = acc.id;
        const accNumStr = acc.accountNumber ? `[${acc.accountNumber}] ` : '';
        option.textContent = `${accNumStr}${acc.name}`;
        if (acc.id === selectedAccount) {
            option.selected = true;
        }
        filterAccount.appendChild(option);
    });
    
    // 1-2. Populate Account Filter for Portfolio Table
    const filterPortfolioAccount = document.getElementById('filterPortfolioAccount');
    if (filterPortfolioAccount) {
        const selectedPortAccount = filterPortfolioAccount.value;
        filterPortfolioAccount.innerHTML = '<option value="all">�꾩껜 怨꾩쥖 蹂닿린</option>';
        state.accounts.forEach(acc => {
            const option = document.createElement('option');
            option.value = acc.id;
            const accNumStr = acc.accountNumber ? `[${acc.accountNumber}] ` : '';
            option.textContent = `${accNumStr}${acc.name}`;
            if (acc.id === selectedPortAccount) {
                option.selected = true;
            }
            filterPortfolioAccount.appendChild(option);
        });
    }
    
    // 2. Populate Stock Filter based on selected Account
    filterStock.innerHTML = '<option value="">�꾩껜 醫낅ぉ</option>';
    
    let filteredPortfolio = state.portfolio;
    if (selectedAccount) {
        filteredPortfolio = state.portfolio.filter(p => p.accountId === selectedAccount);
    }
    
    filteredPortfolio.forEach(stock => {
        const option = document.createElement('option');
        option.value = stock.id;
        
        const acc = state.accounts.find(a => a.id === stock.accountId);
        const accName = acc ? acc.name : '誘몄��� 怨꾩쥖';
        
        option.textContent = `[${accName}] ${stock.name} (${stock.ticker})`;
        if (stock.id === selectedStock) {
            option.selected = true;
        }
        filterStock.appendChild(option);
    });

    // Add virtual "湲고�" stock options to filter
    if (selectedAccount) {
        const acc = state.accounts.find(a => a.id === selectedAccount);
        if (acc) {
            const option = document.createElement('option');
            option.value = `etc-${selectedAccount}`;
            option.textContent = `[${acc.name}] 湲고� (ETC)`;
            if (option.value === selectedStock) option.selected = true;
            filterStock.appendChild(option);
        }
    } else {
        state.accounts.forEach(acc => {
            const option = document.createElement('option');
            option.value = `etc-${acc.id}`;
            option.textContent = `[${acc.name}] 湲고� (ETC)`;
            if (option.value === selectedStock) option.selected = true;
            filterStock.appendChild(option);
        });
    }
    
    // If the selected stock is not in the filtered portfolio and not a virtual "湲고�" option, reset the stock filter value
    const isVirtualSelected = selectedStock && selectedStock.startsWith('etc-');
    if (selectedStock && !isVirtualSelected && !filteredPortfolio.some(p => p.id === selectedStock)) {
        filterStock.value = "";
    }
}

// Toast Notifications Helper
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'check-circle';
    if (type === 'danger') icon = 'alert-circle';
    if (type === 'warning') icon = 'help-circle';

    toast.innerHTML = `
        <i data-lucide="${icon}" class="toast-icon"></i>
        <span class="toast-text">${message}</span>
    `;

    container.appendChild(toast);
    lucide.createIcons();
    
    // Trigger transition
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after 3s
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Format Currency
function formatCurrency(val, currency = state.activeCurrency) {
    const isUSD = currency === 'USD';
    if (isUSD) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    } else {
        return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(val);
    }
}

// Converters
function convertUSDToKRW(usdVal) {
    return core.isPositiveNumber(state.currentExchangeRate) ? usdVal * state.currentExchangeRate : null;
}

function convertKRWToUSD(krwVal) {
    return core.isPositiveNumber(state.currentExchangeRate) ? krwVal / state.currentExchangeRate : null;
}

function getDividendRecordValue(log, basis = 'gross') {
    return core.getDividendValue(log, state.activeCurrency, state.currentExchangeRate, basis);
}

// Convert mixed currencies to display active currency value
function getValInActiveCurrency(val, originalCurrency) {
    if (originalCurrency === state.activeCurrency) return val;
    if (state.activeCurrency === 'KRW' && originalCurrency === 'USD') {
        return convertUSDToKRW(val);
    } else {
        return convertKRWToUSD(val);
    }
}

// Form Handlers
function handleAccountSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('accountName').value;
    const type = document.getElementById('accountType').value;
    const accountNumber = document.getElementById('accountNumber').value;
    
    if (editingAccountId) {
        const acc = state.accounts.find(a => a.id === editingAccountId);
        if (acc) {
            acc.name = name;
            acc.type = type;
            acc.accountNumber = accountNumber;
            showToast("怨꾩쥖 �뺣낫媛� �섏젙�섏뿀�듬땲��.", "success");
        }
        editingAccountId = null;
    } else {
        const newAccount = {
            id: 'acc-' + Date.now(),
            name,
            type,
            accountNumber
        };
        state.accounts.push(newAccount);
        showToast("怨꾩쥖媛� �깃났�곸쑝濡� 異붽��섏뿀�듬땲��.", "success");
    }
    saveState();
    closeModal('modalAccount');
    e.target.reset();
    renderAll();
}

function handlePortfolioSubmit(e) {
    e.preventDefault();
    const accountId = document.getElementById('portfolioAccount').value;
    const name = document.getElementById('portfolioName').value;
    const ticker = document.getElementById('portfolioTicker').value.toUpperCase();
    const shares = parseFloat(document.getElementById('portfolioShares').value);
    const avgPrice = parseFloat(document.getElementById('portfolioAvgPrice').value);
    const currency = document.getElementById('portfolioCurrency').value;
    const annualDividend = parseFloat(document.getElementById('portfolioAnnualDividend').value);
    const frequency = document.getElementById('portfolioFrequency').value;

    // Collect months
    const exMonths = [];
    document.querySelectorAll('.months-selection-grid input[type="checkbox"]:checked').forEach(cb => {
        exMonths.push(parseInt(cb.value));
    });

    if (exMonths.length === 0) {
        showToast("諛곕떦 吏�湲� �붿쓣 理쒖냼 �섎굹 �댁긽 �좏깮�� 二쇱꽭��.", "warning");
        return;
    }

    if (editingPortfolioId) {
        const stock = state.portfolio.find(p => p.id === editingPortfolioId);
        if (stock) {
            stock.accountId = accountId;
            stock.name = name;
            stock.ticker = ticker;
            stock.shares = shares;
            stock.avgPrice = avgPrice;
            stock.currency = currency;
            stock.annualDividend = annualDividend;
            stock.frequency = frequency;
            stock.exMonths = exMonths;
            
            // Sync with latest share history
            syncLatestShareHistory(stock.id, shares);
            
            showToast("蹂댁쑀 醫낅ぉ �뺣낫媛� �섏젙�섏뿀�듬땲��.", "success");
        }
        editingPortfolioId = null;
    } else {
        const newStock = {
            id: 'port-' + Date.now(),
            accountId,
            name,
            ticker,
            shares,
            avgPrice,
            currency,
            annualDividend,
            frequency,
            exMonths
        };
        state.portfolio.push(newStock);
        
        // Add initial share history entry
        state.shareHistory.push({
            id: 'sh-' + Date.now(),
            portfolioId: newStock.id,
            date: core.localDateString(),
            shares: shares
        });
        
        showToast("蹂댁쑀 醫낅ぉ�� 異붽��섏뿀�듬땲��.", "success");
    }
    saveState();
    closeModal('modalPortfolio');
    e.target.reset();
    
    // Uncheck months
    document.querySelectorAll('.months-selection-grid input[type="checkbox"]').forEach(cb => cb.checked = false);

    renderAll();
}

function syncLatestShareHistory(portfolioId, newShares) {
    const stockHistory = state.shareHistory.filter(sh => sh.portfolioId === portfolioId);
    if (stockHistory.length === 0) {
        state.shareHistory.push({
            id: 'sh-' + Date.now(),
            portfolioId: portfolioId,
            date: core.localDateString(),
            shares: newShares
        });
    } else {
        stockHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
        const latest = stockHistory[stockHistory.length - 1];
        latest.shares = newShares;
    }
}

// -------------------------------------------------------
// Additional Purchase (異붽� 援щℓ) Helpers
// -------------------------------------------------------
function updateBuyMoreInfo() {
    const select = document.getElementById('buyMoreStock');
    const stockId = select.value;
    const stock = state.portfolio.find(p => p.id === stockId);
    
    const infoBox = document.getElementById('buyMoreCurrentInfo');
    const preview = document.getElementById('buyMorePreview');
    
    if (stock) {
        document.getElementById('buyMoreCurShares').textContent = 
            stock.shares.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) + '二�';
        const currency = stock.currency === 'USD' ? '$' : '��';
        document.getElementById('buyMoreCurAvg').textContent = 
            currency + stock.avgPrice.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
        infoBox.style.display = 'block';
        preview.style.display = 'none';
    } else {
        infoBox.style.display = 'none';
        preview.style.display = 'none';
    }
    
    // Reset all price inputs when stock changes
    document.getElementById('buyMoreShares').value = '';
    document.getElementById('buyMorePrice').value = '';
    document.getElementById('buyMoreTotalPrice').value = '';
    updateBuyMorePreview();
}

function updateBuyMorePreview() {
    const select = document.getElementById('buyMoreStock');
    const stockId = select.value;
    const stock = state.portfolio.find(p => p.id === stockId);
    if (!stock) return;
    
    const addShares = parseFloat(document.getElementById('buyMoreShares').value);
    const buyPrice  = parseFloat(document.getElementById('buyMorePrice').value);
    
    const preview = document.getElementById('buyMorePreview');
    if (!addShares || !buyPrice || isNaN(addShares) || isNaN(buyPrice) || addShares <= 0 || buyPrice <= 0) {
        preview.style.display = 'none';
        return;
    }
    
    // Weighted average: (curShares * curAvg + addShares * buyPrice) / totalShares
    const totalShares = stock.shares + addShares;
    const newAvg = ((stock.shares * stock.avgPrice) + (addShares * buyPrice)) / totalShares;
    
    const currency = stock.currency === 'USD' ? '$' : '��';
    document.getElementById('buyMoreNewShares').textContent =
        totalShares.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) + '二�';
    document.getElementById('buyMoreNewAvg').textContent =
        currency + newAvg.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    
    preview.style.display = 'block';
}

function handleBuyMoreSubmit(e) {
    e.preventDefault();
    
    const select  = document.getElementById('buyMoreStock');
    const stockId = select.value;
    const stock   = state.portfolio.find(p => p.id === stockId);
    
    if (!stock) {
        showToast('醫낅ぉ�� �좏깮�� 二쇱꽭��.', 'warning');
        return;
    }
    
    const addShares = parseFloat(document.getElementById('buyMoreShares').value);
    const buyPrice  = parseFloat(document.getElementById('buyMorePrice').value);
    const buyDate   = document.getElementById('buyMoreDate').value;
    
    if (!addShares || !buyPrice || !buyDate || addShares <= 0 || buyPrice <= 0) {
        showToast('�섎웾, �④�, �좎쭨瑜� �щ컮瑜닿쾶 �낅젰�� 二쇱꽭��.', 'warning');
        return;
    }
    
    // Calculate new weighted average
    const totalShares = stock.shares + addShares;
    const newAvg = ((stock.shares * stock.avgPrice) + (addShares * buyPrice)) / totalShares;
    
    // Update portfolio entry
    stock.shares   = parseFloat(totalShares.toFixed(6));
    stock.avgPrice = parseFloat(newAvg.toFixed(6));
    
    // Add a share history entry for this purchase date
    state.shareHistory.push({
        id: 'sh-' + Date.now(),
        portfolioId: stock.id,
        date: buyDate,
        shares: stock.shares
    });
    // Sort share history by date
    state.shareHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    saveState();
    closeModal('modalBuyMore');
    e.target.reset();
    document.getElementById('buyMoreCurrentInfo').style.display = 'none';
    document.getElementById('buyMorePreview').style.display = 'none';
    
    showToast(`${stock.name} ${addShares}二� 異붽� 援щℓ 諛섏쁺 �꾨즺! 珥� ${stock.shares}二� 쨌 �됯퇏�④� ${stock.avgPrice.toFixed(2)}`, 'success');
    renderAll();
}


async function handleDividendSubmit(e) {
    e.preventDefault();
    const portfolioId = document.getElementById('dividendStock').value;
    const dateVal = document.getElementById('dividendDate').value;
    const amount = parseFloat(document.getElementById('dividendAmount').value);
    const tax = parseFloat(document.getElementById('dividendTax').value) || 0;
    
    const isEtc = portfolioId && portfolioId.startsWith('etc-');
    const stock = state.portfolio.find(p => p.id === portfolioId);
    
    if (!stock && !isEtc) {
        showToast("醫낅ぉ�� �좏깮�� 二쇱꽭��.", "warning");
        return;
    }
    if (!core.isPositiveNumber(amount) || tax < 0 || tax > amount) {
        showToast('�몄쟾 �섎졊�↔낵 �멸툑�� �щ컮瑜닿쾶 �낅젰�� 二쇱꽭��.', 'warning');
        return;
    }

    const currency = document.getElementById('dividendCurrency').value;
    let rate = 1;
    let rateDate = dateVal;
    let rateSource = 'not-applicable';
    let rateRequestedDate = dateVal;
    if (currency === 'USD') {
        const rateInput = document.getElementById('dividendExchangeRate');
        rate = parseFloat(rateInput.value);
        rateDate = rateInput.dataset.rateDate || dateVal;
        rateSource = rateInput.dataset.rateSource || 'manual';
        rateRequestedDate = rateInput.dataset.requestedDate || dateVal;
        if (!core.isPositiveNumber(rate)) {
            const result = await getHistoricalExchangeRate(dateVal);
            if (!result.ok) {
                showToast('怨쇨굅 �섏쑉�� �뺤젙�� �� �놁뒿�덈떎. �곸슜 �섏쑉�� 吏곸젒 �낅젰�� 二쇱꽭��.', 'danger');
                return;
            }
            rate = result.rate;
            rateDate = result.rateDate;
            rateSource = result.source;
            rateRequestedDate = result.requestedDate;
        }
    }

    const amountKRW = currency === 'KRW' ? amount : amount * rate;
    const netAmount = amount - tax;
    const netAmountKRW = currency === 'KRW' ? netAmount : netAmount * rate;

    if (editingDividendId) {
        const log = state.dividendLogs.find(l => l.id === editingDividendId);
        if (log) {
            log.portfolioId = portfolioId;
            log.date = dateVal;
            log.amount = amount;
            log.currency = currency;
            log.exchangeRate = rate;
            log.amountKRW = amountKRW;
            log.tax = tax;
            log.netAmount = netAmount;
            log.netAmountKRW = netAmountKRW;
            log.exchangeRateDate = rateDate;
            log.exchangeRateRequestedDate = rateRequestedDate;
            log.exchangeRateSource = rateSource;
            log.exchangeRateIsFallback = false;
            showToast("諛곕떦 �섎졊 湲곕줉�� �섏젙�섏뿀�듬땲��.", "success");
        }
        editingDividendId = null;
    } else {
        const newLog = {
            id: 'log-' + Date.now(),
            date: dateVal,
            portfolioId,
            amount,
            currency,
            exchangeRate: rate,
            amountKRW,
            tax,
            netAmount,
            netAmountKRW,
            exchangeRateDate: rateDate,
            exchangeRateRequestedDate: rateRequestedDate,
            exchangeRateSource: rateSource,
            exchangeRateIsFallback: false
        };
        state.dividendLogs.push(newLog);
        showToast("諛곕떦湲� �섎졊 湲곕줉�� 異붽��섏뿀�듬땲��.", "success");
    }

    // Sort logs by date
    state.dividendLogs.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    saveState();
    closeModal('modalDividend');
    e.target.reset();
    renderAll();
}

// Delete Handlers
function deleteAccount(id) {
    if (confirm("�� 怨꾩쥖瑜� ��젣�섏떆寃좎뒿�덇퉴? �곌껐�� �ы듃�대━�� 諛� 諛곕떦湲� �섎졊 湲곕줉�� ��젣�� �� �덉뒿�덈떎.")) {
        // Find portfolio items tied to this account
        const portIds = state.portfolio.filter(p => p.accountId === id).map(p => p.id);
        // Filter portfolio
        state.portfolio = state.portfolio.filter(p => p.accountId !== id);
        // Filter dividend logs (including virtual etc-accId logs)
        state.dividendLogs = state.dividendLogs.filter(log => {
            if (log.portfolioId.startsWith('etc-')) {
                const accId = log.portfolioId.replace('etc-', '');
                return accId !== id;
            }
            return !portIds.includes(log.portfolioId);
        });
        // Filter share history
        state.shareHistory = state.shareHistory.filter(sh => !portIds.includes(sh.portfolioId));
        // Filter account
        state.accounts = state.accounts.filter(a => a.id !== id);
        
        saveState();
        renderAll();
        showToast("怨꾩쥖媛� ��젣�섏뿀�듬땲��.", "success");
    }
}

function deletePortfolio(id) {
    if (confirm("�� 蹂댁쑀 醫낅ぉ�� ��젣�섏떆寃좎뒿�덇퉴? 愿��⑤맂 諛곕떦湲� �섎졊 湲곕줉�� 紐⑤몢 ��젣�⑸땲��.")) {
        state.portfolio = state.portfolio.filter(p => p.id !== id);
        state.dividendLogs = state.dividendLogs.filter(log => log.portfolioId !== id);
        state.shareHistory = state.shareHistory.filter(sh => sh.portfolioId !== id);
        saveState();
        renderAll();
        showToast("醫낅ぉ�� ��젣�섏뿀�듬땲��.", "success");
    }
}

function deleteDividendLog(id) {
    if (confirm("�� 諛곕떦湲� �섎졊 湲곕줉�� ��젣�섏떆寃좎뒿�덇퉴?")) {
        state.dividendLogs = state.dividendLogs.filter(log => log.id !== id);
        saveState();
        renderAll();
        showToast("�섎졊 湲곕줉�� ��젣�섏뿀�듬땲��.", "success");
    }
}

// Export Data as JSON file
function exportDataJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    const dateStamp = core.localDateString();
    downloadAnchor.setAttribute("download", `dividend_backup_${dateStamp}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("�곗씠�� 諛깆뾽 �뚯씪�� �대낫�댁죱�듬땲��.", "success");
}

// Excel File Parsing & Handling
let parsedExcelRows = [];
let excelHeaders = [];
let importType = 'portfolio'; // portfolio or logs

function handleFileSelect(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        try {
            const workbook = XLSX.read(data, { type: 'array' });
            // Select first sheet
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            // Get headers and rows
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            if (json.length === 0) {
                showToast("�묒� �뚯씪�� 鍮꾩뼱 �덉뒿�덈떎.", "danger");
                return;
            }
            
            excelHeaders = json[0].map(h => String(h).trim());
            parsedExcelRows = XLSX.utils.sheet_to_json(worksheet);
            
            setupMappingUI();
            
            // Advance to Step 2
            document.getElementById('importStep1').classList.remove('active');
            document.getElementById('importStep2').classList.add('active');
            
            showToast("�묒� �뚯씪�� 遺꾩꽍�섏뿀�듬땲��. �� 留ㅽ븨�� �쒖옉�� 二쇱꽭��.", "success");
        } catch (err) {
            console.error("Excel read error:", err);
            showToast("�묒� �뚯씪�� �뚯떛�섎뒗 �� �ㅽ뙣�덉뒿�덈떎. 吏��� �뺤떇(.xlsx, .xls, .csv)�� �뺤씤�� 二쇱꽭��.", "danger");
        }
    };
    reader.readAsArrayBuffer(file);
}

// Set up UI mapping dynamically
function setupMappingUI() {
    importType = document.getElementById('excelImportType').value;
    const mappingFieldsContainer = document.getElementById('mappingFields');
    mappingFieldsContainer.innerHTML = '';
    
    let fields = [];
    if (importType === 'portfolio') {
        fields = [
            { key: 'account', label: '怨꾩쥖紐� (Account)', required: true },
            { key: 'name', label: '醫낅ぉ紐� (Name)', required: true },
            { key: 'ticker', label: '�곗빱/醫낅ぉ肄붾뱶 (Ticker)', required: true },
            { key: 'shares', label: '蹂댁쑀�섎웾 (Shares)', required: true },
            { key: 'avgPrice', label: '�됯퇏留ㅼ닔�④� (Avg Price)', required: true },
            { key: 'currency', label: '�듯솕 (KRW/USD)', required: false },
            { key: 'annualDividend', label: '二쇰떦 �곕같�밴툑 (Annual Dividend)', required: true },
            { key: 'frequency', label: '諛곕떦二쇨린 (Monthly/Quarterly...)', required: false },
            { key: 'exMonths', label: '諛곕떦�� 紐⑸줉 (��: 3,6,9,12)', required: false }
        ];
    } else {
        // Dividend logs
        fields = [
            { key: 'date', label: '諛곕떦 �섎졊�� (Date)', required: true },
            { key: 'ticker', label: '�곗빱 �먮뒗 醫낅ぉ肄붾뱶 (Ticker)', required: true },
            { key: 'amount', label: '�몄쟾 諛곕떦湲덉븸 (Amount)', required: true },
            { key: 'currency', label: '�듯솕 (KRW/USD)', required: false },
            { key: 'tax', label: '諛곕떦�멸툑 (Tax)', required: false },
            { key: 'exchangeRate', label: '�섏쑉 (Exchange Rate)', required: false }
        ];
    }

    fields.forEach(f => {
        const formGroup = document.createElement('div');
        formGroup.className = 'mapping-field form-group';
        
        // Auto match logic
        let bestMatch = '';
        const lowercaseLabel = f.label.toLowerCase();
        const lowercaseKey = f.key.toLowerCase();
        
        for (let header of excelHeaders) {
            const hLower = header.toLowerCase();
            if (hLower === lowercaseKey || 
                hLower.includes(lowercaseKey) || 
                lowercaseLabel.includes(hLower) ||
                (f.key === 'account' && (hLower.includes('怨꾩쥖') || hLower.includes('acc'))) ||
                (f.key === 'avgPrice' && (hLower.includes('�④�') || hLower.includes('留ㅼ닔媛�') || hLower.includes('�됰떒'))) ||
                (f.key === 'shares' && (hLower.includes('�섎웾') || hLower.includes('蹂댁쑀') || hLower.includes('媛쒖닔'))) ||
                (f.key === 'annualDividend' && (hLower.includes('諛곕떦湲�') || hLower.includes('�곕같��'))) ||
                (f.key === 'exMonths' && hLower.includes('諛곕떦��')) ||
                (f.key === 'ticker' && (hLower.includes('肄붾뱶') || hLower.includes('�곗빱') || hLower.includes('symbol'))) ||
                (f.key === 'date' && (hLower.includes('�쇱옄') || hLower.includes('�좎쭨') || hLower.includes('諛곕떦��'))) ||
                (f.key === 'tax' && (hLower.includes('�멸툑') || hLower.includes('�먯쿇吏뺤닔'))) ||
                (f.key === 'amount' && (hLower.includes('�섎졊��') || hLower.includes('湲덉븸') || hLower.includes('諛곕떦湲�')))) {
                bestMatch = header;
                break;
            }
        }

        let options = excelHeaders.map(h => `<option value="${h}" ${h === bestMatch ? 'selected' : ''}>${h}</option>`).join('');
        options = `<option value="">-- 留ㅽ븨 �� �� ${f.required ? '(�꾩닔)' : ''} --</option>` + options;
        
        formGroup.innerHTML = `
            <label>${f.label}</label>
            <select id="map-${f.key}" ${f.required ? 'required' : ''}>
                ${options}
            </select>
        `;
        mappingFieldsContainer.appendChild(formGroup);
    });

    document.getElementById('btnSubmitImport').onclick = executeImport;
    document.getElementById('btnCancelImport').onclick = () => {
        document.getElementById('importStep2').classList.remove('active');
        document.getElementById('importStep1').classList.add('active');
        parsedExcelRows = [];
        excelHeaders = [];
    };
}

// Perform Excel Import insertion
async function executeImport() {
    let successCount = 0;
    let failCount = 0;
    
    showToast("�곗씠�곕� 媛��몄삤�� 以묒엯�덈떎...", "warning");

    if (importType === 'portfolio') {
        const mapAccount = document.getElementById('map-account').value;
        const mapName = document.getElementById('map-name').value;
        const mapTicker = document.getElementById('map-ticker').value;
        const mapShares = document.getElementById('map-shares').value;
        const mapAvgPrice = document.getElementById('map-avgPrice').value;
        const mapCurrency = document.getElementById('map-currency').value;
        const mapAnnualDividend = document.getElementById('map-annualDividend').value;
        const mapFrequency = document.getElementById('map-frequency').value;
        const mapExMonths = document.getElementById('map-exMonths').value;

        for (let row of parsedExcelRows) {
            try {
                const accountName = String(row[mapAccount] || '').trim();
                const stockName = String(row[mapName] || '').trim();
                const ticker = String(row[mapTicker] || '').trim().toUpperCase();
                const shares = parseFloat(row[mapShares]);
                const avgPrice = parseFloat(row[mapAvgPrice]);
                const annualDividend = parseFloat(row[mapAnnualDividend]);

                if (!accountName || !stockName || !ticker || isNaN(shares) || isNaN(avgPrice) || isNaN(annualDividend)) {
                    failCount++;
                    continue;
                }

                // Find or create Account
                let account = state.accounts.find(a => a.name.toLowerCase() === accountName.toLowerCase());
                if (!account) {
                    account = {
                        id: 'acc-' + Date.now() + Math.random().toString(36).substr(2, 5),
                        name: accountName,
                        type: 'General'
                    };
                    state.accounts.push(account);
                }

                // Currency check
                let currency = 'KRW';
                if (mapCurrency && row[mapCurrency]) {
                    const curStr = String(row[mapCurrency]).trim().toUpperCase();
                    if (curStr === 'USD' || curStr === '$' || curStr.includes('�щ윭')) {
                        currency = 'USD';
                    }
                } else {
                    // Try to guess from ticker / average price
                    if (ticker.match(/[A-Z]{1,5}/) && avgPrice < 10000) {
                        currency = 'USD';
                    }
                }

                // Frequency check
                let frequency = 'Quarterly';
                if (mapFrequency && row[mapFrequency]) {
                    const freqStr = String(row[mapFrequency]).trim().toLowerCase();
                    if (freqStr.includes('��') || freqStr.includes('month')) frequency = 'Monthly';
                    else if (freqStr.includes('諛�') || freqStr.includes('semi')) frequency = 'Semi-Annual';
                    else if (freqStr.includes('��') || freqStr.includes('annual')) frequency = 'Annual';
                }

                // ExMonths check
                let exMonths = [3, 6, 9, 12]; // default quarterly
                if (mapExMonths && row[mapExMonths]) {
                    const monthsStr = String(row[mapExMonths]).trim();
                    const parsedMonths = monthsStr.split(/[,;\s]+/).map(m => parseInt(m)).filter(m => !isNaN(m) && m >= 1 && m <= 12);
                    if (parsedMonths.length > 0) exMonths = parsedMonths;
                } else if (frequency === 'Monthly') {
                    exMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                }

                const newPortfolioItem = {
                    id: 'port-' + Date.now() + Math.random().toString(36).substr(2, 5),
                    accountId: account.id,
                    name: stockName,
                    ticker,
                    shares,
                    avgPrice,
                    currency,
                    annualDividend,
                    frequency,
                    exMonths
                };

                state.portfolio.push(newPortfolioItem);
                successCount++;
            } catch (err) {
                console.error("Row import error:", err);
                failCount++;
            }
        }
    } else {
        // Import Dividend Logs
        const mapDate = document.getElementById('map-date').value;
        const mapTicker = document.getElementById('map-ticker').value;
        const mapAmount = document.getElementById('map-amount').value;
        const mapCurrency = document.getElementById('map-currency').value;
        const mapTax = document.getElementById('map-tax').value;
        const mapRate = document.getElementById('map-exchangeRate').value;

        for (let row of parsedExcelRows) {
            try {
                let rawDate = row[mapDate];
                let dateStr = '';
                if (rawDate) {
                    if (typeof rawDate === 'number') {
                        // Excel serial date representation
                        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                        const targetDate = new Date(excelEpoch.getTime() + rawDate * 24 * 60 * 60 * 1000);
                        dateStr = core.localDateString(targetDate);
                    } else {
                        // Regular string date format
                        const dateObj = new Date(String(rawDate).trim());
                        if (!isNaN(dateObj.getTime())) {
                            dateStr = core.localDateString(dateObj);
                        }
                    }
                }

                const ticker = String(row[mapTicker] || '').trim().toUpperCase();
                const amount = parseFloat(row[mapAmount]);

                if (!dateStr || !ticker || isNaN(amount)) {
                    failCount++;
                    continue;
                }

                // Match with portfolio item ticker
                let stock = state.portfolio.find(p => p.ticker === ticker);
                if (!stock) {
                    // Create dummy stock under default account
                    let defaultAcc = state.accounts[0];
                    if (!defaultAcc) {
                        defaultAcc = { id: 'acc-default', name: '媛��몄삩 怨꾩쥖', type: 'General' };
                        state.accounts.push(defaultAcc);
                    }
                    stock = {
                        id: 'port-import-' + Date.now() + Math.random().toString(36).substr(2, 5),
                        accountId: defaultAcc.id,
                        name: ticker,
                        ticker: ticker,
                        shares: 1,
                        avgPrice: 1,
                        currency: (amount < 1000) ? 'USD' : 'KRW', // simple guess
                        annualDividend: 0,
                        frequency: 'Quarterly',
                        exMonths: [3,6,9,12]
                    };
                    state.portfolio.push(stock);
                }

                const currency = (mapCurrency && row[mapCurrency]) ? String(row[mapCurrency]).trim().toUpperCase() : stock.currency;
                
                let rate = 1;
                let rateDate = dateStr;
                let rateSource = 'not-applicable';
                let rateRequestedDate = dateStr;
                if (currency === 'USD') {
                    if (mapRate && row[mapRate] && !isNaN(parseFloat(row[mapRate]))) {
                        rate = parseFloat(row[mapRate]);
                        if (!core.isPositiveNumber(rate)) throw new Error('�섏쑉 媛믪씠 �щ컮瑜댁� �딆뒿�덈떎.');
                        rateSource = 'excel-manual';
                    } else {
                        // Fetch historical rate
                        const result = await getHistoricalExchangeRate(dateStr);
                        if (!result.ok) throw new Error(`${dateStr} 怨쇨굅 �섏쑉 議고쉶 �ㅽ뙣`);
                        rate = result.rate;
                        rateDate = result.rateDate;
                        rateRequestedDate = result.requestedDate;
                        rateSource = result.source;
                    }
                }

                const amountKRW = currency === 'KRW' ? amount : amount * rate;
                const tax = (mapTax && row[mapTax]) ? parseFloat(row[mapTax]) : 0;
                const safeTax = isNaN(tax) ? 0 : tax;

                const newLog = {
                    id: 'log-' + Date.now() + Math.random().toString(36).substr(2, 5),
                    date: dateStr,
                    portfolioId: stock.id,
                    amount,
                    currency,
                    exchangeRate: rate,
                    amountKRW,
                    tax: safeTax,
                    netAmount: amount - safeTax,
                    netAmountKRW: amountKRW - (safeTax * rate),
                    exchangeRateDate: rateDate,
                    exchangeRateRequestedDate: rateRequestedDate,
                    exchangeRateSource: rateSource,
                    exchangeRateIsFallback: false
                };

                state.dividendLogs.push(newLog);
                successCount++;
            } catch (err) {
                console.error("Dividend row import error:", err);
                failCount++;
            }
        }
        state.dividendLogs.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    saveState();
    
    // Switch to step 1 and clear
    document.getElementById('importStep2').classList.remove('active');
    document.getElementById('importStep1').classList.add('active');
    parsedExcelRows = [];
    excelHeaders = [];
    document.getElementById('excelFileInput').value = '';

    renderAll();
    
    showToast(`${successCount}媛쒖쓽 �됱쓣 �깃났�곸쑝濡� 媛��몄솕�듬땲��. (�ㅻ쪟: ${failCount}媛�)`, "success");
    switchTab('tab-dashboard');
}

// Rendering Logic
function renderAll() {
    // Populate filters first
    populateFilterSelects();

    // KPI Cards
    renderKPIs();
    
    // Tables
    renderAccountsTable();
    renderPortfolioTable();
    renderDividendLogsTable();
    
    // Charts
    renderCharts();

    // Reinitialize Lucide Icons for dynamic content
    lucide.createIcons();
}

function renderKPIs() {
    // Calculators
    let totalCostBasis = 0;        // 留ㅼ닔湲덉븸 (shares 횞 avgPrice)
    let totalMarketValue = 0;      // �됯�湲덉븸 (shares 횞 currentPrice)
    let totalExpectedAnnualDiv = 0;
    let pricedCostBasis = 0;
    let pricedExpectedAnnualDiv = 0;
    let freshCount = 0;
    let staleCount = 0;
    let missingCount = 0;

    state.portfolio.forEach(stock => {
        const costVal = stock.shares * stock.avgPrice;
        const priceData = getStockPriceData(stock);
        const freshness = core.getPriceFreshness(priceData);
        const marketVal = freshness.available ? stock.shares * Number(priceData.price) : 0;
        const expectedDiv = stock.shares * stock.annualDividend;
        
        totalCostBasis += getValInActiveCurrency(costVal, stock.currency);
        if (freshness.available) {
            totalMarketValue += getValInActiveCurrency(marketVal, stock.currency) || 0;
            pricedCostBasis += getValInActiveCurrency(costVal, stock.currency) || 0;
            pricedExpectedAnnualDiv += getValInActiveCurrency(expectedDiv, stock.currency) || 0;
            if (freshness.stale) staleCount++; else freshCount++;
        } else {
            missingCount++;
        }
        totalExpectedAnnualDiv += getValInActiveCurrency(expectedDiv, stock.currency);
    });

    // Cumulative Received Dividend
    let totalReceivedDiv = 0;
    state.dividendLogs.forEach(log => {
        totalReceivedDiv += getDividendRecordValue(log, 'gross') || 0;
    });

    // Average Yield (based on market value)
    const avgYield = totalMarketValue > 0 ? (pricedExpectedAnnualDiv / totalMarketValue) * 100 : 0;
    
    // Profit / Loss
    const profitLoss = totalMarketValue - pricedCostBasis;
    const profitLossRate = pricedCostBasis > 0 ? (profitLoss / pricedCostBasis) * 100 : 0;
    const plSign = profitLoss >= 0 ? '+' : '';
    const plClass = profitLoss >= 0 ? 'positive' : 'negative';

    // Update elements
    document.getElementById('kpiTotalCost').textContent = formatCurrency(totalCostBasis);
    document.getElementById('kpiMarketValue').textContent = formatCurrency(totalMarketValue);
    const coverageEl = document.getElementById('kpiMarketCoverage');
    if (coverageEl) coverageEl.textContent = `�쒖꽭 �ы븿 ${freshCount + staleCount}/${state.portfolio.length} 쨌 理쒖떊 ${freshCount} 쨌 �ㅻ옒�� ${staleCount} 쨌 誘몄“�� ${missingCount}`;
    
    const plEl = document.getElementById('kpiProfitLoss');
    if (plEl) {
        plEl.textContent = `${plSign}${formatCurrency(profitLoss)} (${plSign}${profitLossRate.toFixed(2)}%)`;
        plEl.className = `kpi-sub kpi-trend ${plClass}`;
        plEl.style.fontSize = '0.8rem';
        plEl.style.marginTop = '0.2rem';
    }
    
    document.getElementById('kpiAnnualDividends').textContent = formatCurrency(totalExpectedAnnualDiv);
    document.getElementById('kpiAverageYield').textContent = avgYield.toFixed(2) + '%';
    document.getElementById('kpiTotalReceived').textContent = formatCurrency(totalReceivedDiv);
    
    // Update price timestamp
    updatePriceTimestamp();
}

function renderAccountsTable() {
    const listContainer = document.getElementById('accountsGrid');
    listContainer.innerHTML = '';
    
    if (state.accounts.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state full-width">
                <i data-lucide="wallet"></i>
                <h3>�깅줉�� 怨꾩쥖媛� �놁뒿�덈떎</h3>
                <p>諛곕떦二쇰� 愿�由ы븷 怨꾩쥖瑜� �깅줉�� 二쇱꽭��.</p>
            </div>
        `;
        return;
    }

    state.accounts.forEach(acc => {
        // Calculate Account Portfolio Value and Dividends
        let accCostVal = 0;
        let accMarketVal = 0;
        let accExpectedDiv = 0;
        
        state.portfolio.filter(p => p.accountId === acc.id).forEach(stock => {
            accCostVal += getValInActiveCurrency(stock.shares * stock.avgPrice, stock.currency);
            accMarketVal += getValInActiveCurrency(stock.shares * getStockCurrentPrice(stock), stock.currency);
            accExpectedDiv += getValInActiveCurrency(stock.shares * stock.annualDividend, stock.currency);
        });

        const accPL = accMarketVal - accCostVal;
        const accPLRate = accCostVal > 0 ? (accPL / accCostVal) * 100 : 0;
        const accPLSign = accPL >= 0 ? '+' : '';
        const accPLClass = accPL >= 0 ? 'positive' : 'negative';

        const card = document.createElement('div');
        card.className = 'account-card';
        card.innerHTML = `
            <div class="account-card-header">
                <span class="account-card-title">${acc.name}</span>
                <div class="action-btns">
                    <button class="btn-table-icon" onclick="openEditAccount('${acc.id}')">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button class="btn-table-icon delete" onclick="deleteAccount('${acc.id}')">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
            <div class="account-card-body">
                <div class="account-stat">
                    <span class="account-stat-label">留ㅼ닔 湲덉븸</span>
                    <span class="account-stat-value">${formatCurrency(accCostVal)}</span>
                </div>
                <div class="account-stat">
                    <span class="account-stat-label">�됯� 湲덉븸</span>
                    <span class="account-stat-value">${formatCurrency(accMarketVal)}</span>
                    <span class="kpi-trend ${accPLClass}" style="font-size: 0.75rem;">${accPLSign}${accPLRate.toFixed(2)}%</span>
                </div>
                <div class="account-stat">
                    <span class="account-stat-label">�� �덉긽 諛곕떦湲�</span>
                    <span class="account-stat-value">${formatCurrency(accExpectedDiv)}</span>
                </div>
            </div>
        `;
        listContainer.appendChild(card);
    });
}

function renderPortfolioTable() {
    const tbody = document.getElementById('portfolioTableBody');
    tbody.innerHTML = '';

    const filterAccount = document.getElementById('filterPortfolioAccount') ? document.getElementById('filterPortfolioAccount').value : 'all';
    const sortOption = document.getElementById('sortPortfolio') ? document.getElementById('sortPortfolio').value : 'account-asc';

    let filteredPortfolio = state.portfolio.filter(stock => {
        if (filterAccount !== 'all' && stock.accountId !== filterAccount) {
            return false;
        }
        return true;
    });

    if (filteredPortfolio.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="13" class="empty-state">
                    <i data-lucide="folder-open"></i>
                    <h3>蹂댁쑀 醫낅ぉ�� �놁뒿�덈떎</h3>
                    <p>議곌굔�� 留욌뒗 醫낅ぉ�� �녾굅�� �깅줉�� 二쇱떇�� �놁뒿�덈떎.</p>
                </td>
            </tr>
        `;
        return;
    }

    // Prepare enriched data for sorting
    const enrichedPortfolio = filteredPortfolio.map(stock => {
        const acc = state.accounts.find(a => a.id === stock.accountId);
        const currentPrice = getStockCurrentPrice(stock);
        const totalCost = stock.shares * stock.avgPrice;
        const totalMarketVal = stock.shares * currentPrice;
        const profitLoss = totalMarketVal - totalCost;
        const plRate = totalCost > 0 ? (profitLoss / totalCost) * 100 : 0;
        const yieldRate = hasAnyPrice(stock) && currentPrice > 0 ? (stock.annualDividend / currentPrice) * 100 : null;
        
        return {
            ...stock,
            accName: acc ? acc.name : '誘몄��� 怨꾩쥖',
            accType: acc ? acc.type : 'General',
            currentPrice,
            totalCost,
            totalMarketVal,
            profitLoss,
            plRate,
            yieldRate
        };
    });

    // Sort logic
    enrichedPortfolio.sort((a, b) => {
        if (sortOption === 'account-asc') {
            if (a.accName !== b.accName) return a.accName.localeCompare(b.accName);
            return a.name.localeCompare(b.name);
        }
        if (sortOption === 'name-asc') return a.name.localeCompare(b.name);
        if (sortOption === 'amount-desc') return b.totalCost - a.totalCost;
        if (sortOption === 'eval-desc') return b.totalMarketVal - a.totalMarketVal;
        if (sortOption === 'yield-desc') return b.yieldRate - a.yieldRate;
        if (sortOption === 'profit-desc') return b.plRate - a.plRate;
        return 0;
    });

    enrichedPortfolio.forEach(stock => {
        const plSign = stock.profitLoss >= 0 ? '+' : '';
        const plClass = stock.profitLoss >= 0 ? 'positive' : 'negative';
        const totalDiv = stock.shares * stock.annualDividend;
        
        // CSS Row Class
        const rowClass = `row-account-${stock.accType.toLowerCase()}`;
        
        // Display current price or dash if not fetched
        const curPriceDisplay = hasAnyPrice(stock)
            ? `${formatCurrency(stock.currentPrice, stock.currency)}${formatPriceQuoteMeta(stock)}`
            : `<span style="color:var(--text-secondary);">��</span>${formatPriceQuoteMeta(stock)}`;
        
        const tr = document.createElement('tr');
        tr.className = rowClass;
        tr.innerHTML = `
            <td><span class="account-badge">${stock.accName}</span></td>
            <td><strong>${stock.name}</strong></td>
            <td><span class="ticker-badge">${stock.ticker}</span></td>
            <td>${stock.shares}</td>
            <td>${formatCurrency(stock.avgPrice, stock.currency)}</td>
            <td>${formatCurrency(stock.totalCost, stock.currency)}</td>
            <td>${curPriceDisplay}</td>
            <td>${hasAnyPrice(stock) ? formatCurrency(stock.totalMarketVal, stock.currency) : '<span style="color:var(--text-secondary);">��</span>'}</td>
            <td>${hasAnyPrice(stock) ? `<span class="kpi-trend ${plClass}">${plSign}${formatCurrency(stock.profitLoss, stock.currency)}<br><small>(${plSign}${stock.plRate.toFixed(2)}%)</small></span>` : '<span style="color:var(--text-secondary);">��</span>'}</td>
            <td>${formatCurrency(stock.annualDividend, stock.currency)}</td>
            <td>${formatCurrency(totalDiv, stock.currency)}</td>
            <td>${stock.yieldRate === null ? '<span style="color:var(--text-secondary);">��</span>' : `<span class="kpi-trend positive">${stock.yieldRate.toFixed(2)}%</span>`}</td>
            <td>
                <div class="action-btns">
                    <button class="btn-table-icon" onclick="openShareHistoryModal('${stock.id}')" title="�섎웾 蹂��� �대젰">
                        <i data-lucide="history"></i>
                    </button>
                    <button class="btn-table-icon" onclick="openEditPortfolio('${stock.id}')">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button class="btn-table-icon delete" onclick="deletePortfolio('${stock.id}')">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderDividendLogsTable() {
    const tbody = document.getElementById('dividendLogsTableBody');
    tbody.innerHTML = '';

    if (state.dividendLogs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <i data-lucide="bar-chart-2"></i>
                    <h3>湲곕줉�� 諛곕떦 �섎졊 �댁뿭�� �놁뒿�덈떎</h3>
                    <p>�곗륫 �곷떒�� 諛곕떦 �섎졊 湲곕줉�� �깅줉�섍굅�� �묒�濡� �� 踰덉뿉 媛��몄삤�몄슂.</p>
                </td>
            </tr>
        `;
        return;
    }

    const filterAccount = document.getElementById('filterAccount') ? document.getElementById('filterAccount').value : '';
    const filterStock = document.getElementById('filterStock') ? document.getElementById('filterStock').value : '';
    const sortDividend = document.getElementById('sortDividend') ? document.getElementById('sortDividend').value : 'date-desc';

    // Filter logs
    let filteredLogs = state.dividendLogs.filter(log => {
        const isEtc = log.portfolioId && log.portfolioId.startsWith('etc-');
        let accountId = '';
        if (isEtc) {
            accountId = log.portfolioId.replace('etc-', '');
        } else {
            const stock = state.portfolio.find(p => p.id === log.portfolioId);
            accountId = stock ? stock.accountId : '';
        }
        
        // 1. Account Filter
        if (filterAccount) {
            if (accountId !== filterAccount) {
                return false;
            }
        }
        
        // 2. Stock Filter
        if (filterStock) {
            if (log.portfolioId !== filterStock) {
                return false;
            }
        }
        
        return true;
    });

    if (filteredLogs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <i data-lucide="filter"></i>
                    <h3>�꾪꽣 議곌굔�� 留욌뒗 諛곕떦 �섎졊 �댁뿭�� �놁뒿�덈떎</h3>
                    <p>�ㅻⅨ �꾪꽣 議곌굔�� �좏깮�� 蹂댁꽭��.</p>
                </td>
            </tr>
        `;
        return;
    }

    // Sort logs
    filteredLogs.sort((a, b) => {
        const isEtcA = a.portfolioId && a.portfolioId.startsWith('etc-');
        const isEtcB = b.portfolioId && b.portfolioId.startsWith('etc-');

        const stockA = isEtcA ? null : state.portfolio.find(p => p.id === a.portfolioId);
        const stockB = isEtcB ? null : state.portfolio.find(p => p.id === b.portfolioId);
        
        const accIdA = isEtcA ? a.portfolioId.replace('etc-', '') : (stockA ? stockA.accountId : '');
        const accIdB = isEtcB ? b.portfolioId.replace('etc-', '') : (stockB ? stockB.accountId : '');

        const accA = state.accounts.find(acc => acc.id === accIdA);
        const accB = state.accounts.find(acc => acc.id === accIdB);

        const accNameA = accA ? accA.name : '';
        const accNameB = accB ? accB.name : '';

        const stockNameA = isEtcA ? '湲고�' : (stockA ? stockA.name : '');
        const stockNameB = isEtcB ? '湲고�' : (stockB ? stockB.name : '');

        switch (sortDividend) {
            case 'date-asc':
                return new Date(a.date) - new Date(b.date);
            case 'date-desc':
                return new Date(b.date) - new Date(a.date);
            case 'amount-asc':
                return a.amountKRW - b.amountKRW;
            case 'amount-desc':
                return b.amountKRW - a.amountKRW;
            case 'account-asc':
                return accNameA.localeCompare(accNameB, 'ko');
            case 'account-desc':
                return accNameB.localeCompare(accNameA, 'ko');
            case 'stock-asc':
                return stockNameA.localeCompare(stockNameB, 'ko');
            case 'stock-desc':
                return stockNameB.localeCompare(stockNameA, 'ko');
            default:
                return new Date(b.date) - new Date(a.date);
        }
    });

    filteredLogs.forEach(log => {
        const isEtc = log.portfolioId && log.portfolioId.startsWith('etc-');
        let stockName = '湲고�';
        let ticker = 'ETC';
        let accountId = '';
        if (isEtc) {
            accountId = log.portfolioId.replace('etc-', '');
        } else {
            const stock = state.portfolio.find(p => p.id === log.portfolioId);
            stockName = stock ? stock.name : '��젣�� 醫낅ぉ';
            ticker = stock ? stock.ticker : '-';
            accountId = stock ? stock.accountId : '';
        }
        
        const acc = state.accounts.find(a => a.id === accountId);
        const accName = acc ? acc.name : '誘몄��� 怨꾩쥖';
        const accType = acc ? acc.type : 'General';
        
        // Format date to Year-Month (e.g. 2026-06)
        const dateParts = log.date.split('-');
        const yyyymm = dateParts.length >= 2 ? `${dateParts[0]}-${dateParts[1]}` : log.date;
        
        const rateValue = Number(log.exchangeRate);
        const rateBasis = log.exchangeRateDate
            ? (log.exchangeRateDate === log.date ? `${log.exchangeRateDate} 湲곗�` : `${log.date} �붿껌 쨌 ${log.exchangeRateDate} 湲곗�`)
            : '湲곗��� 誘명솗��';
        const sourceText = log.exchangeRateSource === 'legacy-confirmed' ? '湲곗〈 ���κ컪' : (log.exchangeRateSource || '�섎룞 �낅젰');
        const rateText = log.currency === 'USD' && core.isPositiveNumber(rateValue)
            ? `<br><small style="color: var(--text-secondary); font-size: 0.75rem;">�섏쑉 ��${rateValue.toFixed(2)} 쨌 ${rateBasis} 쨌 ${sourceText}</small>`
            : '';
        const grossKRW = core.getDividendKRW(log, 'gross');
        const netKRW = core.getDividendKRW(log, 'net');
        
        // CSS Row Class
        const rowClass = `row-account-${accType.toLowerCase()}`;
        
        const tr = document.createElement('tr');
        tr.className = rowClass;
        tr.innerHTML = `
            <td>${log.date}</td>
            <td><span class="account-badge">${accName}</span></td>
            <td><strong>${stockName}</strong> <span class="ticker-badge">${ticker}</span></td>
            <td>${formatCurrency(log.amount, log.currency)}</td>
            <td>
                ${grossKRW === null ? '��' : formatCurrency(grossKRW, 'KRW')}
                ${rateText}
            </td>
            <td>${formatCurrency(log.tax, log.currency)}</td>
            <td>${netKRW === null ? '��' : formatCurrency(netKRW, 'KRW')}</td>
            <td>
                <div class="action-btns">
                    <button class="btn-table-icon" onclick="openEditDividend('${log.id}')">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button class="btn-table-icon delete" onclick="deleteDividendLog('${log.id}')">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Reinitialize Lucide Icons for dynamic content
    lucide.createIcons();
}

// Visualization Charts
function renderCharts() {
    if (state.dividendLogs.length === 0 && state.portfolio.length === 0) {
        return;
    }
    
    const isDark = document.body.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    renderMonthlyDividendChart(textColor, gridColor);
    renderPortfolioAllocationChart();
    renderCumulativeChart(textColor, gridColor);
    renderDividendGrowthSection();
    
    // Auto-run trend forecasting on dashboard load
    runTrendForecasting();
}

// Month sorting key helper YYYY-MM
function getMonthKey(dateStr) {
    const match = String(dateStr || '').match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}` : 'Unknown';
}

function renderMonthlyDividendChart(textColor, gridColor) {
    const ctx = document.getElementById('monthlyDividendChart');
    if (!ctx) return;
    
    // Clean up
    if (monthlyChart) {
        monthlyChart.destroy();
    }

    // Group logs by YYYY-MM and Account
    const monthsSet = new Set();
    const accountsMap = {}; // accId -> { accName, monthlyData: { "YYYY-MM": amountInActiveCurrency } }
    
    // Initialize months in sorted order
    state.dividendLogs.forEach(log => {
        const key = getMonthKey(log.date);
        if (key !== 'Unknown') monthsSet.add(key);
    });
    
    const sortedMonths = Array.from(monthsSet).sort();

    // Fill account monthly values
    state.dividendLogs.forEach(log => {
        const key = getMonthKey(log.date);
        if (key === 'Unknown') return;

        const isEtc = log.portfolioId && log.portfolioId.startsWith('etc-');
        let accountId = 'unknown-acc';
        if (isEtc) {
            accountId = log.portfolioId.replace('etc-', '');
        } else {
            const stock = state.portfolio.find(p => p.id === log.portfolioId);
            accountId = stock ? stock.accountId : 'unknown-acc';
        }
        const account = state.accounts.find(a => a.id === accountId);
        const accountName = account ? account.name : '湲고�/吏곸젒�낅젰';

        if (!accountsMap[accountId]) {
            accountsMap[accountId] = {
                name: accountName,
                data: {}
            };
            sortedMonths.forEach(m => accountsMap[accountId].data[m] = 0);
        }

        const amtActive = getDividendRecordValue(log, 'gross') || 0;
        accountsMap[accountId].data[key] += amtActive;
    });

    // Create datasets
    const colors = [
        '#6366f1', // Indigo
        '#a855f7', // Violet
        '#10b981', // Emerald
        '#f59e0b', // Amber
        '#ef4444', // Red
        '#06b6d4', // Cyan
    ];

    let colorIdx = 0;
    const datasets = Object.keys(accountsMap).map(accId => {
        const item = accountsMap[accId];
        const dataArr = sortedMonths.map(m => item.data[m]);
        const color = colors[colorIdx % colors.length];
        colorIdx++;
        
        return {
            label: item.name,
            data: dataArr,
            backgroundColor: color,
            borderRadius: 6,
            borderSkipped: false
        };
    });

    monthlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedMonths.map(m => {
                const parts = m.split('-');
                return `${parts[0]}�� ${parseInt(parts[1])}��`;
            }),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: { color: textColor }
                },
                y: {
                    stacked: true,
                    grace: '10%',
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        callback: function(value) {
                            return state.activeCurrency === 'USD' 
                                ? '$' + value 
                                : (value >= 10000 ? (value / 10000) + '留�' : value);
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: textColor, boxWidth: 12, font: { family: 'Outfit' } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            label += formatCurrency(context.parsed.y);
                            return label;
                        }
                    }
                }
            }
        },
        plugins: [{
            id: 'stackLabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                ctx.save();
                ctx.font = 'bold 10px Outfit, sans-serif';
                const isDark = document.body.getAttribute('data-theme') !== 'light';
                ctx.fillStyle = isDark ? '#cbd5e1' : '#475569';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';

                const datasets = chart.data.datasets;
                const labels = chart.data.labels;
                
                labels.forEach((label, i) => {
                    let total = 0;
                    let topY = null;
                    let barX = null;
                    
                    for (let j = datasets.length - 1; j >= 0; j--) {
                        const meta = chart.getDatasetMeta(j);
                        if (!meta.hidden && meta.data[i]) {
                            const bar = meta.data[i];
                            if (barX === null) {
                                barX = bar.x;
                                topY = bar.y;
                            }
                            total += datasets[j].data[i] || 0;
                        }
                    }

                    if (total > 0 && barX !== null && topY !== null) {
                        const formattedTotal = formatCurrency(total);
                        ctx.fillText(formattedTotal, barX, topY - 5);
                    }
                });
                ctx.restore();
            }
        }]
    });
}

function renderPortfolioAllocationChart() {
    const ctx = document.getElementById('portfolioAllocationChart');
    if (!ctx) return;
    
    if (allocationChart) {
        allocationChart.destroy();
    }

    if (state.portfolio.length === 0) return;

    // Group assets by Stock
    const labels = [];
    const values = [];
    const backgroundColors = [
        '#6366f1', '#a855f7', '#10b981', '#f59e0b', '#ef4444', 
        '#06b6d4', '#14b8a6', '#f43f5e', '#3b82f6', '#84cc16'
    ];

    const stockGroup = {};
    state.portfolio.forEach(stock => {
        const valActive = getValInActiveCurrency(stock.shares * getStockCurrentPrice(stock), stock.currency);
        if (!stockGroup[stock.name]) {
            stockGroup[stock.name] = 0;
        }
        stockGroup[stock.name] += valActive;
    });

    Object.keys(stockGroup).forEach(name => {
        labels.push(name);
        values.push(stockGroup[name]);
    });

    allocationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: backgroundColors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: 'transparent'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: document.body.getAttribute('data-theme') === 'light' ? '#475569' : '#94a3b8',
                        boxWidth: 10,
                        font: { size: 11, family: 'Outfit' }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percent = ((val / total) * 100).toFixed(1);
                            return ` ${context.label}: ${formatCurrency(val)} (${percent}%)`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

function renderCumulativeChart(textColor, gridColor) {
    const ctx = document.getElementById('cumulativeDividendChart');
    if (!ctx) return;
    
    if (cumulativeChart) {
        cumulativeChart.destroy();
    }

    if (state.dividendLogs.length === 0) return;

    // Sort logs by date (should be already sorted, but to make sure)
    const sortedLogs = [...state.dividendLogs].sort((a,b) => new Date(a.date) - new Date(b.date));
    
    const dates = [];
    const values = [];
    let cumulativeSum = 0;

    sortedLogs.forEach(log => {
        dates.push(log.date);
        cumulativeSum += getDividendRecordValue(log, 'gross') || 0;
        values.push(cumulativeSum);
    });

    cumulativeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: '�꾩쟻 �몄쟾 諛곕떦湲� (湲곕줉 �섏쑉)',
                data: values,
                borderColor: '#a855f7',
                borderWidth: 3,
                fill: true,
                backgroundColor: 'rgba(168, 85, 247, 0.08)',
                tension: 0.3,
                pointRadius: 4,
                pointBackgroundColor: '#a855f7'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: textColor, maxTicksLimit: 8 }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        callback: function(value) {
                            return state.activeCurrency === 'USD' 
                                ? '$' + value 
                                : (value >= 10000 ? (value / 10000) + '留�' : value);
                        }
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` �꾩쟻 �몄쟾 諛곕떦湲�: ${formatCurrency(context.parsed.y)}`;
                        }
                    }
                }
            }
        }
    });
}

// =========================================================================
// Share History Modal & Reinvestment Analysis Implementation
// =========================================================================

// Active stock ID for managing share history
let activeShareHistoryPortfolioId = null;

// Modal & History List Management
function openShareHistoryModal(portfolioId) {
    activeShareHistoryPortfolioId = portfolioId;
    const stock = state.portfolio.find(p => p.id === portfolioId);
    if (!stock) return;

    // Set stock name
    document.getElementById('shareHistoryStockName').textContent = `${stock.name} (${stock.ticker})`;
    
    // Reset form inputs
    document.getElementById('historyDate').value = core.localDateString();
    document.getElementById('historyShares').value = '';
    
    // Render list
    renderShareHistoryList(portfolioId);
    
    // Open modal
    openModal('modalShareHistory');
}

function renderShareHistoryList(portfolioId) {
    const tbody = document.getElementById('shareHistoryTableBody');
    tbody.innerHTML = '';
    
    // Filter history for this stock
    const history = state.shareHistory.filter(sh => sh.portfolioId === portfolioId);
    
    if (history.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 1rem;">
                    湲곕줉�� �섎웾 蹂��� �대젰�� �놁뒿�덈떎.
                </td>
            </tr>
        `;
        return;
    }
    
    // Sort history by date descending (newest first)
    const sortedHistory = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    sortedHistory.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 0.5rem; text-align: left;">${item.date}</td>
            <td style="padding: 0.5rem; text-align: left;">${item.shares.toLocaleString()} 二�</td>
            <td style="text-align: center; padding: 0.5rem;">
                <button class="btn-table-icon delete" onclick="deleteShareHistoryEntry('${item.id}')">
                    <i data-lucide="trash-2"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    lucide.createIcons();
}

function handleShareHistorySubmit(e) {
    e.preventDefault();
    if (!activeShareHistoryPortfolioId) return;
    
    const dateVal = document.getElementById('historyDate').value;
    const sharesVal = parseFloat(document.getElementById('historyShares').value);
    
    if (!dateVal || isNaN(sharesVal) || sharesVal <= 0) {
        showToast("�щ컮瑜� �좎쭨�� �섎웾�� �낅젰�� 二쇱꽭��.", "warning");
        return;
    }
    
    // Check if there is already an entry for this exact date
    const existing = state.shareHistory.find(sh => sh.portfolioId === activeShareHistoryPortfolioId && sh.date === dateVal);
    if (existing) {
        if (confirm("�대떦 �좎쭨�� �대� �섎웾 湲곕줉�� 議댁옱�⑸땲��. 媛믪쓣 �섏젙�섏떆寃좎뒿�덇퉴?")) {
            existing.shares = sharesVal;
        } else {
            return;
        }
    } else {
        const newEntry = {
            id: 'sh-' + Date.now(),
            portfolioId: activeShareHistoryPortfolioId,
            date: dateVal,
            shares: sharesVal
        };
        state.shareHistory.push(newEntry);
    }
    
    // Sync current portfolio stock shares to latest chronological history record
    syncPortfolioSharesFromHistory(activeShareHistoryPortfolioId);
    
    saveState();
    renderAll();
    renderShareHistoryList(activeShareHistoryPortfolioId);
    
    // Reset form inputs except date
    document.getElementById('historyShares').value = '';
    showToast("�섎웾 蹂��� �대젰�� 異붽�/�섏젙�섏뿀�듬땲��.", "success");
}

function deleteShareHistoryEntry(id) {
    const entry = state.shareHistory.find(sh => sh.id === id);
    if (!entry) return;
    
    const portfolioId = entry.portfolioId;
    const stockHistory = state.shareHistory.filter(sh => sh.portfolioId === portfolioId);
    
    if (stockHistory.length <= 1) {
        showToast("理쒖냼 �섎굹�� 蹂댁쑀 �섎웾 �대젰�� 議댁옱�댁빞 �섎�濡� ��젣�� �� �놁뒿�덈떎.", "warning");
        return;
    }
    
    if (confirm("�� 蹂댁쑀 �섎웾 �대젰 湲곕줉�� ��젣�섏떆寃좎뒿�덇퉴?")) {
        state.shareHistory = state.shareHistory.filter(sh => sh.id !== id);
        
        // Sync shares
        syncPortfolioSharesFromHistory(portfolioId);
        
        saveState();
        renderAll();
        renderShareHistoryList(portfolioId);
        showToast("�섎웾 �대젰 湲곕줉�� ��젣�섏뿀�듬땲��.", "success");
    }
}

function syncPortfolioSharesFromHistory(portfolioId) {
    const stock = state.portfolio.find(p => p.id === portfolioId);
    if (!stock) return;
    
    const stockHistory = state.shareHistory.filter(sh => sh.portfolioId === portfolioId);
    if (stockHistory.length > 0) {
        stockHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
        stock.shares = stockHistory[stockHistory.length - 1].shares;
    }
}

// Reinvestment Tab Functions
function populateReinvestStockSelect() {
    const select = document.getElementById('reinvestStockSelect');
    if (!select) return;
    
    const selectedId = select.value;
    select.innerHTML = '<option value="">-- 醫낅ぉ �좏깮 --</option>';
    
    state.portfolio.forEach(p => {
        const acc = state.accounts.find(a => a.id === p.accountId);
        const accName = acc ? acc.name : '誘몄��� 怨꾩쥖';
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = `[${accName}] ${p.name} (${p.ticker})`;
        if (p.id === selectedId) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function handleReinvestStockChange() {
    renderReinvestmentTab();
}

let reinvestChartInstance = null;

function renderReinvestmentTab() {
    // Render SCHD Integrated Analysis at the bottom
    renderSchdAnalysis();

    const select = document.getElementById('reinvestStockSelect');
    const emptyState = document.getElementById('reinvestEmptyState');
    const kpiGrid = document.getElementById('reinvestKpiGrid');
    const content = document.getElementById('reinvestAnalysisContent');
    const tbody = document.getElementById('reinvestTableBody');
    
    if (!select) return;
    
    const stockId = select.value;
    if (!stockId) {
        // Show empty state, hide others
        emptyState.style.display = 'block';
        kpiGrid.style.display = 'none';
        content.style.display = 'none';
        
        if (reinvestChartInstance) {
            reinvestChartInstance.destroy();
            reinvestChartInstance = null;
        }
        return;
    }
    
    // Show analysis, hide empty state
    emptyState.style.display = 'none';
    kpiGrid.style.display = 'grid';
    content.style.display = 'flex';
    
    const stock = state.portfolio.find(p => p.id === stockId);
    if (!stock) return;
    
    // GATHER TIMELINE MONTHS
    const monthsSet = new Set();
    
    // Share history months
    const stockHistory = state.shareHistory.filter(sh => sh.portfolioId === stockId);
    stockHistory.forEach(sh => {
        const parts = sh.date.split('-');
        if (parts.length >= 2) monthsSet.add(`${parts[0]}-${parts[1]}`);
    });
    
    // Dividend logs months
    const stockLogs = state.dividendLogs.filter(log => log.portfolioId === stockId);
    stockLogs.forEach(log => {
        const parts = log.date.split('-');
        if (parts.length >= 2) monthsSet.add(`${parts[0]}-${parts[1]}`);
    });
    
    const sortedMonths = Array.from(monthsSet).sort();
    
    // Calculate values for each month
    const timelineData = [];
    let lastPayoutDPS = 0;
    
    sortedMonths.forEach(monthStr => {
        const parts = monthStr.split('-');
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);
        
        // End of this month date object
        const endOfMonth = new Date(year, month, 0, 23, 59, 59);
        
        // 1. Shares held at end of this month
        const sharesHeld = getSharesAtDate(stockId, endOfMonth);
        
        // 2. Dividend received in this month
        const monthLogs = stockLogs.filter(log => {
            const logParts = log.date.split('-');
            return logParts.length >= 2 && `${logParts[0]}-${logParts[1]}` === monthStr;
        });
        
        let monthlyDivVal = 0;
        let monthlyDivValKRW = 0;
        monthLogs.forEach(log => {
            monthlyDivVal += log.amount;
            monthlyDivValKRW += log.amountKRW;
        });
        
        // 3. DPS (Dividend per Share) in this month
        const dps = sharesHeld > 0 ? monthlyDivVal / sharesHeld : 0;
        
        // 4. Yield in this month
        const cost = sharesHeld * stock.avgPrice;
        const monthlyYield = cost > 0 ? (monthlyDivVal / cost) * 100 : 0;
        
        // 5. Growth rate
        let growthRateText = '-';
        if (monthlyDivVal > 0) {
            if (lastPayoutDPS > 0) {
                const growthVal = ((dps - lastPayoutDPS) / lastPayoutDPS) * 100;
                growthRateText = (growthVal >= 0 ? '+' : '') + growthVal.toFixed(1) + '%';
            }
            lastPayoutDPS = dps;
        }
        
        timelineData.push({
            month: monthStr,
            shares: sharesHeld,
            dividend: monthlyDivVal,
            dividendKRW: monthlyDivValKRW,
            dps: dps,
            yield: monthlyYield,
            growth: growthRateText
        });
    });
    
    // UPDATE KPIS
    document.getElementById('reinvestKpiShares').textContent = `${stock.shares.toLocaleString()}二�`;
    document.getElementById('reinvestKpiAvgPrice').textContent = formatCurrency(stock.avgPrice, stock.currency);
    
    // Total received dividend for this stock
    let totalStockReceived = 0;
    stockLogs.forEach(log => {
        totalStockReceived += getValInActiveCurrency(log.amount, log.currency);
    });
    document.getElementById('reinvestKpiTotalReceived').textContent = formatCurrency(totalStockReceived);
    
    // Average DPS growth rate
    let growthSum = 0;
    let growthCount = 0;
    let prevDPS = 0;
    timelineData.forEach(d => {
        if (d.dividend > 0) {
            if (prevDPS > 0) {
                const growth = ((d.dps - prevDPS) / prevDPS) * 100;
                growthSum += growth;
                growthCount++;
            }
            prevDPS = d.dps;
        }
    });
    const avgGrowth = growthCount > 0 ? growthSum / growthCount : 0;
    document.getElementById('reinvestKpiGrowthRate').textContent = (avgGrowth >= 0 ? '+' : '') + avgGrowth.toFixed(1) + '%';
    
    // RENDER TABLE
    tbody.innerHTML = '';
    const tableData = [...timelineData].reverse();
    tableData.forEach(row => {
        const tr = document.createElement('tr');
        
        const displayDiv = formatCurrency(row.dividend, stock.currency);
        const displayDPS = formatCurrency(row.dps, stock.currency);
        const displayYield = row.yield > 0 ? row.yield.toFixed(2) + '%' : '-';
        
        const parts = row.month.split('-');
        const monthLabel = `${parts[0]}�� ${parseInt(parts[1])}��`;
        
        tr.innerHTML = `
            <td style="padding: 0.75rem 0.5rem;"><strong>${monthLabel}</strong></td>
            <td style="padding: 0.75rem 0.5rem;">${row.shares.toLocaleString()} 二�</td>
            <td style="padding: 0.75rem 0.5rem;">${displayDiv}</td>
            <td style="padding: 0.75rem 0.5rem;">${displayDPS}</td>
            <td style="padding: 0.75rem 0.5rem;"><span style="color: var(--primary); font-weight: 500;">${displayYield}</span></td>
            <td style="padding: 0.75rem 0.5rem;">
                <span class="kpi-trend ${row.growth.startsWith('-') ? 'negative' : (row.growth === '-' ? '' : 'positive')}">
                    ${row.growth}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    // RENDER CHART
    const ctx = document.getElementById('reinvestChart');
    if (!ctx) return;
    
    if (reinvestChartInstance) {
        reinvestChartInstance.destroy();
    }
    
    const isDark = document.body.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    
    const chartLabels = timelineData.map(d => {
        const parts = d.month.split('-');
        return `${parts[0]}�� ${parseInt(parts[1])}��`;
    });
    
    const dividendData = timelineData.map(d => d.dividend);
    const sharesData = timelineData.map(d => d.shares);
    
    reinvestChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [
                {
                    label: `�� 諛곕떦湲� (${stock.currency})`,
                    type: 'bar',
                    data: dividendData,
                    backgroundColor: 'rgba(99, 102, 241, 0.65)',
                    borderColor: '#6366f1',
                    borderWidth: 1,
                    borderRadius: 4,
                    yAxisID: 'y'
                },
                {
                    label: '蹂댁쑀 二쇱떇 �� (二�)',
                    type: 'line',
                    data: sharesData,
                    borderColor: '#a855f7',
                    borderWidth: 3,
                    pointBackgroundColor: '#a855f7',
                    pointRadius: 4,
                    tension: 0.25,
                    fill: false,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: textColor }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        callback: function(value) {
                            return stock.currency === 'USD' ? '$' + value : value.toLocaleString() + '��';
                        }
                    },
                    title: {
                        display: true,
                        text: `諛곕떦湲� (${stock.currency})`,
                        color: textColor,
                        font: { size: 11, weight: 'bold' }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: {
                        color: textColor,
                        callback: function(value) {
                            return value.toLocaleString() + ' 二�';
                        }
                    },
                    title: {
                        display: true,
                        text: '蹂댁쑀 二쇱떇 �� (二�)',
                        color: textColor,
                        font: { size: 11, weight: 'bold' }
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: textColor, font: { family: 'Outfit' } }
                },
                tooltip: {
                    shared: true,
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.datasetIndex === 0) {
                                label += formatCurrency(context.parsed.y, stock.currency);
                            } else {
                                label += context.parsed.y.toLocaleString() + ' 二�';
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

function isSchdFamilyStock(stock) {
    if (!stock) return false;
    const ticker = (stock.ticker || '').toUpperCase();
    const name = (stock.name || '').toUpperCase();
    return ticker === 'SCHD' || 
           name.includes('SCHD') || 
           ((name.includes('誘멸뎅諛곕떦�ㅼ슦議댁뒪') || name.includes('誘멸뎅諛곕떦 �ㅼ슦議댁뒪')) &&
            (name.includes('SOL') || name.includes('TIGER') || name.includes('ACE') || name.includes('誘몃옒�먯뀑') || name.includes('�좏븳')));
}

let schdChartInstance = null;

function renderSchdAnalysis() {
    const schdStocks = state.portfolio.filter(isSchdFamilyStock);
    
    const totalInvestedEl = document.getElementById('schdKpiTotalInvested');
    const sharesListEl = document.getElementById('schdKpiSharesList');
    const expectedDivEl = document.getElementById('schdKpiExpectedDiv');
    const avgYieldEl = document.getElementById('schdKpiAvgYield');
    const tbody = document.getElementById('schdTableBody');
    
    if (!totalInvestedEl) return;
    
    if (schdStocks.length === 0) {
        totalInvestedEl.textContent = '-';
        sharesListEl.textContent = '蹂댁쑀 以묒씤 SCHD 愿��� 醫낅ぉ�� �놁뒿�덈떎.';
        expectedDivEl.textContent = '-';
        avgYieldEl.textContent = '0.0%';
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 2rem;">蹂댁쑀 以묒씤 SCHD援� 醫낅ぉ�� �놁뒿�덈떎.</td></tr>';
        
        if (schdChartInstance) {
            schdChartInstance.destroy();
            schdChartInstance = null;
        }
        return;
    }
    
    // 1. Calculate KPI Metrics
    let totalInvested = 0;
    let totalExpectedAnnualDiv = 0;
    let sharesListTexts = [];
    
    const today = new Date();
    const startOfCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    let thisMonthInvested = 0;
    let thisMonthSharesTexts = [];
    
    schdStocks.forEach(s => {
        const cost = s.shares * s.avgPrice;
        const costActive = getValInActiveCurrency(cost, s.currency);
        totalInvested += costActive;
        
        const div = s.shares * s.annualDividend;
        const divActive = getValInActiveCurrency(div, s.currency);
        totalExpectedAnnualDiv += divActive;
        
        sharesListTexts.push(`${s.name} (${s.ticker}): ${s.shares.toLocaleString()}二�`);
        
        const sharesAtStart = getSharesAtDate(s.id, startOfCurrentMonth);
        const newShares = Math.max(0, s.shares - sharesAtStart);
        if (newShares > 0) {
            const buyCost = newShares * s.avgPrice;
            thisMonthInvested += getValInActiveCurrency(buyCost, s.currency);
            thisMonthSharesTexts.push(`${s.ticker} +${newShares.toLocaleString()}二�`);
        }
    });
    
    const avgYield = totalInvested > 0 ? (totalExpectedAnnualDiv / totalInvested) * 100 : 0;
    
    totalInvestedEl.innerHTML = formatCurrency(totalInvested) + 
        (thisMonthInvested > 0 
            ? `<div style="font-size: 0.75rem; font-weight: 500; margin-top: 0.15rem;" class="kpi-trend positive">�대쾲 �� +${formatCurrency(thisMonthInvested)}</div>` 
            : `<div style="font-size: 0.75rem; font-weight: 500; margin-top: 0.15rem; color: var(--text-secondary);">�대쾲 �� 異붽� 留ㅼ닔 �놁쓬</div>`);
            
    sharesListEl.innerHTML = sharesListTexts.join('\n') + 
        (thisMonthSharesTexts.length > 0 
            ? `<div style="font-size: 0.75rem; font-weight: 500; color: var(--primary); margin-top: 0.25rem;">(�대쾲 �� 異붽�: ${thisMonthSharesTexts.join(', ')})</div>` 
            : '');
            
    expectedDivEl.textContent = `${formatCurrency(totalExpectedAnnualDiv)} / �� (�뷀룊洹� ${formatCurrency(totalExpectedAnnualDiv / 12)})`;
    avgYieldEl.textContent = `${avgYield.toFixed(2)}% (留ㅼ닔 �먭툑 ��鍮�)`;
    
    // 2. Gather Monthly historical data
    const monthsSet = new Set();
    const schdStockIds = schdStocks.map(s => s.id);
    
    const schdLogs = state.dividendLogs.filter(log => schdStockIds.includes(log.portfolioId));
    schdLogs.forEach(log => {
        const parts = log.date.split('-');
        if (parts.length >= 2) monthsSet.add(`${parts[0]}-${parts[1]}`);
    });
    
    state.shareHistory.filter(sh => schdStockIds.includes(sh.portfolioId)).forEach(sh => {
        const parts = sh.date.split('-');
        if (parts.length >= 2) monthsSet.add(`${parts[0]}-${parts[1]}`);
    });
    
    const sortedMonths = Array.from(monthsSet).sort();
    const monthlyBreakdown = [];
    
    sortedMonths.forEach(monthStr => {
        const parts = monthStr.split('-');
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);
        const endOfMonth = new Date(year, month, 0, 23, 59, 59);
        
        let monthlyReceived = 0;
        schdLogs.forEach(log => {
            const logDate = new Date(log.date);
            if (logDate.getFullYear() === year && (logDate.getMonth() + 1) === month) {
                monthlyReceived += getValInActiveCurrency(log.amount, log.currency);
            }
        });
        
        let monthlyInvested = 0;
        schdStocks.forEach(s => {
            const sharesHeld = getSharesAtDate(s.id, endOfMonth);
            monthlyInvested += getValInActiveCurrency(sharesHeld * s.avgPrice, s.currency);
        });
        
        const monthlyYield = monthlyInvested > 0 ? (monthlyReceived / monthlyInvested) * 100 : 0;
        
        if (monthlyReceived > 0 || monthlyInvested > 0) {
            monthlyBreakdown.push({
                monthStr,
                received: monthlyReceived,
                invested: monthlyInvested,
                yield: monthlyYield
            });
        }
    });
    
    const tableData = [...monthlyBreakdown].reverse();
    tbody.innerHTML = '';
    
    if (tableData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 1.5rem;">諛곕떦湲� 吏�湲� 湲곕줉�� �놁뒿�덈떎.</td></tr>';
    } else {
        tableData.forEach(item => {
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid var(--border-color)';
            row.innerHTML = `
                <td style="padding: 0.5rem 0;">${item.monthStr}</td>
                <td style="padding: 0.5rem 0; text-align: right; font-weight: 600; color: var(--text-primary);">${formatCurrency(item.received)}</td>
                <td style="padding: 0.5rem 0; text-align: right; color: var(--primary); font-weight: 500;">${item.yield > 0 ? item.yield.toFixed(2) + '%' : '-'}</td>
            `;
            tbody.appendChild(row);
        });
    }
    
    // 3. Render Chart
    const ctx = document.getElementById('schdChart');
    if (!ctx) return;
    if (schdChartInstance) {
        schdChartInstance.destroy();
    }
    
    if (monthlyBreakdown.length === 0) return;
    
    const isDark = document.body.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    
    const labels = monthlyBreakdown.map(x => x.monthStr);
    const receivedData = monthlyBreakdown.map(x => x.received);
    const yieldData = monthlyBreakdown.map(x => x.yield);
    
    schdChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '�섎졊 諛곕떦湲�',
                    data: receivedData,
                    backgroundColor: 'rgba(99, 102, 241, 0.75)',
                    borderColor: '#6366f1',
                    borderWidth: 1,
                    borderRadius: 4,
                    yAxisID: 'y'
                },
                {
                    label: '諛곕떦�섏씡瑜� (%)',
                    data: yieldData,
                    type: 'line',
                    borderColor: '#34d399',
                    borderWidth: 2,
                    pointBackgroundColor: '#34d399',
                    pointRadius: 3,
                    fill: false,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: textColor, font: { size: 10 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.datasetIndex === 0) {
                                label += formatCurrency(context.parsed.y);
                            } else {
                                label += context.parsed.y.toFixed(2) + '%';
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: textColor, font: { size: 9 } }
                },
                y: {
                    position: 'left',
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        font: { size: 9 },
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    },
                    title: {
                        display: true,
                        text: '�섎졊 諛곕떦湲�',
                        color: textColor,
                        font: { size: 10, weight: 'bold' }
                    }
                },
                y1: {
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: {
                        color: textColor,
                        font: { size: 9 },
                        callback: function(value) {
                            return value.toFixed(1) + '%';
                        }
                    },
                    title: {
                        display: true,
                        text: '諛곕떦�섏씡瑜� (%)',
                        color: textColor,
                        font: { size: 10, weight: 'bold' }
                    }
                }
            }
        },
        plugins: [{
            id: 'customDataLabels',
            afterDatasetsDraw: (chart) => {
                const ctx = chart.ctx;
                ctx.save();
                ctx.font = 'bold 8px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                
                chart.data.datasets.forEach((dataset, datasetIndex) => {
                    if (datasetIndex !== 0) return;
                    const meta = chart.getDatasetMeta(datasetIndex);
                    meta.data.forEach((element, index) => {
                        const value = dataset.data[index];
                        if (value > 0) {
                            const formatted = formatCurrency(value);
                            ctx.fillStyle = isDark ? '#e2e8f0' : '#1e293b';
                            ctx.fillText(formatted, element.x, element.y - 4);
                        }
                    });
                });
                ctx.restore();
            }
        }]
    });
}

function getSharesAtDate(portfolioId, dateObj) {
    const history = state.shareHistory.filter(sh => sh.portfolioId === portfolioId);
    if (history.length === 0) {
        const stock = state.portfolio.find(p => p.id === portfolioId);
        return stock ? stock.shares : 0;
    }
    const validEntries = history.filter(sh => new Date(sh.date) <= dateObj);
    if (validEntries.length === 0) {
        history.sort((a, b) => new Date(a.date) - new Date(b.date));
        return history[0].shares;
    }
    validEntries.sort((a, b) => new Date(a.date) - new Date(b.date));
    return validEntries[validEntries.length - 1].shares;
}

function renderDividendGrowthSection() {
    // 1. Calculate Recent 3-Month Average Dividend
    const today = new Date();
    const getMonthKeyDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m0 = getMonthKeyDate(today);
    const m1 = getMonthKeyDate(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    const m2 = getMonthKeyDate(new Date(today.getFullYear(), today.getMonth() - 2, 1));
    
    let sumReceivedVal = 0;
    state.dividendLogs.forEach(log => {
        const dateParts = log.date.split('-');
        if (dateParts.length >= 2) {
            const key = `${dateParts[0]}-${dateParts[1]}`;
            if (key === m0 || key === m1 || key === m2) {
                sumReceivedVal += getValInActiveCurrency(log.amount, log.currency);
            }
        }
    });
    
    const avgMonthly = sumReceivedVal / 3;
    const annualizedAvg = avgMonthly * 12;
    
    // Calculate total market value (same as KPI)
    let totalMarketValue = 0;
    state.portfolio.forEach(stock => {
        const marketVal = stock.shares * getStockCurrentPrice(stock);
        totalMarketValue += getValInActiveCurrency(marketVal, stock.currency);
    });
    
    const yieldRate = totalMarketValue > 0 ? (annualizedAvg / totalMarketValue) * 100 : 0;
    
    document.getElementById('dbRecent3MAmount').textContent = formatCurrency(avgMonthly);
    document.getElementById('dbRecent3MYield').textContent = yieldRate.toFixed(2) + '%';
    
    // 2. Populate Stock Selector for Growth Rate
    const select = document.getElementById('dbDivGrowthStockSelect');
    if (select) {
        const loggedStockIds = [...new Set(state.dividendLogs.map(log => log.portfolioId))];
        const prevValue = select.value;
        
        select.innerHTML = '<option value="">醫낅ぉ �좏깮</option>';
        loggedStockIds.forEach(id => {
            if (id.startsWith('etc-')) {
                const accId = id.replace('etc-', '');
                const acc = state.accounts.find(a => a.id === accId);
                const accName = acc ? acc.name : '湲고�';
                const option = document.createElement('option');
                option.value = id;
                option.textContent = `[${accName}] 湲고� (ETC)`;
                select.appendChild(option);
                return;
            }
            
            const stock = state.portfolio.find(p => p.id === id);
            if (stock) {
                const acc = state.accounts.find(a => a.id === stock.accountId);
                const accName = acc ? acc.name : '誘몄��� 怨꾩쥖';
                const option = document.createElement('option');
                option.value = id;
                option.textContent = `[${accName}] ${stock.name}`;
                select.appendChild(option);
            }
        });
        
        if (prevValue && Array.from(select.options).some(opt => opt.value === prevValue)) {
            select.value = prevValue;
        } else if (select.options.length > 1) {
            select.value = select.options[1].value;
        }
    }
    
    // 3. Populate Stock Selector for Simulator (only real stocks from portfolio)
    const simSelect = document.getElementById('simTargetStock');
    if (simSelect) {
        const prevSimValue = simSelect.value;
        simSelect.innerHTML = '';
        
        state.portfolio.forEach(stock => {
            const acc = state.accounts.find(a => a.id === stock.accountId);
            const accName = acc ? acc.name : '誘몄��� 怨꾩쥖';
            const option = document.createElement('option');
            option.value = stock.id;
            option.textContent = `[${accName}] ${stock.name} (${stock.ticker})`;
            simSelect.appendChild(option);
        });
        
        if (prevSimValue && Array.from(simSelect.options).some(opt => opt.value === prevSimValue)) {
            simSelect.value = prevSimValue;
        }
    }
    
    updateDividendGrowthAnalysis();
}

function updateDividendGrowthAnalysis() {
    const select = document.getElementById('dbDivGrowthStockSelect');
    if (!select) return;
    
    const stockId = select.value;
    const periodEl = document.getElementById('dbDivGrowthPeriod');
    const startDpsEl = document.getElementById('dbDivGrowthStartDps');
    const endDpsEl = document.getElementById('dbDivGrowthEndDps');
    const rateEl = document.getElementById('dbDivGrowthRate');
    
    if (!stockId) {
        periodEl.textContent = '-';
        startDpsEl.textContent = '-';
        endDpsEl.textContent = '-';
        rateEl.textContent = '-';
        rateEl.className = 'kpi-trend';
        return;
    }
    
    const rawLogs = state.dividendLogs.filter(log => log.portfolioId === stockId);
    
    const dpsData = rawLogs.map(log => {
        const logDate = new Date(log.date);
        const shares = getSharesAtDate(stockId, logDate) || 1;
        const dps = log.amount / shares;
        return {
            date: logDate,
            dateStr: log.date,
            dps: dps,
            currency: log.currency
        };
    }).filter(item => item.dps > 0)
      .sort((a, b) => a.date - b.date);
        
    if (dpsData.length === 0) {
        periodEl.textContent = '-';
        startDpsEl.textContent = '湲곕줉 �놁쓬';
        endDpsEl.textContent = '湲곕줉 �놁쓬';
        rateEl.textContent = '-';
        rateEl.className = 'kpi-trend';
        return;
    }
    
    if (dpsData.length === 1) {
        periodEl.textContent = '1�� 吏�湲됰맖';
        const item = dpsData[0];
        startDpsEl.textContent = formatCurrency(item.dps, item.currency);
        endDpsEl.textContent = formatCurrency(item.dps, item.currency);
        rateEl.textContent = '異붿꽭 遺꾩꽍 遺덇� (理쒖냼 2�� �꾩슂)';
        rateEl.className = 'kpi-trend';
        return;
    }
    
    const firstItem = dpsData[0];
    const lastItem = dpsData[dpsData.length - 1];
    const firstDate = firstItem.date;
    const lastDate = lastItem.date;
    
    const daysDiff = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
    const totalYears = daysDiff / 365.25;
    const currency = firstItem.currency;
    
    const formatDate = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    periodEl.textContent = `${formatDate(firstDate)} ~ ${formatDate(lastDate)} (${Math.round(daysDiff)}��)`;
    
    // Log-Linear Regression (OLS)
    // ln(DPS) = alpha + beta * t
    const N = dpsData.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    
    dpsData.forEach(item => {
        const x = (item.date - firstDate) / (1000 * 60 * 60 * 24 * 365.25);
        const y = Math.log(item.dps);
        
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    });
    
    const denominator = N * sumXX - sumX * sumX;
    let beta = 0;
    let alpha = sumY / N;
    
    if (denominator !== 0) {
        beta = (N * sumXY - sumX * sumY) / denominator;
        alpha = (sumY - beta * sumX) / N;
    }
    
    const dpsStartEst = Math.exp(alpha);
    const dpsEndEst = Math.exp(alpha + beta * totalYears);
    
    startDpsEl.textContent = `${formatCurrency(dpsStartEst, currency)} (異붿꽭��)`;
    endDpsEl.textContent = `${formatCurrency(dpsEndEst, currency)} (異붿꽭��)`;
    
    const totalGrowth = dpsStartEst > 0 ? ((dpsEndEst - dpsStartEst) / dpsStartEst) * 100 : 0;
    const cagr = (Math.exp(beta) - 1) * 100;
    
    const sign = totalGrowth >= 0 ? '+' : '';
    const cagrSign = cagr >= 0 ? '+' : '';
    const plClass = totalGrowth >= 0 ? 'positive' : 'negative';
    
    if (daysDiff < 90) {
        rateEl.textContent = `${sign}${totalGrowth.toFixed(2)}% (�④린 異붿꽭 �깆옣瑜�)`;
    } else {
        rateEl.textContent = `${sign}${totalGrowth.toFixed(1)}% (�고룊洹� CAGR: ${cagrSign}${cagr.toFixed(2)}%)`;
    }
    rateEl.className = `kpi-trend ${plClass}`;
}

let simChartObj = null;

function getValInStockCurrency(amountInActiveCurrency, stockCurrency) {
    const activeCurrency = state.activeCurrency || 'KRW';
    if (activeCurrency === stockCurrency) return amountInActiveCurrency;
    
    if (activeCurrency === 'KRW' && stockCurrency === 'USD') {
        return core.isPositiveNumber(state.currentExchangeRate) ? amountInActiveCurrency / state.currentExchangeRate : null;
    } else {
        return core.isPositiveNumber(state.currentExchangeRate) ? amountInActiveCurrency * state.currentExchangeRate : null;
    }
}

function getStockGrowthRate(stockId) {
    const rawLogs = state.dividendLogs.filter(log => log.portfolioId === stockId);
    const dpsData = rawLogs.map(log => {
        const logDate = new Date(log.date);
        const shares = getSharesAtDate(stockId, logDate) || 1;
        const dps = log.amount / shares;
        return { date: logDate, dps: dps };
    }).filter(item => item.dps > 0).sort((a, b) => a.date - b.date);

    if (dpsData.length < 2) return 0.04; // default to 4% if not enough history
    
    const firstDate = dpsData[0].date;
    const lastDate = dpsData[dpsData.length - 1].date;
    const daysDiff = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
    if (daysDiff < 90) return 0.04;

    const N = dpsData.length;
    let sumX = 0; let sumY = 0; let sumXY = 0; let sumXX = 0;
    dpsData.forEach(item => {
        const x = (item.date - firstDate) / (1000 * 60 * 60 * 24 * 365.25);
        const y = Math.log(item.dps);
        sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    });
    const denominator = N * sumXX - sumX * sumX;
    if (denominator === 0) return 0.04;
    const beta = (N * sumXY - sumX * sumY) / denominator;
    
    const cagr = Math.exp(beta) - 1;
    return Math.max(-0.10, Math.min(0.20, cagr)); // cap between -10% and 20%
}

function runTrendForecasting() {
    const trendIncrementEl = document.getElementById('fcTrendIncrement');
    const projCurrentEl = document.getElementById('fcProjCurrent');
    const proj1YrEl = document.getElementById('fcProj1Yr');
    const proj3YrEl = document.getElementById('fcProj3Yr');
    const proj5YrEl = document.getElementById('fcProj5Yr');
    const proj10YrEl = document.getElementById('fcProj10Yr');
    const tbody = document.getElementById('fcProj12MonthsTableBody');
    
    if (!projCurrentEl) return;
    
    const basis = document.getElementById('fcBasisSelect')?.value || 'actual';
    let divToday = 0;
    let delta = 0;
    
    if (basis === 'actual') {
        // Always use the previous calendar month relative to today as the base month (M0)
        // because the current calendar month is still in progress and has incomplete dividend records.
        const baseDate = new Date();
        baseDate.setMonth(baseDate.getMonth() - 1);

        // Calculate total dividends received in a given calendar month relative to the base month
        const getMonthlyTotalReceived = (monthsAgo) => {
            const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
            targetDate.setMonth(targetDate.getMonth() - monthsAgo);
            const targetYear = targetDate.getFullYear();
            const targetMonth = targetDate.getMonth() + 1; // 1-indexed
            
            let sum = 0;
            state.dividendLogs.forEach(log => {
                const logDate = new Date(log.date);
                if (logDate.getFullYear() === targetYear && (logDate.getMonth() + 1) === targetMonth) {
                    sum += getValInActiveCurrency(log.amount, log.currency);
                }
            });
            return sum;
        };
        
        const D0 = getMonthlyTotalReceived(0);
        const D1 = getMonthlyTotalReceived(1);
        const D2 = getMonthlyTotalReceived(2);
        const D3 = getMonthlyTotalReceived(3);
        
        divToday = (D0 + D1 + D2) / 3; // Base is average of the last 3 months
        delta = (D0 - D3) / 3; // Average monthly change over 3 months
        if (delta < 0) delta = 0; // clamp to 0 for growth forecasting
        
    } else {
        // 1. Calculate current expected monthly dividend (earning power)
        let totalExpectedAnnualDiv = 0;
        state.portfolio.forEach(stock => {
            const expectedDiv = stock.shares * stock.annualDividend;
            totalExpectedAnnualDiv += getValInActiveCurrency(expectedDiv, stock.currency);
        });
        divToday = totalExpectedAnnualDiv / 12;
        
        // 2. Calculate expected monthly dividend 3 months ago (based on share history)
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        
        let div3m = 0;
        state.portfolio.forEach(stock => {
            const shares3m = getSharesAtDate(stock.id, threeMonthsAgo);
            div3m += getValInActiveCurrency(shares3m * stock.annualDividend, stock.currency);
        });
        div3m = div3m / 12;
        
        // 3. Calculate average monthly increment (delta)
        delta = (divToday - div3m) / 3;
        if (delta < 0) delta = 0; // clamp to 0 for growth forecasting
    }
    
    // 4. Render Trend Increment
    trendIncrementEl.textContent = `+${formatCurrency(delta)} / ��`;
    
    // 5. Update labels dynamically depending on selected basis
    const labelEl = document.getElementById('fcTrendLabel');
    if (labelEl) {
        if (basis === 'actual') {
            labelEl.textContent = '理쒓렐 3媛쒖썡媛� 諛곕떦 �ㅼ닔�뱀븸 利앷�異붿꽭 (�뷀룊洹�)';
        } else {
            labelEl.textContent = '理쒓렐 3媛쒖썡媛� 諛곕떦 泥대젰(諛곕떦��) 利앷�異붿꽭 (�뷀룊洹�)';
        }
    }

    const descEl = document.querySelector('#fcTrendIncrement + p');
    if (descEl) {
        if (basis === 'actual') {
            descEl.textContent = '* 理쒓렐 3媛쒖썡媛� �ㅼ젣 �섎졊�� 珥� 諛곕떦湲덉쓽 �뷀룊洹� 利앷��⑥쓣 諛뷀깢�쇰줈 誘몃옒 諛곕떦 �꾧툑 �먮쫫�� �좏삎�쇰줈 �덉륫�⑸땲��. (吏�湲� 二쇨린�� �곕Ⅸ �붾퀎 蹂��숈꽦�� 諛섏쁺�� �� �덉뒿�덈떎.)';
        } else {
            descEl.textContent = '* 理쒓렐 3媛쒖썡 �숈븞 留ㅼ닔 �깆쓣 �듯빐 �ы듃�대━�ㅼ쓽 �붾같�� �앹꽦 �λ젰(諛곕떦��)�� 留ㅻ떖 �됯퇏�곸쑝濡� �쇰쭏�� 利앷��덈뒗吏�瑜� 諛뷀깢�쇰줈 �좏삎 �덉륫�⑸땲��.';
        }
    }
    
    // 6. Calculate projections
    const projCurrent = divToday;
    const proj1Yr = Math.max(0, divToday + delta * 12);
    const proj3Yr = Math.max(0, divToday + delta * 36);
    const proj5Yr = Math.max(0, divToday + delta * 60);
    const proj10Yr = Math.max(0, divToday + delta * 120);
    
    projCurrentEl.textContent = formatCurrency(projCurrent);
    proj1YrEl.textContent = formatCurrency(proj1Yr);
    proj3YrEl.textContent = formatCurrency(proj3Yr);
    proj5YrEl.textContent = formatCurrency(proj5Yr);
    proj10YrEl.textContent = formatCurrency(proj10Yr);
    
    // 7. Populate 12-month table
    tbody.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
        const projectedVal = Math.max(0, divToday + delta * m);
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid var(--border-color)';
        row.innerHTML = `
            <td style="padding: 0.4rem 0;">${m}媛쒖썡 ��</td>
            <td style="padding: 0.4rem 0; text-align: right; font-weight: 600; color: var(--primary);">${formatCurrency(projectedVal)}</td>
        `;
        tbody.appendChild(row);
    }
}

// ============================================================================
// AI �댁떆�ㅽ꽩�� 梨쀫큸 湲곕뒫 (Gemini API �곕룞)
// ============================================================================
function setupAIChat() {
    const btnOpen = document.getElementById('btnOpenAIChat');
    const btnClose = document.getElementById('btnCloseAIChat');
    const drawer = document.getElementById('aiChatDrawer');
    const btnConfig = document.getElementById('btnAIChatConfig');
    const overlay = document.getElementById('aiChatConfigOverlay');
    const btnCancelConfig = document.getElementById('btnCancelAIConfig');
    const btnSaveConfig = document.getElementById('btnSaveAIConfig');
    const inputKey = document.getElementById('aiApiKeyInput');
    const statusDot = document.getElementById('aiKeyStatusDot');
    const btnSend = document.getElementById('btnSendAIChat');
    const inputChat = document.getElementById('aiChatInput');
    const messagesContainer = document.getElementById('aiChatMessages');

    if (!btnOpen) return;

    // Load saved API Key
    const loadApiKey = () => {
        const key = localStorage.getItem('dividend_tracker_gemini_key') || '';
        inputKey.value = key;
        if (key) {
            statusDot.className = 'status-dot online';
            statusDot.title = 'API �ㅺ� �ㅼ젙�섏뿀�듬땲�� (�⑤씪��)';
        } else {
            statusDot.className = 'status-dot offline';
            statusDot.title = 'API �� 誘몄꽕�� (�ㅽ봽�쇱씤)';
        }
    };
    loadApiKey();

    // Toggle Chat Drawer
    btnOpen.addEventListener('click', () => {
        drawer.classList.add('open');
        btnOpen.style.display = 'none';
        // Auto scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });

    btnClose.addEventListener('click', () => {
        drawer.classList.remove('open');
        btnOpen.style.display = 'flex';
    });

    // Toggle API Key Config
    btnConfig.addEventListener('click', () => {
        overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
    });

    btnCancelConfig.addEventListener('click', () => {
        overlay.style.display = 'none';
    });

    btnSaveConfig.addEventListener('click', () => {
        const key = inputKey.value.trim();
        localStorage.setItem('dividend_tracker_gemini_key', key);
        loadApiKey();
        overlay.style.display = 'none';
        showToast('Gemini API Key媛� ���λ릺�덉뒿�덈떎.', 'success');
        
        appendMessage('system', 'API Key媛� �깃났�곸쑝濡� �낅뜲�댄듃�섏뿀�듬땲��. �댁젣 遺꾩꽍�� �쒖옉�� �� �덉뒿�덈떎!');
    });

    // Chat Message append helper
    const appendMessage = (sender, text) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${sender}`;
        msgDiv.textContent = text;
        msgDiv.style.whiteSpace = 'pre-wrap';
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return msgDiv;
    };

    // Construct the LLM Context Prompt
    const buildPromptContext = () => {
        const activeCurrency = state.activeCurrency || 'KRW';
        const exchangeRate = state.currentExchangeRate || '誘몄“��';
        const safeAccounts = state.accounts.map(({ id, name, type }) => ({ id, name, type }));

        // Simplify portfolio and logs for context window optimization
        const simplifiedPortfolio = state.portfolio.map(s => {
            const acc = state.accounts.find(a => a.id === s.accountId);
            return {
                id: s.id,
                account: acc ? acc.name : '誘몄���',
                name: s.name,
                ticker: s.ticker,
                shares: s.shares,
                avgPrice: s.avgPrice,
                currency: s.currency,
                annualDividend: s.annualDividend
            };
        });

        const simplifiedLogs = state.dividendLogs.slice(0, 15).map(l => {
            const stock = state.portfolio.find(p => p.id === l.portfolioId);
            return {
                date: l.date,
                ticker: stock ? stock.ticker : '湲고�',
                name: stock ? stock.name : '湲고�',
                amount: l.amount,
                currency: l.currency,
                amountKRW: l.amountKRW
            };
        });

        return `��븷: 諛곕떦 �깆옣 �ъ옄 �꾨Ц 湲덉쑖 AI �댁떆�ㅽ꽩��
�ъ슜�먯쓽 �몄뼱: �쒓뎅��

�꾩옱 �ъ슜�먯쓽 �ы듃�대━�� �곗씠�� �뺣낫:
- �쒖떆 �듯솕: ${activeCurrency}
- �곸슜 �섏쑉: ${exchangeRate} KRW/USD
- �깅줉 怨꾩쥖 紐⑸줉: ${JSON.stringify(safeAccounts)}
- 蹂댁쑀 二쇱떇 �ы듃�대━��: ${JSON.stringify(simplifiedPortfolio)}
- 理쒓렐 15媛� 諛곕떦湲� �섎졊 �댁뿭: ${JSON.stringify(simplifiedLogs)}

誘몄뀡:
1. �ъ슜�먯쓽 諛곕떦 �꾪솴 遺꾩꽍, �뱀젙 醫낅ぉ 異붿쿇, �덉긽 諛곕떦 諛� �ы듃�대━�� 議곗뼵 �붽뎄�� �곸꽭�섍쾶 �듯빀�덈떎.
2. 留뚯빟 �ъ슜�먭� ���붾줈 �덈줈�� 二쇱떇 痍⑤뱷�대굹 諛곕떦湲� �섎졊�� 湲곕줉�대떖�쇨퀬 �붿껌�� 寃쎌슦(��: "�ㅻ뒛 SCHD 10二� 78�щ윭�� ���� 湲곕줉�댁쨾" �먮뒗 "�댁젣 由ъ뼹�곗씤而� 諛곕떦 �몄쟾 39�щ윭 諛쏆븯�� �곸뼱以�"), �대떦 紐낅졊�� �ㅼ젣 �ы듃�대━�� �깆뿉 湲곕줉�섍린 �꾪빐 �듬� 媛��� 留덉�留� 以꾩뿉 �뺥솗�� �묒떇�� JSON �≪뀡 釉붾줉�� �좎씪�섍쾶 �ы븿�쒖폒�� �⑸땲��.

�≪뀡 媛��ν븳 JSON �щ㎎ 醫낅쪟 (�듬� 留� 留덉�留� 以꾩뿉 �� �섎굹留� 異쒕젰�댁빞 ��):
1. 異붽� 留ㅼ닔 湲곕줉 (buy_more):
{"action": "buy_more", "ticker": "SCHD", "shares": 10, "price": 78.2, "date": "2026-06-28"}

2. 諛곕떦湲� �섎졊 湲곕줉 (record_dividend):
{"action": "record_dividend", "ticker": "O", "amount": 39.0, "tax": 5.85, "date": "2026-06-28", "currency": "USD"}

二쇱쓽�ы빆: 
- JSON �≪뀡 �щ㎎�� 異쒕젰�� �뚮뒗 �ъ슜�먭� 紐낇솗�섍쾶 '湲곕줉�댁쨾', '�곸뼱以�', '諛섏쁺�댁쨾'�쇨퀬 吏��쒗뻽�� �뚮쭔 �ъ슜�⑸땲��.
- �좎쭨(date)媛� �놁쑝硫� �ㅻ뒛 �좎쭨(�꾩� 湲곗�: ${core.localDateString()})濡� 湲곕낯 湲곗엯�⑸땲��.
- 醫낅ぉ�� �ъ슜�먭� �쒓났�� �쒓�紐낆씠�� �곗빱瑜� �쒖슜�� �ы듃�대━�ㅼ뿉�� 留ㅼ묶�섏떗�쒖삤.
- �듬��� �꾨Ц�곸씠怨� 移쒓렐�� �댁“濡� �묒꽦�� 二쇱꽭��.`;
    };

    // Process LLM Response JSON Action
    const parseAndExecuteAction = async (text) => {
        // Find JSON block in response
        const jsonMatch = text.match(/\{"action"\s*:\s*"[^"]+".*?\}/s);
        if (!jsonMatch) return null;

        try {
            const actionData = JSON.parse(jsonMatch[0]);
            
            if (actionData.action === 'buy_more') {
                const { ticker, shares, price, date } = actionData;
                const stock = state.portfolio.find(p => p.ticker.toUpperCase() === ticker.toUpperCase() || p.name.includes(ticker));
                if (!stock) {
                    return `�좑툘 �ы듃�대━�ㅼ뿉 �깅줉�섏� �딆� 醫낅ぉ(${ticker})�낅땲��. 異붽� 留ㅼ닔瑜� 湲곕줉�섎젮硫� 癒쇱� �먯궛愿�由� 硫붾돱�먯꽌 �대떦 醫낅ぉ�� �ы듃�대━�ㅼ뿉 異붽��� 二쇱꽭��.`;
                }

                const buyDate = date || core.localDateString();
                const currentShares = stock.shares;
                const newTotalShares = currentShares + parseFloat(shares);
                
                // Recalculate average price
                const oldCost = currentShares * stock.avgPrice;
                const newBuyCost = parseFloat(shares) * parseFloat(price);
                const newAvgPrice = (oldCost + newBuyCost) / newTotalShares;
                
                // Add to history
                const newEntry = {
                    id: 'sh-' + Date.now(),
                    portfolioId: stock.id,
                    date: buyDate,
                    shares: newTotalShares
                };
                state.shareHistory.push(newEntry);
                state.shareHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
                
                // Sync portfolio shares
                stock.shares = newTotalShares;
                stock.avgPrice = Math.round(newAvgPrice * 100) / 100;
                
                saveState();
                renderAll();
                return `�� **�먮룞 異붽�留ㅼ닔 湲곗엯 �깃났**\n醫낅ぉ: ${stock.name} (${stock.ticker})\n異붽� �섎웾: +${shares}二� (珥� 蹂댁쑀: ${newTotalShares}二�)\n�섏젙�� �됰떒媛�: ${formatCurrency(stock.avgPrice, stock.currency)}`;
            }

            if (actionData.action === 'record_dividend') {
                const { ticker, amount, tax, date, currency } = actionData;
                const stock = state.portfolio.find(p => p.ticker.toUpperCase() === ticker.toUpperCase() || p.name.includes(ticker));
                if (!stock) {
                    return `�좑툘 �ы듃�대━�ㅼ뿉 �깅줉�섏� �딆� 醫낅ぉ(${ticker})�낅땲��. 諛곕떦�� �섎졊�섎젮硫� 醫낅ぉ�� 癒쇱� �ы듃�대━�ㅼ뿉 異붽��섏뼱 �덉뼱�� �⑸땲��.`;
                }

                const logDate = date || core.localDateString();
                const logCurrency = currency || stock.currency;
                const logTax = parseFloat(tax) || 0;
                const logAmount = parseFloat(amount);
                
                let rate = 1;
                let rateDate = logDate;
                let rateSource = 'not-applicable';
                if (logCurrency === 'USD') {
                    const rateResult = await getHistoricalExchangeRate(logDate);
                    if (!rateResult.ok) {
                        return `�좑툘 ${logDate} 怨쇨굅 �섏쑉�� �뺤젙�섏� 紐삵빐 諛곕떦 湲곕줉�� ���ν븯吏� �딆븯�듬땲��. �쇰컲 諛곕떦 �낅젰 李쎌뿉�� �섏쑉�� 吏곸젒 �뺤씤�� 二쇱꽭��.`;
                    }
                    rate = rateResult.rate;
                    rateDate = rateResult.rateDate;
                    rateSource = rateResult.source;
                }
                const amountKRW = logCurrency === 'USD' ? logAmount * rate : logAmount;

                const newLog = {
                    id: 'log-' + Date.now(),
                    date: logDate,
                    portfolioId: stock.id,
                    amount: logAmount,
                    tax: logTax,
                    currency: logCurrency,
                    exchangeRate: rate,
                    amountKRW: amountKRW,
                    netAmount: logAmount - logTax,
                    netAmountKRW: amountKRW - (logTax * rate),
                    exchangeRateDate: rateDate,
                    exchangeRateRequestedDate: logDate,
                    exchangeRateSource: rateSource,
                    exchangeRateIsFallback: false
                };
                state.dividendLogs.push(newLog);
                state.dividendLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
                
                saveState();
                renderAll();
                return `�� **�먮룞 諛곕떦�섎졊 湲곗엯 �깃났**\n醫낅ぉ: ${stock.name} (${stock.ticker})\n�섎졊 諛곕떦湲�: ${formatCurrency(logAmount, logCurrency)} (�몄쟾)\n�섎졊 湲곗���: ${logDate}`;
            }
        } catch (e) {
            console.error("Action execution error:", e);
            return "�좑툘 AI媛� 湲곗엯�� �쒕룄�덉쑝�� 紐낅졊 �뺤떇�� �щ컮瑜댁� �딆븘 諛섏쁺�섏� 紐삵뻽�듬땲��.";
        }
        return null;
    };

    // Send Message Logic
    const sendMessage = async () => {
        const userText = inputChat.value.trim();
        if (!userText) return;

        // Clear input
        inputChat.value = '';

        // Append user bubble
        appendMessage('user', userText);

        // Retrieve API Key
        const apiKey = localStorage.getItem('dividend_tracker_gemini_key');
        if (!apiKey) {
            appendMessage('ai', '二꾩넚�⑸땲��. 諛곕떦 鍮꾩꽌瑜� �ъ슜�섎젮硫� �곗긽�⑥쓽 **�댁뇿 �꾩씠肄�**�� �대┃�� **Google Gemini API Key**瑜� �ㅼ젙�� 二쇱뀛�� �⑸땲��.');
            return;
        }

        // Add typing indicator
        const typingIndicator = appendMessage('ai', '鍮꾩꽌媛� �앷컖 以묒엯�덈떎...');

        try {
            const context = buildPromptContext();
            
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [
                        {
                            role: 'user',
                            parts: [{ text: `${context}\n\n�ъ슜�� 臾몄쓽: ${userText}` }]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.2
                    }
                })
            });

            if (!response.ok) {
                throw new Error('API �붿껌 �ㅽ뙣');
            }

            const data = await response.json();
            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '二꾩넚�⑸땲��. �듬��� �앹꽦�섏� 紐삵뻽�듬땲��.';

            // Remove typing indicator
            messagesContainer.removeChild(typingIndicator);

            // Strip the JSON block from user visibility (optional, but cleaner)
            let cleanText = rawText.replace(/\{"action"\s*:\s*"[^"]+".*?\}/s, '').trim();
            
            // Append AI response bubble
            appendMessage('ai', cleanText);

            // Process and execute any parsed JSON action
            const actionResult = await parseAndExecuteAction(rawText);
            if (actionResult) {
                appendMessage('system', actionResult);
            }

        } catch (error) {
            console.error("AI Assistant Error:", error);
            messagesContainer.removeChild(typingIndicator);
            appendMessage('ai', '�좑툘 �쒕쾭�� �듭떊�섎뒗 �숈븞 �먮윭媛� 諛쒖깮�덉뒿�덈떎. API �ㅺ� �좏슚�쒖� �뺤씤�섍퀬 �좎떆 �� �ㅼ떆 �쒕룄�� 二쇱꽭��.');
        }
    };

    btnSend.addEventListener('click', sendMessage);
    inputChat.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
}

// ============================================================================
// PWA �쒕퉬�� �뚯빱 諛� 援ш� �쒕씪�대툕 �대씪�곕뱶 �숆린�� 湲곕뒫
// ============================================================================

let pendingServiceWorker = null;

function setupVersionUI() {
    const versionEl = document.getElementById('appVersion');
    const applyBtn = document.getElementById('btnApplyUpdate');
    if (versionEl) versionEl.textContent = `踰꾩쟾 ${APP_VERSION}`;
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            if (pendingServiceWorker) pendingServiceWorker.postMessage({ type: 'SKIP_WAITING' });
        });
    }
}

function showServiceWorkerUpdate(worker) {
    pendingServiceWorker = worker;
    const applyBtn = document.getElementById('btnApplyUpdate');
    if (applyBtn) applyBtn.style.display = 'inline-flex';
}

// PWA �쒕퉬�� �뚯빱 �깅줉
if ('serviceWorker' in navigator) {
    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadingForUpdate) return;
        reloadingForUpdate = true;
        window.location.reload();
    });
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(registration => {
            if (registration.waiting) showServiceWorkerUpdate(registration.waiting);
            registration.addEventListener('updatefound', () => {
                const worker = registration.installing;
                worker?.addEventListener('statechange', () => {
                    if (worker.state === 'installed' && navigator.serviceWorker.controller) showServiceWorkerUpdate(worker);
                });
            });
            return registration.update();
        }).catch(err => console.error('[PWA] Service Worker registration failed:', err));
    });
}

let gDriveTokenClient = null;
let gDriveAccessToken = null;
let gDriveFileId = null;
let gDriveTokenExpiresAt = 0;
let gDriveInitialPullComplete = false;
let gDrivePullInProgress = false;
let gDrivePushChain = Promise.resolve();
let gDrivePushQueued = false;
let gDriveRemoteModifiedTime = null;
let gDriveBaselineFingerprint = null;

function fingerprintLedger(value) {
    const comparable = {};
    core.LEDGER_FIELDS.forEach(field => {
        comparable[field] = Array.isArray(value?.[field]) ? value[field] : [];
    });
    const text = JSON.stringify(comparable);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function preserveSyncConflict(localLedger, remoteLedger, reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    localStorage.setItem(`dividend_sync_conflict_local_${stamp}`, JSON.stringify(localLedger));
    localStorage.setItem(`dividend_sync_conflict_remote_${stamp}`, JSON.stringify(remoteLedger));
    const syncLog = document.getElementById('gDriveSyncLog');
    if (syncLog) syncLog.textContent = `�숆린�� 異⑸룎 媛먯�: ${reason}. �묒そ �щ낯�� �� 釉뚮씪�곗��� 蹂댁〈�덉뒿�덈떎.`;
    showToast('Drive �숆린�� 異⑸룎�� 媛먯��� �묒そ �щ낯�� 蹂댁〈�덉뒿�덈떎.', 'warning');
}

function queueGDrivePush() {
    if (storageWriteBlocked || !gDriveAccessToken || !gDriveInitialPullComplete || gDrivePullInProgress || gDrivePushQueued) return;
    gDrivePushQueued = true;
    gDrivePushChain = gDrivePushChain.catch(() => {}).then(async () => {
        gDrivePushQueued = false;
        await pushStateToGDrive();
    });
}

function setupGDriveSync() {
    const inputClientId = document.getElementById('gDriveClientId');
    const inputWorkerUrl = document.getElementById('priceWorkerUrl');
    const btnSave = document.getElementById('btnSaveGDriveConfig');
    const btnLogin = document.getElementById('btnGDriveLogin');
    const btnLogout = document.getElementById('btnGDriveLogout');
    const txtAccount = document.getElementById('gDriveAccountName');
    const btnPull = document.getElementById('btnGDrivePull');
    const btnPush = document.getElementById('btnGDrivePush');
    const syncLog = document.getElementById('gDriveSyncLog');
    const statusDot = document.getElementById('gDriveStatusDot');

    if (!inputClientId) return;

    // Load saved settings
    const savedClientId = localStorage.getItem('gdrive_client_id') || '';
    inputClientId.value = savedClientId;
    if (inputWorkerUrl) inputWorkerUrl.value = localStorage.getItem('price_worker_url') || '';

    const updateUI = (isLoggedIn, accountText = '�곕룞�섏뼱 �덉� �딆쓬') => {
        if (isLoggedIn) {
            btnLogin.style.display = 'none';
            btnLogout.style.display = 'inline-flex';
            txtAccount.textContent = accountText;
            btnPull.disabled = false;
            btnPush.disabled = false;
            if (statusDot) {
                statusDot.className = 'status-dot online';
                statusDot.title = `援ш� �곕룞�� (${accountText})`;
            }
        } else {
            btnLogin.style.display = 'inline-flex';
            btnLogout.style.display = 'none';
            txtAccount.textContent = '�곕룞�섏뼱 �덉� �딆쓬';
            btnPull.disabled = true;
            btnPush.disabled = true;
            if (statusDot) {
                statusDot.className = 'status-dot offline';
                statusDot.title = '援ш� 誘몄뿰��';
            }
        }
    };

    const updateLog = (msg) => {
        if (syncLog) syncLog.textContent = msg;
    };

    // Initialize Token Client
    const initTokenClient = (clientId) => {
        if (!clientId || !window.google) return;
        try {
            gDriveTokenClient = google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: 'https://www.googleapis.com/auth/drive.appdata',
                callback: async (resp) => {
                    if (resp.error !== undefined) {
                        showToast('援ш� �곕룞 �ㅽ뙣: ' + resp.error, 'danger');
                        updateUI(false);
                        updateLog('�곕룞 �ㅽ뙣: ' + resp.error);
                        return;
                    }
                    
                    gDriveAccessToken = resp.access_token;
                    gDriveTokenExpiresAt = Date.now() + ((Number(resp.expires_in) || 3600) * 1000);
                    gDriveInitialPullComplete = false;
                    localStorage.setItem('gdrive_logged_in', 'true');
                    updateLog('�몄쬆 �꾨즺. API �쇱씠釉뚮윭由� 濡쒕뵫 以�...');

                    // Load gapi client
                    if (typeof gapi !== 'undefined') {
                        gapi.load('client', async () => {
                            gapi.client.setToken({ access_token: gDriveAccessToken });
                            try {
                                await gapi.client.load('drive', 'v3');
                                
                                // Query drive info to fetch account name
                                let email = '援ш� 怨꾩젙';
                                try {
                                    const about = await gapi.client.drive.about.get({ fields: 'user' });
                                    email = about.result?.user?.emailAddress || email;
                                } catch (aboutError) {
                                    console.warn('Drive account label unavailable:', aboutError);
                                }
                                updateUI(true, email);
                                updateLog('�깃났�곸쑝濡� �곕룞�섏뿀�듬땲��.');
                                
                                // Auto pull on first login
                                await pullStateFromGDrive();
                            } catch (e) {
                                console.error(e);
                                updateUI(true, '�곕룞 �꾨즺');
                                updateLog('�곕룞 �깃났 (怨꾩젙 議고쉶 �쒗븳��)');
                            }
                        });
                    }
                }
            });
        } catch (e) {
            console.error("GDrive initTokenClient error:", e);
        }
    };

    // Save Config
    btnSave.addEventListener('click', () => {
        const clientId = inputClientId.value.trim();
        const workerUrl = inputWorkerUrl?.value.trim().replace(/\/$/, '') || '';
        if (workerUrl) {
            try {
                const parsed = new URL(workerUrl);
                if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') throw new Error();
                localStorage.setItem('price_worker_url', workerUrl);
            } catch (_) {
                showToast('Worker 二쇱냼�� HTTPS URL�댁뼱�� �⑸땲��.', 'warning');
                return;
            }
        } else {
            localStorage.removeItem('price_worker_url');
        }
        if (!clientId) {
            localStorage.removeItem('gdrive_client_id');
            showToast('�� �ㅼ젙�� ���λ릺�덉뒿�덈떎.', 'success');
            updateUI(false);
            document.querySelectorAll('.modal-backdrop').forEach(modal => modal.classList.remove('open'));
            return;
        }

        localStorage.setItem('gdrive_client_id', clientId);
        initTokenClient(clientId);
        showToast('援ш� �대씪�댁뼵�� ID媛� ���λ릺�덉뒿�덈떎.', 'success');
        updateLog('�대씪�댁뼵�� ID ���λ맖. 濡쒓렇�몄쓣 吏꾪뻾�� 二쇱꽭��.');
        document.querySelectorAll('.modal-backdrop').forEach(modal => modal.classList.remove('open'));
    });

    // Login Action
    btnLogin.addEventListener('click', () => {
        const clientId = localStorage.getItem('gdrive_client_id');
        if (!clientId) {
            alert('援ш� 濡쒓렇�� �� 1�④퀎�먯꽌 Client ID瑜� 癒쇱� �ㅼ젙�섍퀬 �ㅼ젙 �꾨즺 踰꾪듉�� �뚮윭二쇱꽭��.');
            return;
        }
        if (!gDriveTokenClient) {
            initTokenClient(clientId);
        }
        if (gDriveTokenClient) {
            gDriveTokenClient.requestAccessToken({ prompt: 'consent' });
        } else {
            alert('援ш� API媛� �꾩쭅 以�鍮꾨릺吏� �딆븯�듬땲��. �좎떆 �� �ㅼ떆 �쒕룄�� 二쇱꽭��.');
        }
    });

    // Logout Action
    btnLogout.addEventListener('click', () => {
        if (gDriveAccessToken && window.google) {
            google.accounts.oauth2.revoke(gDriveAccessToken);
        }
        gDriveAccessToken = null;
        gDriveTokenExpiresAt = 0;
        gDriveInitialPullComplete = false;
        gDriveFileId = null;
        localStorage.removeItem('gdrive_logged_in');
        updateUI(false);
        updateLog('�곕룞�� �댁젣�섏뿀�듬땲��.');
        showToast('援ш� 怨꾩젙 �곕룞�� �댁젣�덉뒿�덈떎.', 'success');
    });

    // Manual PULL
    btnPull.addEventListener('click', async () => {
        await pullStateFromGDrive();
    });

    // Manual PUSH
    btnPush.addEventListener('click', async () => {
        queueGDrivePush();
        await gDrivePushChain;
    });

    // Auto-initialize on load if client ID exists
    if (savedClientId) {
        // Load GAPI client libraries
        const loadGapi = () => {
            if (typeof gapi !== 'undefined') {
                gapi.load('client', () => {});
            } else {
                setTimeout(loadGapi, 500);
            }
        };
        loadGapi();

        // Silent login or token refresh if user was logged in
        window.addEventListener('load', () => {
            setTimeout(() => {
                initTokenClient(savedClientId);
                if (localStorage.getItem('gdrive_logged_in') === 'true' && gDriveTokenClient) {
                    updateLog('�먮룞 �곕룞 �ъ뿰寃� 以�...');
                    gDriveTokenClient.requestAccessToken({ prompt: '' }); // Silent token request
                }
            }, 1000);
        });
    }
}

// Push local state to Google Drive (Auto-save)
async function pushStateToGDrive() {
    if (storageWriteBlocked || !gDriveAccessToken || !gDriveInitialPullComplete || gDrivePullInProgress) return;
    const syncLog = document.getElementById('gDriveSyncLog');
    try {
        if (gDriveTokenExpiresAt && Date.now() >= gDriveTokenExpiresAt) throw new Error('�몄쬆 �좏겙 留뚮즺. �ㅼ떆 濡쒓렇�명빐 二쇱꽭��.');
        if (syncLog) syncLog.textContent = '�대씪�곕뱶�� �λ� ���� 以�...';
        const ledger = core.createCloudLedgerSnapshot(state);

        if (!gDriveFileId) {
            const response = await gapi.client.drive.files.list({
                spaces: 'appDataFolder', q: "name = 'portfolio_state.json'",
                fields: 'files(id, name, modifiedTime)', pageSize: 1
            });
            const remote = response.result.files?.[0];
            if (remote) {
                gDriveFileId = remote.id;
                gDriveRemoteModifiedTime = remote.modifiedTime || null;
            }
        } else if (gDriveRemoteModifiedTime) {
            const current = await gapi.client.drive.files.get({ fileId: gDriveFileId, fields: 'id, modifiedTime' });
            const currentModified = current.result?.modifiedTime || null;
            if (currentModified && currentModified !== gDriveRemoteModifiedTime) {
                const remoteRes = await fetchJsonWithTimeout(`https://www.googleapis.com/drive/v3/files/${gDriveFileId}?alt=media`, {
                    headers: { 'Authorization': 'Bearer ' + gDriveAccessToken }
                }, 10000);
                preserveSyncConflict(ledger, remoteRes.data, '�ㅻⅨ 湲곌린�먯꽌 �뚯씪�� 蹂�寃쎈맖');
                return;
            }
        }

        const boundary = 'dividend_dashboard_boundary';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;
        const metadata = { name: 'portfolio_state.json', mimeType: 'application/json' };
        let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime';
        let method = 'POST';
        if (gDriveFileId) {
            url = `https://www.googleapis.com/upload/drive/v3/files/${gDriveFileId}?uploadType=multipart&fields=id,modifiedTime`;
            method = 'PATCH';
        } else {
            metadata.parents = ['appDataFolder'];
        }
        const body = delimiter + 'Content-Type: application/json\r\n\r\n' + JSON.stringify(metadata) +
            delimiter + 'Content-Type: application/json\r\n\r\n' + JSON.stringify(ledger, null, 2) + closeDelimiter;
        const { response, data: file } = await fetchJsonWithTimeout(url, {
            method,
            headers: {
                'Authorization': 'Bearer ' + gDriveAccessToken,
                'Content-Type': `multipart/related; boundary=${boundary}`
            },
            body
        }, 15000);
        if (!response.ok) throw new Error(`�대씪�곕뱶 �낅줈�� �ㅽ뙣 (${response.status})`);
        gDriveFileId = file.id || gDriveFileId;
        gDriveRemoteModifiedTime = file.modifiedTime || gDriveRemoteModifiedTime;
        gDriveBaselineFingerprint = fingerprintLedger(ledger);
        if (syncLog) syncLog.textContent = `理쒓렐 �λ� ����: ${new Date().toLocaleTimeString()}`;
    } catch (err) {
        if (/401|�좏겙 留뚮즺/.test(err.message)) {
            gDriveAccessToken = null;
            gDriveInitialPullComplete = false;
        }
        if (syncLog) syncLog.textContent = '���� �ㅽ뙣: ' + err.message;
    }
}

// Pull cloud state from Google Drive and merge
async function pullStateFromGDrive() {
    if (!gDriveAccessToken || storageWriteBlocked) return;
    const syncLog = document.getElementById('gDriveSyncLog');
    gDrivePullInProgress = true;
    let pullSucceeded = false;
    try {
        if (syncLog) syncLog.textContent = '�대씪�곕뱶 �곗씠�� 議고쉶 以�...';
        const response = await gapi.client.drive.files.list({
            spaces: 'appDataFolder',
            q: "name = 'portfolio_state.json'",
            fields: 'files(id, name, modifiedTime)',
            pageSize: 1
        });
        const files = response.result.files;
        if (!files || files.length === 0) {
            if (syncLog) syncLog.textContent = '�대씪�곕뱶 �곗씠�� �놁쓬. 濡쒖뺄 �곗씠�곕줈 �뚯씪 �앹꽦 以�...';
            gDriveInitialPullComplete = true;
            gDrivePullInProgress = false;
            await pushStateToGDrive();
            pullSucceeded = true;
            return;
        }
        gDriveFileId = files[0].id;
        gDriveRemoteModifiedTime = files[0].modifiedTime || null;
        const { response: fileRes, data: cloudState } = await fetchJsonWithTimeout(`https://www.googleapis.com/drive/v3/files/${gDriveFileId}?alt=media`, {
            headers: { 'Authorization': 'Bearer ' + gDriveAccessToken }
        }, 10000);
        if (!fileRes.ok) throw new Error(`�뚯씪 �ㅼ슫濡쒕뱶 �먮윭 (${fileRes.status})`);
        if (cloudState && (cloudState.portfolio || cloudState.dividendLogs)) {
            const localLedger = core.createCloudLedgerSnapshot(state);
            const remoteFingerprint = fingerprintLedger(cloudState);
            const localFingerprint = fingerprintLedger(localLedger);
            if (localFingerprint !== remoteFingerprint && gDriveBaselineFingerprint && localFingerprint !== gDriveBaselineFingerprint) {
                preserveSyncConflict(localLedger, cloudState, '濡쒖뺄怨� �먭꺽 �λ�媛� 紐⑤몢 蹂�寃쎈맖');
                return;
            }
            if (!gDriveBaselineFingerprint && localFingerprint !== remoteFingerprint &&
                (localLedger.accounts.length || localLedger.portfolio.length || localLedger.dividendLogs.length)) {
                preserveSyncConflict(localLedger, cloudState, '泥� �숆린�� �� 濡쒖뺄 �λ��� �먭꺽 �λ�媛� �ㅻ쫫');
            }
            state = core.mergeCloudLedger(state, cloudState);
            persistLocalState();
            renderAll();
            gDriveBaselineFingerprint = remoteFingerprint;
            const timeStr = new Date().toLocaleTimeString();
            if (syncLog) syncLog.textContent = `理쒓렐 �λ� 遺덈윭�ㅺ린: ${timeStr}`;
            showToast('援ш� �쒕씪�대툕 �λ�瑜� �숆린�뷀뻽�듬땲��. �� 湲곌린�� �쒖꽭 罹먯떆�� �좎��덉뒿�덈떎.', 'success');
        }
        pullSucceeded = true;
    } catch (err) {
        if (syncLog) syncLog.textContent = '�ㅼ슫濡쒕뱶 �ㅽ뙣: ' + err.message;
    } finally {
        gDrivePullInProgress = false;
        if (pullSucceeded) gDriveInitialPullComplete = true;
    }
}

// Trigger initialization on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    setupGDriveSync();
});
