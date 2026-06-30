// State Management
let state = {
    accounts: [],
    portfolio: [],
    dividendLogs: [],
    shareHistory: [], // [{ id, portfolioId, date, shares }]
    exchangeRateCache: {}, // Date YYYY-MM-DD -> KRW rate
    stockPrices: {},        // { ticker: { price, currency, lastUpdated } }
    lastPriceUpdate: null,  // ISO timestamp of last price fetch
    activeCurrency: 'KRW', // Display currency: KRW or USD
    currentExchangeRate: 1535, // Live/recent exchange rate
    lastBackupMonth: '' // YYYY-MM to track auto backups
};

// Constant Fallback Exchange Rate
const FALLBACK_EXCHANGE_RATE = 1535;

// Chart Instances
let monthlyChart = null;
let allocationChart = null;
let cumulativeChart = null;

// Edit State Variables
let editingAccountId = null;
let editingPortfolioId = null;
let editingDividendId = null;



// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    loadState();
    setupEventListeners();
    await updateCurrentExchangeRate();
    renderAll();
    await fetchAllStockPrices(); // Fetch current stock prices
    checkMonthlyBackup();
    setupAIChat(); // Initialize AI Chatbot
});

// Load State from LocalStorage
function loadState() {
    const savedState = localStorage.getItem('dividend_tracker_state');
    if (savedState) {
        try {
            state = { ...state, ...JSON.parse(savedState) };
            // Ensure fields exist
            if (!state.accounts) state.accounts = [];
            if (!state.portfolio) state.portfolio = [];
            if (!state.dividendLogs) state.dividendLogs = [];
            if (!state.shareHistory) state.shareHistory = [];
            if (!state.exchangeRateCache) state.exchangeRateCache = {};
            if (!state.stockPrices) state.stockPrices = {};
            if (!state.lastPriceUpdate) state.lastPriceUpdate = null;
            if (!state.activeCurrency) state.activeCurrency = 'KRW';
            if (!state.lastBackupMonth) state.lastBackupMonth = '';
        } catch (e) {
            console.error("Error parsing saved state:", e);
            showToast("데이터를 불러오는 중 오류가 발생했습니다.", "danger");
        }
    } else {
        // Load mock data if empty to give user a nice first impression
        loadMockData();
    }
}

// Save State to LocalStorage
function saveState() {
    localStorage.setItem('dividend_tracker_state', JSON.stringify(state));
    // Trigger GDrive auto-save if authenticated
    if (typeof pushStateToGDrive === 'function') {
        pushStateToGDrive();
    }
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
        showToast("새로운 달이 시작되어 이번 달 데이터 백업 파일을 자동으로 다운로드했습니다.", "success");
        
        state.lastBackupMonth = currentMonthStr;
        saveState();
    }
}

// Mock Data for First Impression
function loadMockData() {
    state.accounts = [
        { id: 'acc-1', name: '일반 주식계좌', type: 'General', accountNumber: '110-123-45678' },
        { id: 'acc-2', name: 'ISA 절세계좌', type: 'ISA', accountNumber: '230-987-65432' },
        { id: 'acc-3', name: '연금저축계좌', type: 'Pension', accountNumber: '340-111-22222' }
    ];

    state.portfolio = [
        { id: 'port-1', accountId: 'acc-1', name: '리얼티인컴', ticker: 'O', shares: 150, avgPrice: 55.4, currency: 'USD', annualDividend: 3.12, frequency: 'Monthly', exMonths: [1,2,3,4,5,6,7,8,9,10,11,12] },
        { id: 'port-2', accountId: 'acc-2', name: 'SCHD', ticker: 'SCHD', shares: 100, avgPrice: 78.2, currency: 'USD', annualDividend: 2.88, frequency: 'Quarterly', exMonths: [3,6,9,12] },
        { id: 'port-3', accountId: 'acc-2', name: '삼성전자우', ticker: '005935', shares: 200, avgPrice: 62000, currency: 'KRW', annualDividend: 1444, frequency: 'Quarterly', exMonths: [4,5,8,11] }, // Samsung Ele Pref payout months roughly
        { id: 'port-4', accountId: 'acc-3', name: '맥쿼리인프라', ticker: '088980', shares: 500, avgPrice: 12100, currency: 'KRW', annualDividend: 760, frequency: 'Semi-Annual', exMonths: [2, 8] }
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

// Fetch Current Exchange Rate on Init
async function updateCurrentExchangeRate() {
    try {
        const response = await fetch('https://open.er-api.com/v6/latest/USD');
        if (response.ok) {
            const data = await response.json();
            state.currentExchangeRate = data.rates.KRW;
            console.log("API Exchange Rate loaded from Open ER API:", state.currentExchangeRate);
        } else {
            state.currentExchangeRate = FALLBACK_EXCHANGE_RATE;
        }
    } catch (e) {
        console.error("Exchange rate API call failed, using fallback:", e);
        state.currentExchangeRate = FALLBACK_EXCHANGE_RATE;
    }
}

// Fetch Historical Exchange Rate
async function getHistoricalExchangeRate(dateStr) {
    if (dateStr === "") return FALLBACK_EXCHANGE_RATE;
    
    // Check Cache
    if (state.exchangeRateCache[dateStr]) {
        return state.exchangeRateCache[dateStr];
    }
    
    try {
        // Query Frankfurter API (updated domain and params)
        const response = await fetch(`https://api.frankfurter.dev/v1/${dateStr}?base=USD&symbols=KRW`);
        if (response.ok) {
            const data = await response.json();
            const rate = data.rates.KRW;
            state.exchangeRateCache[dateStr] = rate;
            saveState();
            return rate;
        }
    } catch (e) {
        console.error(`Failed to fetch exchange rate for date ${dateStr}:`, e);
    }
    
    return state.currentExchangeRate || FALLBACK_EXCHANGE_RATE;
}

// Fetch a single stock's current price (Serverless fallback using public CORS proxies)
async function fetchStockPrice(ticker, currency) {
    // 1. Try local server first if running locally
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.protocol === 'file:') {
        try {
            const url = `http://127.0.0.1:5000/api/price?ticker=${encodeURIComponent(ticker)}&currency=${encodeURIComponent(currency)}`;
            const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
            if (response.ok) {
                const data = await response.json();
                if (data.price && data.price > 0) {
                    return { price: data.price, currency: data.currency || currency };
                }
            }
        } catch (e) {
            console.log(`Local server price fetch failed for ${ticker}, trying public CORS proxies...`);
        }
    }
    
    // 2. Direct browser-only fetch using public CORS proxies
    let targetUrl = '';
    if (currency === 'KRW') {
        let cleanTicker = ticker;
        if (ticker.includes('.')) {
            cleanTicker = ticker.split('.')[0];
        }
        targetUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${cleanTicker}`;
    } else {
        targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
    }
    
    // Helper function to extract price from raw JSON data
    const parsePriceData = (data) => {
        if (!data) return null;
        if (currency === 'KRW') {
            const items = data.result?.areas?.[0]?.datas;
            if (items && items.length > 0) {
                return parseFloat(items[0].nv);
            }
        } else {
            const result = data.chart?.result;
            if (result && result.length > 0 && result[0] !== null) {
                return parseFloat(result[0].meta.regularMarketPrice);
            }
        }
        return null;
    };

    // Proxy A: CodeTabs Proxy (Raw response, edge native, very fast)
    try {
        const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
            const data = await res.json();
            const price = parsePriceData(data);
            if (price !== null && price > 0) {
                return { price, currency: currency === 'KRW' ? 'KRW' : 'USD' };
            }
        }
    } catch (e) {
        console.warn(`Proxy A (CodeTabs) failed for ${ticker}, trying Proxy B...`, e.message);
    }
    
    // Proxy B: AllOrigins Proxy (JSON wrapped response, reliable backup)
    try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) }); // Increased timeout to 10s
        if (res.ok) {
            const wrapper = await res.json();
            if (wrapper && wrapper.contents) {
                const data = typeof wrapper.contents === 'string' ? JSON.parse(wrapper.contents) : wrapper.contents;
                const price = parsePriceData(data);
                if (price !== null && price > 0) {
                    return { price, currency: currency === 'KRW' ? 'KRW' : 'USD' };
                }
            }
        }
    } catch (e) {
        console.warn(`Proxy B (AllOrigins) failed for ${ticker}, trying Proxy C...`, e.message);
    }

    // Proxy C: CORS.LOL Proxy (Raw response, high availability backup)
    try {
        const proxyUrl = `https://cors.lol/?url=${encodeURIComponent(targetUrl)}`;
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
            const data = await res.json();
            const price = parsePriceData(data);
            if (price !== null && price > 0) {
                return { price, currency: currency === 'KRW' ? 'KRW' : 'USD' };
            }
        }
    } catch (e) {
        console.error(`Proxy C (CORS.LOL) failed for ${ticker}:`, e.message);
    }
    
    return null;
}

