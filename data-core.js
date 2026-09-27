(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.DividendCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const SCHEMA_VERSION = 2;
    const LEDGER_FIELDS = ['accounts', 'portfolio', 'dividendLogs', 'shareHistory'];

    function isPositiveNumber(value) {
        return value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
    }

    function isPresentNumber(value) {
        return value !== null && value !== '' && Number.isFinite(Number(value));
    }

    function localDateString(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function makeStockKey(ticker, currency) {
        return `${String(ticker || '').trim().toUpperCase()}|${String(currency || '').trim().toUpperCase()}`;
    }

    function normalizeHistoricalRateEntry(value, requestedDate) {
        if (isPositiveNumber(value)) {
            return {
                status: 'success',
                rate: Number(value),
                requestedDate,
                rateDate: null,
                source: 'legacy-cache',
                basisKnown: false,
                fetchedAt: null
            };
        }
        if (!value || typeof value !== 'object' || !isPositiveNumber(value.rate)) return null;
        return {
            status: 'success',
            rate: Number(value.rate),
            requestedDate: value.requestedDate || requestedDate,
            rateDate: value.rateDate || value.date || requestedDate,
            source: value.source || 'Frankfurter',
            basisKnown: value.basisKnown !== false,
            fetchedAt: value.fetchedAt || null
        };
    }

    function migrateDividendLog(log) {
        const next = { ...log };
        next.amount = Number(log.amount) || 0;
        next.tax = Number(log.tax) || 0;
        next.exchangeRate = isPositiveNumber(log.exchangeRate)
            ? Number(log.exchangeRate)
            : (log.currency === 'KRW' ? 1 : null);

        // Existing amountKRW is an already-confirmed historical value. Never recompute it.
        if (isPresentNumber(log.amountKRW)) {
            next.amountKRW = Number(log.amountKRW);
        } else if (log.currency === 'KRW') {
            next.amountKRW = next.amount;
        } else if (isPositiveNumber(next.exchangeRate)) {
            next.amountKRW = next.amount * next.exchangeRate;
        } else {
            next.amountKRW = null;
        }

        // A stored KRW amount is authoritative, but old rows did not preserve the
        // provider's actual FX basis date. Keep that provenance unknown.
        next.exchangeRateDate = log.exchangeRateDate || null;
        next.exchangeRateSource = log.exchangeRateSource || (log.currency === 'USD' ? 'legacy-confirmed' : 'not-applicable');
        next.exchangeRateRequestedDate = log.exchangeRateRequestedDate || log.date || null;
        next.exchangeRateIsFallback = log.exchangeRateIsFallback === true;

        if (isPresentNumber(log.netAmountKRW)) {
            next.netAmountKRW = Number(log.netAmountKRW);
        } else if (Number.isFinite(next.amountKRW)) {
            const taxRate = log.currency === 'USD' ? next.exchangeRate : 1;
            next.netAmountKRW = isPositiveNumber(taxRate)
                ? next.amountKRW - (next.tax * Number(taxRate))
                : null;
        } else {
            next.netAmountKRW = null;
        }
        next.netAmount = isPresentNumber(log.netAmount) ? Number(log.netAmount) : next.amount - next.tax;
        return next;
    }

    function migrateStockPrices(prices, portfolio) {
        const next = {};
        Object.entries(prices || {}).forEach(([key, entry]) => {
            if (!entry || typeof entry !== 'object') return;
            if (key.includes('|')) {
                next[key] = { ...entry };
                return;
            }
            const matches = (portfolio || []).filter(stock =>
                String(stock.ticker || '').toUpperCase() === String(key).toUpperCase() &&
                (!entry.currency || String(stock.currency).toUpperCase() === String(entry.currency).toUpperCase())
            );
            if (matches.length > 0) {
                matches.forEach(stock => { next[makeStockKey(stock.ticker, stock.currency)] = { ...entry }; });
            } else {
                next[key] = { ...entry };
            }
        });
        return next;
    }

    function migrateState(rawState, baseState = {}) {
        const raw = rawState && typeof rawState === 'object' ? rawState : {};
        const next = { ...baseState, ...raw };
        LEDGER_FIELDS.forEach(field => {
            next[field] = Array.isArray(raw[field]) ? raw[field].map(item => ({ ...item })) : (Array.isArray(baseState[field]) ? baseState[field] : []);
        });
        next.dividendLogs = next.dividendLogs.map(migrateDividendLog);
        next.exchangeRateCache = {};
        Object.entries(raw.exchangeRateCache || {}).forEach(([date, value]) => {
            const normalized = normalizeHistoricalRateEntry(value, date);
            if (normalized) next.exchangeRateCache[date] = normalized;
        });
        next.stockPrices = migrateStockPrices(raw.stockPrices || {}, next.portfolio);
        next.currentExchangeRate = isPositiveNumber(raw.currentExchangeRate) ? Number(raw.currentExchangeRate) : null;
        next.currentExchangeRateMeta = {
            status: next.currentExchangeRate ? 'cached' : 'idle',
            rate: next.currentExchangeRate,
            provider: null,
            asOf: null,
            fetchedAt: null,
            nextUpdateAt: null,
            error: null,
            ...(raw.currentExchangeRateMeta || {})
        };
        next.priceUpdateStatus = {
            lastAttemptAt: raw.lastPriceAttempt || null,
            lastSuccessAt: raw.lastPriceUpdate || null,
            successCount: 0,
            failCount: 0,
            ...(raw.priceUpdateStatus || {})
        };
        next.lastPriceUpdate = next.priceUpdateStatus.lastSuccessAt || raw.lastPriceUpdate || null;
        next.schemaVersion = SCHEMA_VERSION;
        next.syncMeta = {
            localRevision: 0,
            updatedAt: null,
            ...(raw.syncMeta || {})
        };
        return next;
    }

    function getDividendKRW(log, basis = 'gross') {
        const migrated = migrateDividendLog(log || {});
        if (basis === 'net') return isPresentNumber(migrated.netAmountKRW) ? migrated.netAmountKRW : null;
        return isPresentNumber(migrated.amountKRW) ? migrated.amountKRW : null;
    }

    function getDividendValue(log, activeCurrency, currentExchangeRate, basis = 'gross') {
        const migrated = migrateDividendLog(log || {});
        if (activeCurrency === 'KRW') return getDividendKRW(migrated, basis);
        if (activeCurrency === 'USD' && migrated.currency === 'USD') {
            return basis === 'net' ? migrated.netAmount : migrated.amount;
        }
        const krw = getDividendKRW(migrated, basis);
        return krw !== null && isPositiveNumber(currentExchangeRate) ? krw / Number(currentExchangeRate) : null;
    }

    function createCloudLedgerSnapshot(state) {
        const snapshot = {
            schemaVersion: SCHEMA_VERSION,
            syncMeta: { ...(state.syncMeta || {}) }
        };
        LEDGER_FIELDS.forEach(field => { snapshot[field] = (state[field] || []).map(item => ({ ...item })); });
        return snapshot;
    }

    function mergeCloudLedger(localState, cloudState) {
        const next = { ...localState };
        LEDGER_FIELDS.forEach(field => {
            if (Array.isArray(cloudState?.[field])) next[field] = cloudState[field].map(item => ({ ...item }));
        });
        next.dividendLogs = (next.dividendLogs || []).map(migrateDividendLog);
        next.schemaVersion = SCHEMA_VERSION;
        next.syncMeta = { ...(next.syncMeta || {}), ...(cloudState?.syncMeta || {}) };
        return next;
    }

    function getPriceFreshness(entry, now = new Date()) {
        if (!entry || !isPositiveNumber(entry.price)) return { available: false, stale: true, ageMs: null };
        const timestamp = entry.quoteTimestamp || entry.lastUpdated || entry.fetchedAt;
        const then = timestamp ? new Date(timestamp) : null;
        if (!then || Number.isNaN(then.getTime())) return { available: true, stale: true, ageMs: null };
        const ageMs = Math.max(0, now.getTime() - then.getTime());
        const day = now.getDay();
        const maxAgeMs = (day === 0 || day === 1 || day === 6) ? 96 * 60 * 60 * 1000 : 36 * 60 * 60 * 1000;
        return { available: true, stale: ageMs > maxAgeMs, ageMs };
    }

    function validatePriceQuote(meta, requestedSymbol, requestedCurrency) {
        const price = Number(meta?.regularMarketPrice ?? meta?.price);
        if (!isPositiveNumber(price)) return null;
        const symbol = String(meta?.symbol || '').toUpperCase();
        const currency = String(meta?.currency || '').toUpperCase();
        if (!symbol || symbol !== String(requestedSymbol || '').toUpperCase()) return null;
        if (!currency || currency !== String(requestedCurrency || '').toUpperCase()) return null;
        return { price, symbol, currency };
    }

    function shouldApplyHistoricalRateResponse(context) {
        return Number(context?.requestId) === Number(context?.latestRequestId) &&
            String(context?.requestedDate || '') === String(context?.currentDate || '') &&
            String(context?.currentCurrency || '').toUpperCase() === 'USD' &&
            Number(context?.manualVersionBefore) === Number(context?.manualVersionNow);
    }

    return {
        SCHEMA_VERSION,
        LEDGER_FIELDS,
        isPositiveNumber,
        isPresentNumber,
        localDateString,
        makeStockKey,
        normalizeHistoricalRateEntry,
        migrateDividendLog,
        migrateState,
        getDividendKRW,
        getDividendValue,
        createCloudLedgerSnapshot,
        mergeCloudLedger,
        getPriceFreshness,
        validatePriceQuote,
        shouldApplyHistoricalRateResponse
    };
});