// Fetch prices for all portfolio stocks
async function fetchAllStockPrices() {
    if (state.portfolio.length === 0) return;
    
    const updateBtn = document.getElementById('btnUpdatePrices');
    const statusEl = document.getElementById('lastPriceUpdateTime');
    
    if (updateBtn) {
        updateBtn.disabled = true;
        updateBtn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;animation:spin 1s linear infinite;"></i> 조회 중...';
    }
    
    // 1) Update current exchange rate first so UI is fresh
    await updateCurrentExchangeRate();
    
    // Deduplicate tickers
    const tickerMap = new Map(); // ticker -> currency
    state.portfolio.forEach(stock => {
        if (!tickerMap.has(stock.ticker)) {
            tickerMap.set(stock.ticker, stock.currency);
        }
    });
    
    let successCount = 0;
    let failCount = 0;
    const totalTickers = tickerMap.size;
    let currentIdx = 0;
    
    // Fetch sequentially to avoid rate-limiting from public proxies
    for (const [ticker, currency] of tickerMap.entries()) {
        currentIdx++;
        if (updateBtn) {
            updateBtn.innerHTML = `<i class="loader-spinner" style="display:inline-block; width:12px; height:12px; border:2px solid var(--text-primary); border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite; margin-right:4px; vertical-align:middle;"></i> 조회 중 (${currentIdx}/${totalTickers})...`;
        }

        const result = await fetchStockPrice(ticker, currency);
        if (result) {
            state.stockPrices[ticker] = {
                price: result.price,
                currency: result.currency,
                lastUpdated: new Date().toISOString()
            };
            successCount++;
        } else {
            failCount++;
        }
        // 1500ms throttle delay between requests to avoid rate-limiting from public proxies
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    // Update timestamp
    state.lastPriceUpdate = new Date().toISOString();
    saveState();
    
    // Re-render with new prices
    renderAll();
    
    // Update UI
    if (updateBtn) {
        updateBtn.disabled = false;
        updateBtn.innerHTML = '<i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> 현재가 업데이트';
        lucide.createIcons();
    }
    
    updatePriceTimestamp();
    
    if (failCount > 0 && successCount > 0) {
        showToast(`${successCount}개 종목 현재가 조회 완료, ${failCount}개 실패`, 'warning');
    } else if (failCount > 0 && successCount === 0) {
        showToast('현재가 조회에 실패했습니다. 네트워크를 확인해 주세요.', 'danger');
    } else {
        showToast(`${successCount}개 종목 현재가가 업데이트되었습니다.`, 'success');
    }
}

// Get current price for a stock (falls back to avgPrice)
function getStockCurrentPrice(stock) {
    const priceData = state.stockPrices[stock.ticker];
    if (priceData && priceData.price > 0) {
        return priceData.price;
    }
    return stock.avgPrice; // fallback to cost basis
}

// Check if we have a live price for a stock
function hasLivePrice(stock) {
    return !!(state.stockPrices[stock.ticker]?.price);
}

// Update the price timestamp display
function updatePriceTimestamp() {
    const el = document.getElementById('lastPriceUpdateTime');
    if (!el) return;
    
    if (state.lastPriceUpdate) {
        const d = new Date(state.lastPriceUpdate);
        const timeStr = d.toLocaleString('ko-KR', { 
            month: 'short', day: 'numeric', 
            hour: '2-digit', minute: '2-digit' 
        });
        
        const rateStr = state.currentExchangeRate ? ` (환율: ₩${state.currentExchangeRate.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})` : '';
        
        el.textContent = `마지막 업데이트: ${timeStr}${rateStr}`;
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
        document.querySelector('#modalAccount .modal-title').textContent = '새 계좌 등록';
        document.querySelector('#formAccount button[type="submit"]').textContent = '등록하기';
        document.getElementById('formAccount').reset();
        openModal('modalAccount');
    });
    document.getElementById('btnAddPortfolio').addEventListener('click', () => {
        editingPortfolioId = null;
        document.querySelector('#modalPortfolio .modal-title').textContent = '보유 주식 등록';
        document.querySelector('#formPortfolio button[type="submit"]').textContent = '등록하기';
        document.getElementById('formPortfolio').reset();
        document.querySelectorAll('.months-selection-grid input[type="checkbox"]').forEach(cb => cb.checked = false);
        populateAccountSelect('portfolioAccount');
        openModal('modalPortfolio');
    });
    document.getElementById('btnAddDividend').addEventListener('click', () => {
        editingDividendId = null;
        document.querySelector('#modalDividend .modal-title').textContent = '배당 수령 기록';
        document.querySelector('#formDividend button[type="submit"]').textContent = '등록하기';
        document.getElementById('formDividend').reset();
        document.getElementById('exchangeRateFormGroup').style.display = 'none';
        
        populateAccountSelect('dividendAccountSelect');
        populatePortfolioSelect('dividendStock');
        document.getElementById('dividendStock').disabled = true;
        
        openModal('modalDividend');
        // Set default date to today
        document.getElementById('dividendDate').value = new Date().toISOString().split('T')[0];
    });

    // -------------------------------------------------------
    // Dividend Modal – Exchange Rate Auto-Fetch Logic
    // -------------------------------------------------------
    const dateInput    = document.getElementById('dividendDate');
    const stockSelect  = document.getElementById('dividendStock');
    const currencyField = document.getElementById('dividendCurrency');
    const rateInput    = document.getElementById('dividendExchangeRate');
    const rateStatus   = document.getElementById('exchangeRateStatus');

    // Shared helper: fetch rate for a given date and populate the input
    async function fetchAndSetRate(dateStr, { showStatus = true } = {}) {
        if (!dateStr || currencyField.value !== 'USD') return;

        if (showStatus) {
            rateStatus.style.color = 'var(--text-secondary)';
            rateStatus.textContent = '⏳ 환율 조회 중...';
        }

        // Show fallback immediately so the field is never blank
        rateInput.value = (state.currentExchangeRate || FALLBACK_EXCHANGE_RATE).toFixed(2);

        // Clear cache entry so we always re-fetch on manual refresh
        // (but keep cache for auto fills on first open)
        try {
            const rate = await getHistoricalExchangeRate(dateStr);
            if (rate) {
                rateInput.value = rate.toFixed(2);
                if (showStatus) {
                    rateStatus.style.color = '#10b981';
                    rateStatus.textContent = `✔ ${dateStr} 기준 환율 조회 완료: ${rate.toFixed(2)}원`;
                }
            } else {
                if (showStatus) {
                    rateStatus.style.color = 'var(--danger)';
                    rateStatus.textContent = '⚠ 환율 조회 실패 – 현재 환율이 적용되었습니다. 수동으로 수정 가능합니다.';
                    showToast('해당 날짜의 환율을 조회하지 못했습니다. 현재 환율 기준이 적용되었습니다.', 'warning');
                }
            }
        } catch (err) {
            if (showStatus) {
                rateStatus.style.color = 'var(--danger)';
                rateStatus.textContent = '⚠ 네트워크 오류 – 수동으로 환율을 입력해 주세요.';
                showToast('환율 API 연결에 실패했습니다. 직접 입력해 주세요.', 'danger');
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
            rateInput.value = 1;
            if (rateStatus) rateStatus.textContent = '';
        }
    }

    // Trigger rate lookup when currency select changes (for "기타" stock manual selection)
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
            showToast('날짜를 먼저 선택해 주세요.', 'warning');
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
        rateInput.value = 1;
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
        await updateCurrentExchangeRate();
        await fetchAllStockPrices();
        updatePriceTimestamp(); // Force UI update for the new exchange rate string
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
            showToast("비밀번호가 일치하지 않습니다. (기본값: 0000)", "danger");
            return;
        }
        
        // 1. Auto Backup download first
        exportDataJSON();
        
        // 2. Perform deletion and reload mock data
        localStorage.removeItem('dividend_tracker_state');
        loadMockData();
        closeModal('modalReset');
        renderAll();
        showToast("데이터가 백업 및 안전하게 초기화되었습니다.", "success");
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
                            state = { ...state, ...importedState };
                            if (!state.shareHistory) state.shareHistory = [];
                            saveState();
                            renderAll();
                            showToast("데이터 백업이 성공적으로 복원되었습니다.", "success");
                        } else {
                            showToast("올바른 백업 파일 형식이 아닙니다.", "danger");
                        }
                    } catch (err) {
                        showToast("파일을 읽는 중 오류가 발생했습니다.", "danger");
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
    // Buy More (추가 구매) Modal Logic
    // -------------------------------------------------------
    document.getElementById('btnBuyMore').addEventListener('click', () => {
        if (state.portfolio.length === 0) {
            showToast('등록된 종목이 없습니다. 먼저 보유 주식을 등록해 주세요.', 'warning');
            return;
        }
        document.getElementById('formBuyMore').reset();
        document.getElementById('buyMoreCurrentInfo').style.display = 'none';
        document.getElementById('buyMorePreview').style.display = 'none';
        
        populateAccountSelect('buyMoreAccountSelect');
        populatePortfolioSelect('buyMoreStock');
        document.getElementById('buyMoreStock').disabled = true;
        
        document.getElementById('buyMoreDate').value = new Date().toISOString().split('T')[0];
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

    // Cross-calculation: shares ↔ per-share price ↔ total price
    const buySharesInput = document.getElementById('buyMoreShares');
    const buyPriceInput  = document.getElementById('buyMorePrice');
    const buyTotalInput  = document.getElementById('buyMoreTotalPrice');

    // When quantity changes → recalculate total from per-share (if per-share is filled)
    buySharesInput.addEventListener('input', () => {
        const shares = parseFloat(buySharesInput.value);
        const price  = parseFloat(buyPriceInput.value);
        if (shares > 0 && price > 0) {
            buyTotalInput.value = parseFloat((shares * price).toFixed(6));
        }
        updateBuyMorePreview();
    });

    // When per-share price changes → recalculate total
    buyPriceInput.addEventListener('input', () => {
        const shares = parseFloat(buySharesInput.value);
        const price  = parseFloat(buyPriceInput.value);
        if (shares > 0 && price > 0) {
            buyTotalInput.value = parseFloat((shares * price).toFixed(6));
        }
        updateBuyMorePreview();
    });

    // When total price changes → back-calculate per-share price
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
        themeBtn.innerHTML = '<i data-lucide="moon"></i> 다크 모드';
    } else {
        themeBtn.innerHTML = '<i data-lucide="sun"></i> 라이트 모드';
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
    
    document.querySelector('#modalAccount .modal-title').textContent = '계좌 정보 수정';
    document.querySelector('#formAccount button[type="submit"]').textContent = '수정하기';
    
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
    
    document.querySelector('#modalPortfolio .modal-title').textContent = '보유 주식 정보 수정';
    document.querySelector('#formPortfolio button[type="submit"]').textContent = '수정하기';
    
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
        document.getElementById('dividendExchangeRate').value = log.exchangeRate;
    } else {
        document.getElementById('exchangeRateFormGroup').style.display = 'none';
        document.getElementById('dividendExchangeRate').value = 1;
    }
    
    document.querySelector('#modalDividend .modal-title').textContent = '배당 수령 기록 수정';
    document.querySelector('#formDividend button[type="submit"]').textContent = '수정하기';
    
    openModal('modalDividend');
}

function populateAccountSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // If it's the dividend account select, add a placeholder first
    if (selectId === 'dividendAccountSelect') {
        select.innerHTML = '<option value="">계좌를 먼저 선택하세요</option>';
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
    
    select.innerHTML = '<option value="">-- 종목 선택 --</option>';
    
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
            const accName = acc ? acc.name : '미지정 계좌';
            option.textContent = `[${accName}] ${p.name} (${p.ticker})`;
        }
        select.appendChild(option);
    });
    
    // Add virtual "기타" stock if account is specified
    if (accountId) {
        const option = document.createElement('option');
        option.value = `etc-${accountId}`;
        option.textContent = `기타 (ETC)`;
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
    filterAccount.innerHTML = '<option value="">전체 계좌</option>';
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
        filterPortfolioAccount.innerHTML = '<option value="all">전체 계좌 보기</option>';
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
    filterStock.innerHTML = '<option value="">전체 종목</option>';
    
    let filteredPortfolio = state.portfolio;
    if (selectedAccount) {
        filteredPortfolio = state.portfolio.filter(p => p.accountId === selectedAccount);
    }
    
    filteredPortfolio.forEach(stock => {
        const option = document.createElement('option');
        option.value = stock.id;
        
        const acc = state.accounts.find(a => a.id === stock.accountId);
        const accName = acc ? acc.name : '미지정 계좌';
        
        option.textContent = `[${accName}] ${stock.name} (${stock.ticker})`;
        if (stock.id === selectedStock) {
            option.selected = true;
        }
        filterStock.appendChild(option);
    });

    // Add virtual "기타" stock options to filter
    if (selectedAccount) {
        const acc = state.accounts.find(a => a.id === selectedAccount);
        if (acc) {
            const option = document.createElement('option');
            option.value = `etc-${selectedAccount}`;
            option.textContent = `[${acc.name}] 기타 (ETC)`;
            if (option.value === selectedStock) option.selected = true;
            filterStock.appendChild(option);
        }
    } else {
        state.accounts.forEach(acc => {
            const option = document.createElement('option');
            option.value = `etc-${acc.id}`;
            option.textContent = `[${acc.name}] 기타 (ETC)`;
            if (option.value === selectedStock) option.selected = true;
            filterStock.appendChild(option);
        });
    }
    
    // If the selected stock is not in the filtered portfolio and not a virtual "기타" option, reset the stock filter value
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
    return usdVal * state.currentExchangeRate;
}

function convertKRWToUSD(krwVal) {
    return krwVal / state.currentExchangeRate;
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
            showToast("계좌 정보가 수정되었습니다.", "success");
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
        showToast("계좌가 성공적으로 추가되었습니다.", "success");
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
        showToast("배당 지급 월을 최소 하나 이상 선택해 주세요.", "warning");
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
            
            showToast("보유 종목 정보가 수정되었습니다.", "success");
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
            date: new Date().toISOString().split('T')[0],
            shares: shares
        });
        
        showToast("보유 종목이 추가되었습니다.", "success");
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
            date: new Date().toISOString().split('T')[0],
            shares: newShares
        });
    } else {
        stockHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
        const latest = stockHistory[stockHistory.length - 1];
        latest.shares = newShares;
    }
}

// -------------------------------------------------------
// Additional Purchase (추가 구매) Helpers
// -------------------------------------------------------
function updateBuyMoreInfo() {
    const select = document.getElementById('buyMoreStock');
    const stockId = select.value;
    const stock = state.portfolio.find(p => p.id === stockId);
    
    const infoBox = document.getElementById('buyMoreCurrentInfo');
    const preview = document.getElementById('buyMorePreview');
    
    if (stock) {
        document.getElementById('buyMoreCurShares').textContent = 
            stock.shares.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) + '주';
        const currency = stock.currency === 'USD' ? '$' : '₩';
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
    
    const currency = stock.currency === 'USD' ? '$' : '₩';
    document.getElementById('buyMoreNewShares').textContent =
        totalShares.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) + '주';
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
        showToast('종목을 선택해 주세요.', 'warning');
        return;
    }
    
    const addShares = parseFloat(document.getElementById('buyMoreShares').value);
    const buyPrice  = parseFloat(document.getElementById('buyMorePrice').value);
    const buyDate   = document.getElementById('buyMoreDate').value;
    
    if (!addShares || !buyPrice || !buyDate || addShares <= 0 || buyPrice <= 0) {
        showToast('수량, 단가, 날짜를 올바르게 입력해 주세요.', 'warning');
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
    
    showToast(`${stock.name} ${addShares}주 추가 구매 반영 완료! 총 ${stock.shares}주 · 평균단가 ${stock.avgPrice.toFixed(2)}`, 'success');
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
        showToast("종목을 선택해 주세요.", "warning");
        return;
    }

    const currency = document.getElementById('dividendCurrency').value;
    let rate = 1;
    if (currency === 'USD') {
        rate = parseFloat(document.getElementById('dividendExchangeRate').value);
        if (!rate || isNaN(rate)) {
            rate = await getHistoricalExchangeRate(dateVal);
        }
    }

    const amountKRW = currency === 'KRW' ? amount : amount * rate;

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
            showToast("배당 수령 기록이 수정되었습니다.", "success");
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
            tax
        };
        state.dividendLogs.push(newLog);
        showToast("배당금 수령 기록이 추가되었습니다.", "success");
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
    if (confirm("이 계좌를 삭제하시겠습니까? 연결된 포트폴리오 및 배당금 수령 기록도 삭제될 수 있습니다.")) {
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
        showToast("계좌가 삭제되었습니다.", "success");
    }
}

function deletePortfolio(id) {
    if (confirm("이 보유 종목을 삭제하시겠습니까? 관련된 배당금 수령 기록도 모두 삭제됩니다.")) {
        state.portfolio = state.portfolio.filter(p => p.id !== id);
        state.dividendLogs = state.dividendLogs.filter(log => log.portfolioId !== id);
        state.shareHistory = state.shareHistory.filter(sh => sh.portfolioId !== id);
        saveState();
        renderAll();
        showToast("종목이 삭제되었습니다.", "success");
    }
}

function deleteDividendLog(id) {
    if (confirm("이 배당금 수령 기록을 삭제하시겠습니까?")) {
        state.dividendLogs = state.dividendLogs.filter(log => log.id !== id);
        saveState();
        renderAll();
        showToast("수령 기록이 삭제되었습니다.", "success");
    }
}

// Export Data as JSON file
function exportDataJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    const dateStamp = new Date().toISOString().split('T')[0];
    downloadAnchor.setAttribute("download", `dividend_backup_${dateStamp}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("데이터 백업 파일이 내보내졌습니다.", "success");
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
                showToast("엑셀 파일이 비어 있습니다.", "danger");
                return;
            }
            
            excelHeaders = json[0].map(h => String(h).trim());
            parsedExcelRows = XLSX.utils.sheet_to_json(worksheet);
            
            setupMappingUI();
            
            // Advance to Step 2
            document.getElementById('importStep1').classList.remove('active');
            document.getElementById('importStep2').classList.add('active');
            
            showToast("엑셀 파일이 분석되었습니다. 열 매핑을 시작해 주세요.", "success");
        } catch (err) {
            console.error("Excel read error:", err);
            showToast("엑셀 파일을 파싱하는 데 실패했습니다. 지원 형식(.xlsx, .xls, .csv)을 확인해 주세요.", "danger");
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
            { key: 'account', label: '계좌명 (Account)', required: true },
            { key: 'name', label: '종목명 (Name)', required: true },
            { key: 'ticker', label: '티커/종목코드 (Ticker)', required: true },
            { key: 'shares', label: '보유수량 (Shares)', required: true },
            { key: 'avgPrice', label: '평균매수단가 (Avg Price)', required: true },
            { key: 'currency', label: '통화 (KRW/USD)', required: false },
            { key: 'annualDividend', label: '주당 연배당금 (Annual Dividend)', required: true },
            { key: 'frequency', label: '배당주기 (Monthly/Quarterly...)', required: false },
            { key: 'exMonths', label: '배당월 목록 (예: 3,6,9,12)', required: false }
        ];
    } else {
        // Dividend logs
        fields = [
            { key: 'date', label: '배당 수령일 (Date)', required: true },
            { key: 'ticker', label: '티커 또는 종목코드 (Ticker)', required: true },
            { key: 'amount', label: '세전 배당금액 (Amount)', required: true },
            { key: 'currency', label: '통화 (KRW/USD)', required: false },
            { key: 'tax', label: '배당세금 (Tax)', required: false },
            { key: 'exchangeRate', label: '환율 (Exchange Rate)', required: false }
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
                (f.key === 'account' && (hLower.includes('계좌') || hLower.includes('acc'))) ||
                (f.key === 'avgPrice' && (hLower.includes('단가') || hLower.includes('매수가') || hLower.includes('평단'))) ||
                (f.key === 'shares' && (hLower.includes('수량') || hLower.includes('보유') || hLower.includes('개수'))) ||
                (f.key === 'annualDividend' && (hLower.includes('배당금') || hLower.includes('연배당'))) ||
                (f.key === 'exMonths' && hLower.includes('배당월')) ||
                (f.key === 'ticker' && (hLower.includes('코드') || hLower.includes('티커') || hLower.includes('symbol'))) ||
                (f.key === 'date' && (hLower.includes('일자') || hLower.includes('날짜') || hLower.includes('배당일'))) ||
                (f.key === 'tax' && (hLower.includes('세금') || hLower.includes('원천징수'))) ||
                (f.key === 'amount' && (hLower.includes('수령액') || hLower.includes('금액') || hLower.includes('배당금')))) {
                bestMatch = header;
                break;
            }
        }

        let options = excelHeaders.map(h => `<option value="${h}" ${h === bestMatch ? 'selected' : ''}>${h}</option>`).join('');
        options = `<option value="">-- 매핑 안 함 ${f.required ? '(필수)' : ''} --</option>` + options;
        
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
    
    showToast("데이터를 가져오는 중입니다...", "warning");

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
                    if (curStr === 'USD' || curStr === '$' || curStr.includes('달러')) {
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
                    if (freqStr.includes('월') || freqStr.includes('month')) frequency = 'Monthly';
                    else if (freqStr.includes('반') || freqStr.includes('semi')) frequency = 'Semi-Annual';
                    else if (freqStr.includes('년') || freqStr.includes('annual')) frequency = 'Annual';
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
                        dateStr = targetDate.toISOString().split('T')[0];
                    } else {
                        // Regular string date format
                        const dateObj = new Date(String(rawDate).trim());
                        if (!isNaN(dateObj.getTime())) {
                            dateStr = dateObj.toISOString().split('T')[0];
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
                        defaultAcc = { id: 'acc-default', name: '가져온 계좌', type: 'General' };
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
                if (currency === 'USD') {
                    if (mapRate && row[mapRate] && !isNaN(parseFloat(row[mapRate]))) {
                        rate = parseFloat(row[mapRate]);
                    } else {
                        // Fetch historical rate
                        rate = await getHistoricalExchangeRate(dateStr);
                    }
                }

                const amountKRW = currency === 'KRW' ? amount : amount * rate;
                const tax = (mapTax && row[mapTax]) ? parseFloat(row[mapTax]) : 0;

                const newLog = {
                    id: 'log-' + Date.now() + Math.random().toString(36).substr(2, 5),
                    date: dateStr,
                    portfolioId: stock.id,
                    amount,
                    currency,
                    exchangeRate: rate,
                    amountKRW,
                    tax: isNaN(tax) ? 0 : tax
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
    
    showToast(`${successCount}개의 행을 성공적으로 가져왔습니다. (오류: ${failCount}개)`, "success");
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
    let totalCostBasis = 0;        // 매수금액 (shares × avgPrice)
    let totalMarketValue = 0;      // 평가금액 (shares × currentPrice)
    let totalExpectedAnnualDiv = 0;

    state.portfolio.forEach(stock => {
        const costVal = stock.shares * stock.avgPrice;
        const marketVal = stock.shares * getStockCurrentPrice(stock);
        const expectedDiv = stock.shares * stock.annualDividend;
        
        totalCostBasis += getValInActiveCurrency(costVal, stock.currency);
        totalMarketValue += getValInActiveCurrency(marketVal, stock.currency);
        totalExpectedAnnualDiv += getValInActiveCurrency(expectedDiv, stock.currency);
    });

    // Cumulative Received Dividend
    let totalReceivedDiv = 0;
    state.dividendLogs.forEach(log => {
        totalReceivedDiv += getValInActiveCurrency(log.amount, log.currency);
    });

    // Average Yield (based on market value)
    const avgYield = totalMarketValue > 0 ? (totalExpectedAnnualDiv / totalMarketValue) * 100 : 0;
    
    // Profit / Loss
    const profitLoss = totalMarketValue - totalCostBasis;
    const profitLossRate = totalCostBasis > 0 ? (profitLoss / totalCostBasis) * 100 : 0;
    const plSign = profitLoss >= 0 ? '+' : '';
    const plClass = profitLoss >= 0 ? 'positive' : 'negative';

    // Update elements
    document.getElementById('kpiTotalCost').textContent = formatCurrency(totalCostBasis);
    document.getElementById('kpiMarketValue').textContent = formatCurrency(totalMarketValue);
    
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
                <h3>등록된 계좌가 없습니다</h3>
                <p>배당주를 관리할 계좌를 등록해 주세요.</p>
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
                    <span class="account-stat-label">매수 금액</span>
                    <span class="account-stat-value">${formatCurrency(accCostVal)}</span>
                </div>
                <div class="account-stat">
                    <span class="account-stat-label">평가 금액</span>
                    <span class="account-stat-value">${formatCurrency(accMarketVal)}</span>
                    <span class="kpi-trend ${accPLClass}" style="font-size: 0.75rem;">${accPLSign}${accPLRate.toFixed(2)}%</span>
                </div>
                <div class="account-stat">
                    <span class="account-stat-label">연 예상 배당금</span>
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
                    <h3>보유 종목이 없습니다</h3>
                    <p>조건에 맞는 종목이 없거나 등록된 주식이 없습니다.</p>
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
        const yieldRate = currentPrice > 0 ? (stock.annualDividend / currentPrice) * 100 : 0;
        
        return {
            ...stock,
            accName: acc ? acc.name : '미지정 계좌',
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
        const curPriceDisplay = hasLivePrice(stock) 
            ? formatCurrency(stock.currentPrice, stock.currency)
            : '<span style="color:var(--text-secondary);">—</span>';
        
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
            <td>${hasLivePrice(stock) ? formatCurrency(stock.totalMarketVal, stock.currency) : '<span style="color:var(--text-secondary);">—</span>'}</td>
            <td>${hasLivePrice(stock) ? `<span class="kpi-trend ${plClass}">${plSign}${formatCurrency(stock.profitLoss, stock.currency)}<br><small>(${plSign}${stock.plRate.toFixed(2)}%)</small></span>` : '<span style="color:var(--text-secondary);">—</span>'}</td>
            <td>${formatCurrency(stock.annualDividend, stock.currency)}</td>
            <td>${formatCurrency(totalDiv, stock.currency)}</td>
            <td><span class="kpi-trend positive">${stock.yieldRate.toFixed(2)}%</span></td>
            <td>
                <div class="action-btns">
                    <button class="btn-table-icon" onclick="openShareHistoryModal('${stock.id}')" title="수량 변동 이력">
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
                <td colspan="7" class="empty-state">
                    <i data-lucide="bar-chart-2"></i>
                    <h3>기록된 배당 수령 내역이 없습니다</h3>
                    <p>우측 상단의 배당 수령 기록을 등록하거나 엑셀로 한 번에 가져오세요.</p>
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
                <td colspan="7" class="empty-state">
                    <i data-lucide="filter"></i>
                    <h3>필터 조건에 맞는 배당 수령 내역이 없습니다</h3>
                    <p>다른 필터 조건을 선택해 보세요.</p>
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

        const stockNameA = isEtcA ? '기타' : (stockA ? stockA.name : '');
        const stockNameB = isEtcB ? '기타' : (stockB ? stockB.name : '');

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
        let stockName = '기타';
        let ticker = 'ETC';
        let accountId = '';
        if (isEtc) {
            accountId = log.portfolioId.replace('etc-', '');
        } else {
            const stock = state.portfolio.find(p => p.id === log.portfolioId);
            stockName = stock ? stock.name : '삭제된 종목';
            ticker = stock ? stock.ticker : '-';
            accountId = stock ? stock.accountId : '';
        }
        
        const acc = state.accounts.find(a => a.id === accountId);
        const accName = acc ? acc.name : '미지정 계좌';
        const accType = acc ? acc.type : 'General';
        
        // Format date to Year-Month (e.g. 2026-06)
        const dateParts = log.date.split('-');
        const yyyymm = dateParts.length >= 2 ? `${dateParts[0]}-${dateParts[1]}` : log.date;
        
        const rateText = log.currency === 'USD' 
            ? `<br><small style="color: var(--text-secondary); font-size: 0.75rem;">(환율: ₩${log.exchangeRate.toFixed(1)} / ${yyyymm} 기준)</small>` 
            : '';
        
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
                ${formatCurrency(log.amountKRW, 'KRW')}
                ${rateText}
            </td>
            <td>${formatCurrency(log.tax, log.currency)}</td>
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
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Unknown';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
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
        const accountName = account ? account.name : '기타/직접입력';

        if (!accountsMap[accountId]) {
            accountsMap[accountId] = {
                name: accountName,
                data: {}
            };
            sortedMonths.forEach(m => accountsMap[accountId].data[m] = 0);
        }

        const amtActive = getValInActiveCurrency(log.amount, log.currency);
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
                return `${parts[0]}년 ${parseInt(parts[1])}월`;
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
                                : (value >= 10000 ? (value / 10000) + '만' : value);
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
        cumulativeSum += getValInActiveCurrency(log.amount, log.currency);
        values.push(cumulativeSum);
    });

    cumulativeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: '누적 배당금 수령액',
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
                                : (value >= 10000 ? (value / 10000) + '만' : value);
                        }
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` 누적 배당금: ${formatCurrency(context.parsed.y)}`;
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
    document.getElementById('historyDate').value = new Date().toISOString().split('T')[0];
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
                    기록된 수량 변동 이력이 없습니다.
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
            <td style="padding: 0.5rem; text-align: left;">${item.shares.toLocaleString()} 주</td>
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
        showToast("올바른 날짜와 수량을 입력해 주세요.", "warning");
        return;
    }
    
    // Check if there is already an entry for this exact date
    const existing = state.shareHistory.find(sh => sh.portfolioId === activeShareHistoryPortfolioId && sh.date === dateVal);
    if (existing) {
        if (confirm("해당 날짜에 이미 수량 기록이 존재합니다. 값을 수정하시겠습니까?")) {
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
    showToast("수량 변동 이력이 추가/수정되었습니다.", "success");
}

function deleteShareHistoryEntry(id) {
    const entry = state.shareHistory.find(sh => sh.id === id);
    if (!entry) return;
    
    const portfolioId = entry.portfolioId;
    const stockHistory = state.shareHistory.filter(sh => sh.portfolioId === portfolioId);
    
    if (stockHistory.length <= 1) {
        showToast("최소 하나의 보유 수량 이력이 존재해야 하므로 삭제할 수 없습니다.", "warning");
        return;
    }
    
    if (confirm("이 보유 수량 이력 기록을 삭제하시겠습니까?")) {
        state.shareHistory = state.shareHistory.filter(sh => sh.id !== id);
        
        // Sync shares
        syncPortfolioSharesFromHistory(portfolioId);
        
        saveState();
        renderAll();
        renderShareHistoryList(portfolioId);
        showToast("수량 이력 기록이 삭제되었습니다.", "success");
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
    select.innerHTML = '<option value="">-- 종목 선택 --</option>';
    
    state.portfolio.forEach(p => {
        const acc = state.accounts.find(a => a.id === p.accountId);
        const accName = acc ? acc.name : '미지정 계좌';
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
    document.getElementById('reinvestKpiShares').textContent = `${stock.shares.toLocaleString()}주`;
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
        const monthLabel = `${parts[0]}년 ${parseInt(parts[1])}월`;
        
        tr.innerHTML = `
            <td style="padding: 0.75rem 0.5rem;"><strong>${monthLabel}</strong></td>
            <td style="padding: 0.75rem 0.5rem;">${row.shares.toLocaleString()} 주</td>
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
        return `${parts[0]}년 ${parseInt(parts[1])}월`;
    });
    
    const dividendData = timelineData.map(d => d.dividend);
    const sharesData = timelineData.map(d => d.shares);
    
    reinvestChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [
                {
                    label: `월 배당금 (${stock.currency})`,
                    type: 'bar',
                    data: dividendData,
                    backgroundColor: 'rgba(99, 102, 241, 0.65)',
                    borderColor: '#6366f1',
                    borderWidth: 1,
                    borderRadius: 4,
                    yAxisID: 'y'
                },
                {
                    label: '보유 주식 수 (주)',
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
                            return stock.currency === 'USD' ? '$' + value : value.toLocaleString() + '원';
                        }
                    },
                    title: {
                        display: true,
                        text: `배당금 (${stock.currency})`,
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
                            return value.toLocaleString() + ' 주';
                        }
                    },
                    title: {
                        display: true,
                        text: '보유 주식 수 (주)',
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
                                label += context.parsed.y.toLocaleString() + ' 주';
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
           ((name.includes('미국배당다우존스') || name.includes('미국배당 다우존스')) &&
            (name.includes('SOL') || name.includes('TIGER') || name.includes('ACE') || name.includes('미래에셋') || name.includes('신한')));
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
        sharesListEl.textContent = '보유 중인 SCHD 관련 종목이 없습니다.';
        expectedDivEl.textContent = '-';
        avgYieldEl.textContent = '0.0%';
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 2rem;">보유 중인 SCHD군 종목이 없습니다.</td></tr>';
        
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
        
        sharesListTexts.push(`${s.name} (${s.ticker}): ${s.shares.toLocaleString()}주`);
        
        const sharesAtStart = getSharesAtDate(s.id, startOfCurrentMonth);
        const newShares = Math.max(0, s.shares - sharesAtStart);
        if (newShares > 0) {
            const buyCost = newShares * s.avgPrice;
            thisMonthInvested += getValInActiveCurrency(buyCost, s.currency);
            thisMonthSharesTexts.push(`${s.ticker} +${newShares.toLocaleString()}주`);
        }
    });
    
    const avgYield = totalInvested > 0 ? (totalExpectedAnnualDiv / totalInvested) * 100 : 0;
    
    totalInvestedEl.innerHTML = formatCurrency(totalInvested) + 
        (thisMonthInvested > 0 
            ? `<div style="font-size: 0.75rem; font-weight: 500; margin-top: 0.15rem;" class="kpi-trend positive">이번 달 +${formatCurrency(thisMonthInvested)}</div>` 
            : `<div style="font-size: 0.75rem; font-weight: 500; margin-top: 0.15rem; color: var(--text-secondary);">이번 달 추가 매수 없음</div>`);
            
    sharesListEl.innerHTML = sharesListTexts.join('\n') + 
        (thisMonthSharesTexts.length > 0 
            ? `<div style="font-size: 0.75rem; font-weight: 500; color: var(--primary); margin-top: 0.25rem;">(이번 달 추가: ${thisMonthSharesTexts.join(', ')})</div>` 
            : '');
            
    expectedDivEl.textContent = `${formatCurrency(totalExpectedAnnualDiv)} / 년 (월평균 ${formatCurrency(totalExpectedAnnualDiv / 12)})`;
    avgYieldEl.textContent = `${avgYield.toFixed(2)}% (매수 원금 대비)`;
    
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
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 1.5rem;">배당금 지급 기록이 없습니다.</td></tr>';
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
                    label: '수령 배당금',
                    data: receivedData,
                    backgroundColor: 'rgba(99, 102, 241, 0.75)',
                    borderColor: '#6366f1',
                    borderWidth: 1,
                    borderRadius: 4,
                    yAxisID: 'y'
                },
                {
                    label: '배당수익률 (%)',
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
                        text: '수령 배당금',
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
                        text: '배당수익률 (%)',
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
        
        select.innerHTML = '<option value="">종목 선택</option>';
        loggedStockIds.forEach(id => {
            if (id.startsWith('etc-')) {
                const accId = id.replace('etc-', '');
                const acc = state.accounts.find(a => a.id === accId);
                const accName = acc ? acc.name : '기타';
                const option = document.createElement('option');
                option.value = id;
                option.textContent = `[${accName}] 기타 (ETC)`;
                select.appendChild(option);
                return;
            }
            
            const stock = state.portfolio.find(p => p.id === id);
            if (stock) {
                const acc = state.accounts.find(a => a.id === stock.accountId);
                const accName = acc ? acc.name : '미지정 계좌';
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
            const accName = acc ? acc.name : '미지정 계좌';
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
        startDpsEl.textContent = '기록 없음';
        endDpsEl.textContent = '기록 없음';
        rateEl.textContent = '-';
        rateEl.className = 'kpi-trend';
        return;
    }
    
    if (dpsData.length === 1) {
        periodEl.textContent = '1회 지급됨';
        const item = dpsData[0];
        startDpsEl.textContent = formatCurrency(item.dps, item.currency);
        endDpsEl.textContent = formatCurrency(item.dps, item.currency);
        rateEl.textContent = '추세 분석 불가 (최소 2회 필요)';
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
    periodEl.textContent = `${formatDate(firstDate)} ~ ${formatDate(lastDate)} (${Math.round(daysDiff)}일)`;
    
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
    
    startDpsEl.textContent = `${formatCurrency(dpsStartEst, currency)} (추세선)`;
    endDpsEl.textContent = `${formatCurrency(dpsEndEst, currency)} (추세선)`;
    
    const totalGrowth = dpsStartEst > 0 ? ((dpsEndEst - dpsStartEst) / dpsStartEst) * 100 : 0;
    const cagr = (Math.exp(beta) - 1) * 100;
    
    const sign = totalGrowth >= 0 ? '+' : '';
    const cagrSign = cagr >= 0 ? '+' : '';
    const plClass = totalGrowth >= 0 ? 'positive' : 'negative';
    
    if (daysDiff < 90) {
        rateEl.textContent = `${sign}${totalGrowth.toFixed(2)}% (단기 추세 성장률)`;
    } else {
        rateEl.textContent = `${sign}${totalGrowth.toFixed(1)}% (연평균 CAGR: ${cagrSign}${cagr.toFixed(2)}%)`;
    }
    rateEl.className = `kpi-trend ${plClass}`;
}

let simChartObj = null;

function getValInStockCurrency(amountInActiveCurrency, stockCurrency) {
    const activeCurrency = state.activeCurrency || 'KRW';
    if (activeCurrency === stockCurrency) return amountInActiveCurrency;
    
    if (activeCurrency === 'KRW' && stockCurrency === 'USD') {
        return amountInActiveCurrency / (state.currentExchangeRate || FALLBACK_EXCHANGE_RATE);
    } else {
        return amountInActiveCurrency * (state.currentExchangeRate || FALLBACK_EXCHANGE_RATE);
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
    trendIncrementEl.textContent = `+${formatCurrency(delta)} / 월`;
    
    // 5. Update labels dynamically depending on selected basis
    const labelEl = document.getElementById('fcTrendLabel');
    if (labelEl) {
        if (basis === 'actual') {
            labelEl.textContent = '최근 3개월간 배당 실수령액 증가추세 (월평균)';
        } else {
            labelEl.textContent = '최근 3개월간 배당 체력(배당력) 증가추세 (월평균)';
        }
    }

    const descEl = document.querySelector('#fcTrendIncrement + p');
    if (descEl) {
        if (basis === 'actual') {
            descEl.textContent = '* 최근 3개월간 실제 수령한 총 배당금의 월평균 증가율을 바탕으로 미래 배당 현금 흐름을 선형으로 예측합니다. (지급 주기에 따른 월별 변동성이 반영될 수 있습니다.)';
        } else {
            descEl.textContent = '* 최근 3개월 동안 매수 등을 통해 포트폴리오의 월배당 생성 능력(배당력)이 매달 평균적으로 얼마나 증가했는지를 바탕으로 선형 예측합니다.';
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
            <td style="padding: 0.4rem 0;">${m}개월 후</td>
            <td style="padding: 0.4rem 0; text-align: right; font-weight: 600; color: var(--primary);">${formatCurrency(projectedVal)}</td>
        `;
        tbody.appendChild(row);
    }
}

// ============================================================================
// AI 어시스턴트 챗봇 기능 (Gemini API 연동)
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
            statusDot.title = 'API 키가 설정되었습니다 (온라인)';
        } else {
            statusDot.className = 'status-dot offline';
            statusDot.title = 'API 키 미설정 (오프라인)';
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
        showToast('Gemini API Key가 저장되었습니다.', 'success');
        
        appendMessage('system', 'API Key가 성공적으로 업데이트되었습니다. 이제 분석을 시작할 수 있습니다!');
    });

    // Chat Message append helper
    const appendMessage = (sender, text) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${sender}`;
        msgDiv.innerHTML = text.replace(/\n/g, '<br>');
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return msgDiv;
    };

    // Construct the LLM Context Prompt
    const buildPromptContext = () => {
        const activeCurrency = state.activeCurrency || 'KRW';
        const exchangeRate = state.currentExchangeRate || 1535;

        // Simplify portfolio and logs for context window optimization
        const simplifiedPortfolio = state.portfolio.map(s => {
            const acc = state.accounts.find(a => a.id === s.accountId);
            return {
                id: s.id,
                account: acc ? acc.name : '미지정',
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
                ticker: stock ? stock.ticker : '기타',
                name: stock ? stock.name : '기타',
                amount: l.amount,
                currency: l.currency,
                amountKRW: l.amountKRW
            };
        });

        return `역할: 배당 성장 투자 전문 금융 AI 어시스턴트
사용자의 언어: 한국어

현재 사용자의 포트폴리오 데이터 정보:
- 표시 통화: ${activeCurrency}
- 적용 환율: ${exchangeRate} KRW/USD
- 등록 계좌 목록: ${JSON.stringify(state.accounts)}
- 보유 주식 포트폴리오: ${JSON.stringify(simplifiedPortfolio)}
- 최근 15개 배당금 수령 내역: ${JSON.stringify(simplifiedLogs)}

미션:
1. 사용자의 배당 현황 분석, 특정 종목 추천, 예상 배당 및 포트폴리오 조언 요구에 상세하게 답합니다.
2. 만약 사용자가 대화로 새로운 주식 취득이나 배당금 수령을 기록해달라고 요청할 경우(예: "오늘 SCHD 10주 78달러에 샀어 기록해줘" 또는 "어제 리얼티인컴 배당 세전 39달러 받았어 적어줘"), 해당 명령을 실제 포트폴리오 앱에 기록하기 위해 답변 가장 마지막 줄에 정확한 양식의 JSON 액션 블록을 유일하게 포함시켜야 합니다.

액션 가능한 JSON 포맷 종류 (답변 맨 마지막 줄에 단 하나만 출력해야 함):
1. 추가 매수 기록 (buy_more):
{"action": "buy_more", "ticker": "SCHD", "shares": 10, "price": 78.2, "date": "2026-06-28"}

2. 배당금 수령 기록 (record_dividend):
{"action": "record_dividend", "ticker": "O", "amount": 39.0, "tax": 5.85, "date": "2026-06-28", "currency": "USD"}

주의사항: 
- JSON 액션 포맷을 출력할 때는 사용자가 명확하게 '기록해줘', '적어줘', '반영해줘'라고 지시했을 때만 사용합니다.
- 날짜(date)가 없으면 오늘 날짜(현지 기준: ${new Date().toISOString().split('T')[0]})로 기본 기입합니다.
- 종목은 사용자가 제공한 한글명이나 티커를 활용해 포트폴리오에서 매칭하십시오.
- 답변은 전문적이고 친근한 어조로 작성해 주세요.`;
    };

    // Process LLM Response JSON Action
    const parseAndExecuteAction = (text) => {
        // Find JSON block in response
        const jsonMatch = text.match(/\{"action"\s*:\s*"[^"]+".*?\}/s);
        if (!jsonMatch) return null;

        try {
            const actionData = JSON.parse(jsonMatch[0]);
            
            if (actionData.action === 'buy_more') {
                const { ticker, shares, price, date } = actionData;
                const stock = state.portfolio.find(p => p.ticker.toUpperCase() === ticker.toUpperCase() || p.name.includes(ticker));
                if (!stock) {
                    return `⚠️ 포트폴리오에 등록되지 않은 종목(${ticker})입니다. 추가 매수를 기록하려면 먼저 자산관리 메뉴에서 해당 종목을 포트폴리오에 추가해 주세요.`;
                }

                const buyDate = date || new Date().toISOString().split('T')[0];
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
                return `✅ **자동 추가매수 기입 성공**\n종목: ${stock.name} (${stock.ticker})\n추가 수량: +${shares}주 (총 보유: ${newTotalShares}주)\n수정된 평단가: ${formatCurrency(stock.avgPrice, stock.currency)}`;
            }

            if (actionData.action === 'record_dividend') {
                const { ticker, amount, tax, date, currency } = actionData;
                const stock = state.portfolio.find(p => p.ticker.toUpperCase() === ticker.toUpperCase() || p.name.includes(ticker));
                if (!stock) {
                    return `⚠️ 포트폴리오에 등록되지 않은 종목(${ticker})입니다. 배당을 수령하려면 종목이 먼저 포트폴리오에 추가되어 있어야 합니다.`;
                }

                const logDate = date || new Date().toISOString().split('T')[0];
                const logCurrency = currency || stock.currency;
                const logTax = parseFloat(tax) || 0;
                const logAmount = parseFloat(amount);
                
                const rate = logCurrency === 'USD' ? (state.currentExchangeRate || FALLBACK_EXCHANGE_RATE) : 1;
                const amountKRW = logCurrency === 'USD' ? logAmount * rate : logAmount;

                const newLog = {
                    id: 'log-' + Date.now(),
                    date: logDate,
                    portfolioId: stock.id,
                    amount: logAmount,
                    tax: logTax,
                    currency: logCurrency,
                    exchangeRate: rate,
                    amountKRW: amountKRW
                };
                state.dividendLogs.push(newLog);
                state.dividendLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
                
                saveState();
                renderAll();
                return `✅ **자동 배당수령 기입 성공**\n종목: ${stock.name} (${stock.ticker})\n수령 배당금: ${formatCurrency(logAmount, logCurrency)} (세전)\n수령 기준일: ${logDate}`;
            }
        } catch (e) {
            console.error("Action execution error:", e);
            return "⚠️ AI가 기입을 시도했으나 명령 형식이 올바르지 않아 반영하지 못했습니다.";
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
            appendMessage('ai', '죄송합니다. 배당 비서를 사용하려면 우상단의 **열쇠 아이콘**을 클릭해 **Google Gemini API Key**를 설정해 주셔야 합니다.');
            return;
        }

        // Add typing indicator
        const typingIndicator = appendMessage('ai', '비서가 생각 중입니다...');

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
                            parts: [{ text: `${context}\n\n사용자 문의: ${userText}` }]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.2
                    }
                })
            });

            if (!response.ok) {
                throw new Error('API 요청 실패');
            }

            const data = await response.json();
            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '죄송합니다. 답변을 생성하지 못했습니다.';

            // Remove typing indicator
            messagesContainer.removeChild(typingIndicator);

            // Strip the JSON block from user visibility (optional, but cleaner)
            let cleanText = rawText.replace(/\{"action"\s*:\s*"[^"]+".*?\}/s, '').trim();
            
            // Append AI response bubble
            appendMessage('ai', cleanText);

            // Process and execute any parsed JSON action
            const actionResult = parseAndExecuteAction(rawText);
            if (actionResult) {
                appendMessage('system', actionResult);
            }

        } catch (error) {
            console.error("AI Assistant Error:", error);
            messagesContainer.removeChild(typingIndicator);
            appendMessage('ai', '⚠️ 서버와 통신하는 동안 에러가 발생했습니다. API 키가 유효한지 확인하고 잠시 후 다시 시도해 주세요.');
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
// PWA 서비스 워커 및 구글 드라이브 클라우드 동기화 기능
// ============================================================================

// PWA 서비스 워커 등록
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('[PWA] Service Worker registered successfully.'))
            .catch(err => console.error('[PWA] Service Worker registration failed:', err));
    });
}

let gDriveTokenClient = null;
let gDriveAccessToken = null;
let gDriveFileId = null;

function setupGDriveSync() {
    const inputClientId = document.getElementById('gDriveClientId');
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

    const updateUI = (isLoggedIn, accountText = '연동되어 있지 않음') => {
        if (isLoggedIn) {
            btnLogin.style.display = 'none';
            btnLogout.style.display = 'inline-flex';
            txtAccount.textContent = accountText;
            btnPull.disabled = false;
            btnPush.disabled = false;
            if (statusDot) {
                statusDot.className = 'status-dot online';
                statusDot.title = `구글 연동됨 (${accountText})`;
            }
        } else {
            btnLogin.style.display = 'inline-flex';
            btnLogout.style.display = 'none';
            txtAccount.textContent = '연동되어 있지 않음';
            btnPull.disabled = true;
            btnPush.disabled = true;
            if (statusDot) {
                statusDot.className = 'status-dot offline';
                statusDot.title = '구글 미연동';
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
                        showToast('구글 연동 실패: ' + resp.error, 'danger');
                        updateUI(false);
                        updateLog('연동 실패: ' + resp.error);
                        return;
                    }
                    
                    gDriveAccessToken = resp.access_token;
                    localStorage.setItem('gdrive_logged_in', 'true');
                    updateLog('인증 완료. API 라이브러리 로딩 중...');

                    // Load gapi client
                    if (typeof gapi !== 'undefined') {
                        gapi.load('client', async () => {
                            gapi.client.setToken({ access_token: gDriveAccessToken });
                            try {
                                await gapi.client.load('drive', 'v3');
                                
                                // Query drive info to fetch account name
                                const about = await gapi.client.drive.about.get({ fields: 'user' });
                                const email = about.result?.user?.emailAddress || '구글 계정';
                                updateUI(true, email);
                                updateLog('성공적으로 연동되었습니다.');
                                
                                // Auto pull on first login
                                await pullStateFromGDrive();
                            } catch (e) {
                                console.error(e);
                                updateUI(true, '연동 완료');
                                updateLog('연동 성공 (계정 조회 제한됨)');
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
        if (!clientId) {
            localStorage.removeItem('gdrive_client_id');
            showToast('클라이언트 ID가 해제되었습니다.', 'success');
            updateUI(false);
            return;
        }

        localStorage.setItem('gdrive_client_id', clientId);
        initTokenClient(clientId);
        showToast('구글 클라이언트 ID가 저장되었습니다.', 'success');
        updateLog('클라이언트 ID 저장됨. 로그인을 진행해 주세요.');
        document.querySelectorAll('.modal-backdrop').forEach(modal => modal.classList.remove('open'));
    });

    // Login Action
    btnLogin.addEventListener('click', () => {
        const clientId = localStorage.getItem('gdrive_client_id');
        if (!clientId) {
            alert('구글 로그인 전 1단계에서 Client ID를 먼저 설정하고 설정 완료 버튼을 눌러주세요.');
            return;
        }
        if (!gDriveTokenClient) {
            initTokenClient(clientId);
        }
        if (gDriveTokenClient) {
            gDriveTokenClient.requestAccessToken({ prompt: 'consent' });
        } else {
            alert('구글 API가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
        }
    });

    // Logout Action
    btnLogout.addEventListener('click', () => {
        if (gDriveAccessToken && window.google) {
            google.accounts.oauth2.revoke(gDriveAccessToken);
        }
        gDriveAccessToken = null;
        gDriveFileId = null;
        localStorage.removeItem('gdrive_logged_in');
        updateUI(false);
        updateLog('연동이 해제되었습니다.');
        showToast('구글 계정 연동을 해제했습니다.', 'success');
    });

    // Manual PULL
    btnPull.addEventListener('click', async () => {
        await pullStateFromGDrive();
    });

    // Manual PUSH
    btnPush.addEventListener('click', async () => {
        await pushStateToGDrive();
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
                    updateLog('자동 연동 재연결 중...');
                    gDriveTokenClient.requestAccessToken({ prompt: '' }); // Silent token request
                }
            }, 1000);
        });
    }
}

// Push local state to Google Drive (Auto-save)
async function pushStateToGDrive() {
    if (!gDriveAccessToken) return;

    try {
        const boundary = 'foo_bar_baz';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const close_delim = "\r\n--" + boundary + "--";
        
        const metadata = {
            'name': 'portfolio_state.json',
            'mimeType': 'application/json'
        };
        
        const data = JSON.stringify(state, null, 2);
        const syncLog = document.getElementById('gDriveSyncLog');
        
        if (syncLog) syncLog.textContent = '클라우드에 저장 중...';

        // Search for existing file first if fileId is not cached
        if (!gDriveFileId && typeof gapi !== 'undefined' && gapi.client && gapi.client.drive) {
            try {
                const response = await gapi.client.drive.files.list({
                    spaces: 'appDataFolder',
                    q: "name = 'portfolio_state.json'",
                    fields: 'files(id, name)',
                    pageSize: 1
                });
                const files = response.result.files;
                if (files && files.length > 0) {
                    gDriveFileId = files[0].id;
                }
            } catch (e) {
                console.error("Error listing files on push:", e);
            }
        }

        let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        let method = 'POST';

        if (gDriveFileId) {
            url = `https://www.googleapis.com/upload/drive/v3/files/${gDriveFileId}?uploadType=multipart`;
            method = 'PATCH';
        } else {
            metadata.parents = ['appDataFolder'];
        }

        const multipartRequestBody =
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            data +
            close_delim;

        const res = await fetch(url, {
            method: method,
            headers: {
                'Authorization': 'Bearer ' + gDriveAccessToken,
                'Content-Type': 'multipart/related; boundary=' + boundary
            },
            body: multipartRequestBody
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error("GDrive upload failed details:", res.status, errorText);
            throw new Error(`클라우드 업로드 실패 (${res.status}): ${errorText}`);
        }

        const file = await res.json();
        if (file.id) {
            gDriveFileId = file.id;
        }

        const timeStr = new Date().toLocaleTimeString();
        if (syncLog) syncLog.textContent = `구글 드라이브 실시간 저장 완료 (${timeStr})`;
    } catch (err) {
        console.error('GDrive push error:', err);
        const syncLog = document.getElementById('gDriveSyncLog');
        if (syncLog) syncLog.textContent = '저장 실패: ' + err.message;
    }
}

// Pull cloud state from Google Drive and merge
async function pullStateFromGDrive() {
    if (!gDriveAccessToken) return;

    try {
        const syncLog = document.getElementById('gDriveSyncLog');
        if (syncLog) syncLog.textContent = '클라우드 데이터 조회 중...';

        const response = await gapi.client.drive.files.list({
            spaces: 'appDataFolder',
            q: "name = 'portfolio_state.json'",
            fields: 'files(id, name)',
            pageSize: 1
        });

        const files = response.result.files;
        if (!files || files.length === 0) {
            if (syncLog) syncLog.textContent = '클라우드 데이터 없음. 로컬 데이터로 파일 생성 중...';
            await pushStateToGDrive();
            return;
        }

        gDriveFileId = files[0].id;

        const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${gDriveFileId}?alt=media`, {
            headers: {
                'Authorization': 'Bearer ' + gDriveAccessToken
            }
        });

        if (!fileRes.ok) {
            const errorText = await fileRes.text();
            console.error("GDrive download failed details:", fileRes.status, errorText);
            throw new Error(`파일 다운로드 에러 (${fileRes.status}): ${errorText}`);
        }

        const cloudState = await fileRes.json();
        if (cloudState && (cloudState.portfolio || cloudState.dividendLogs)) {
            // Overwrite local state since cloud state is the central source of truth
            state = { ...state, ...cloudState };
            
            // Temporarily disable auto-save callback during load to prevent infinite loop
            const oldPush = gDriveAccessToken;
            gDriveAccessToken = null;
            
            localStorage.setItem('dividend_tracker_state', JSON.stringify(state));
            renderAll();
            
            // Restore token
            gDriveAccessToken = oldPush;

            const timeStr = new Date().toLocaleTimeString();
            if (syncLog) syncLog.textContent = `최근 동기화: ${timeStr} (클라우드 데이터 로드 완료)`;
            showToast('구글 드라이브 최신 데이터를 로컬에 동기화했습니다.', 'success');
        }
    } catch (err) {
        console.error('GDrive pull error:', err);
        const syncLog = document.getElementById('gDriveSyncLog');
        if (syncLog) syncLog.textContent = '다운로드 실패: ' + err.message;
    }
}

// Trigger initialization on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    setupGDriveSync();
});


