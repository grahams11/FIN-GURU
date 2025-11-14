/**
 * Live Data Adapter
 * 
 * Intelligent data routing layer that switches between live WebSocket data
 * and historical data based on market status. Provides unified interface
 * for Elite Scanner with sub-3s performance target.
 * 
 * Architecture:
 * - Market OPEN: Use Polygon WebSocket cache for live quotes
 * - Market CLOSED: Use historicalDataService for previous day data
 * - Technical Indicators: Hybrid intraday buffer + historical bars
 * - Options Analytics: Polygon REST with 30-60s caching
 */

import { polygonService } from './polygonService';
import { historicalDataService } from './historicalDataService';
import { marketStatusService } from './marketStatusService';

// ===== INTERFACES =====

export interface MarketContext {
  isLive: boolean;
  marketStatus: 'open' | 'closed' | 'pre-market' | 'after-hours';
  timestamp: Date;
  nextTransition?: Date; // When market opens/closes next
}

export interface QuoteSnapshot {
  symbol: string;
  price: number;
  bidPrice: number;
  askPrice: number;
  volume: number;
  timestamp: number;
  source: 'websocket' | 'historical' | 'fallback';
  isStale: boolean;
}

export interface PriceBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorBundle {
  symbol: string;
  rsi: number;
  rsiPrevious: number;
  ema20: number;
  atrShort: number; // 5-period ATR
  atrLong: number; // 30-period ATR
  currentPrice: number;
  bars: PriceBar[];
  source: 'live' | 'historical';
  calculatedAt: number;
}

export interface OptionsAnalytics {
  symbol: string;
  strike: number;
  expiry: string;
  optionType: 'call' | 'put';
  
  // Greeks
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  
  // Volatility metrics
  impliedVolatility: number;
  ivPercentile: number; // 0-100 based on 52-week range
  
  // Volume metrics
  volume: number;
  openInterest: number;
  avgVolume20Day: number;
  volumeRatio: number; // current / avg (>3 = unusual)
  
  // Pricing
  bid: number;
  ask: number;
  lastPrice: number;
  premium: number; // Mid-price: (bid + ask) / 2, fallback to lastPrice
  
  // Metadata
  timestamp: number;
  source: 'polygon-rest';
  cacheAge: number; // seconds since fetch
  error?: string;
}

// ===== CACHING STRUCTURES =====

interface CachedOptionsData {
  data: OptionsAnalytics;
  fetchedAt: number;
}

// ===== SERVICE =====

export class LiveDataAdapter {
  private static instance: LiveDataAdapter | null = null;
  
  // Caching
  private optionsCache = new Map<string, CachedOptionsData>();
  
  private readonly OPTIONS_CACHE_DURATION_MS = 60_000; // 60 seconds
  private readonly QUOTE_FRESHNESS_THRESHOLD_MS = 10_000; // 10 seconds
  
  private constructor() {}
  
  static getInstance(): LiveDataAdapter {
    if (!LiveDataAdapter.instance) {
      LiveDataAdapter.instance = new LiveDataAdapter();
    }
    return LiveDataAdapter.instance;
  }
  
  // ===== MARKET CONTEXT =====
  
  /**
   * Get current market context (open/closed status)
   */
  getMarketContext(): MarketContext {
    const status = marketStatusService.getMarketStatus();
    
    return {
      isLive: status.isOpen,
      marketStatus: status.isOpen ? 'open' : 'closed',
      timestamp: status.currentTime,
      nextTransition: status.isOpen ? status.nextCloseTime : status.nextOpenTime
    };
  }
  
  // ===== STOCK QUOTES =====
  
  /**
   * Get current stock quote (routes to live WebSocket or historical)
   */
  async getQuote(symbol: string): Promise<QuoteSnapshot> {
    const isLive = marketStatusService.isMarketOpen();
    
    if (isLive) {
      // CRITICAL FIX: Subscribe symbol to WebSocket for LIVE quotes
      // This ensures we get real-time data, not stale historical data
      polygonService.subscribeToSymbols([symbol]);
      
      // Wait briefly for WebSocket to populate cache (50ms should be enough)
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Get LIVE quote from WebSocket cache
      const wsQuote = polygonService.getQuote(symbol);
      
      if (wsQuote && this.isQuoteFresh(wsQuote.timestamp)) {
        return {
          symbol,
          price: wsQuote.lastPrice,
          bidPrice: wsQuote.bidPrice,
          askPrice: wsQuote.askPrice,
          volume: wsQuote.volume || 0,
          timestamp: wsQuote.timestamp,
          source: 'websocket',
          isStale: false
        };
      }
      
      // Fallback to cached quote if WebSocket hasn't received data yet
      const restQuote = await polygonService.getCachedQuote(symbol);
      if (restQuote) {
        return {
          symbol,
          price: restQuote.lastPrice,
          bidPrice: restQuote.bidPrice,
          askPrice: restQuote.askPrice,
          volume: restQuote.volume || 0,
          timestamp: Date.now(),
          source: 'fallback',
          isStale: false
        };
      }
    }
    
    // Market closed - use historical data
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = this.getDateDaysAgo(5); // Last 5 days
    
    const bars = await historicalDataService.getDailyBars(symbol, startDate, endDate, true, true);
    
    if (bars.length > 0) {
      const lastBar = bars[bars.length - 1];
      return {
        symbol,
        price: lastBar.close,
        bidPrice: lastBar.close,
        askPrice: lastBar.close,
        volume: lastBar.volume,
        timestamp: lastBar.timestamp,
        source: 'historical',
        isStale: !isLive // Not stale if market is closed
      };
    }
    
    // Ultimate fallback - return zero data with error flag
    return {
      symbol,
      price: 0,
      bidPrice: 0,
      askPrice: 0,
      volume: 0,
      timestamp: Date.now(),
      source: 'fallback',
      isStale: true
    };
  }
  
  // ===== TECHNICAL INDICATORS =====
  
  /**
   * Get indicator bundle (RSI, EMA, ATR) with hybrid live+historical bars
   */
  async getIndicatorBundle(symbol: string, period: number = 14): Promise<IndicatorBundle | null> {
    try {
      // Fetch historical bars (need enough for calculation)
      const daysNeeded = Math.max(period * 2, 50); // Extra days for warmup
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = this.getDateDaysAgo(daysNeeded);
      
      const bars = await historicalDataService.getDailyBars(symbol, startDate, endDate, true, true);
      
      if (bars.length < period) {
        console.warn(`⚠️ Insufficient bars for ${symbol}: ${bars.length} < ${period}`);
        return null;
      }
      
      // Get current price (live if market open)
      const currentQuote = await this.getQuote(symbol);
      
      // Calculate technical indicators
      const closes = bars.map(b => b.close);
      const highs = bars.map(b => b.high);
      const lows = bars.map(b => b.low);
      
      const rsi = this.calculateRSI(closes, period);
      const rsiPrevious = closes.length > period ? this.calculateRSI(closes.slice(0, -1), period) : rsi;
      const ema20 = this.calculateEMA(closes, 20);
      const atrShort = this.calculateATR(highs, lows, closes, 5);
      const atrLong = this.calculateATR(highs, lows, closes, 30);
      
      return {
        symbol,
        rsi,
        rsiPrevious,
        ema20,
        atrShort,
        atrLong,
        currentPrice: currentQuote.price,
        bars: bars.map(b => ({
          timestamp: b.timestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume
        })),
        source: currentQuote.source === 'websocket' ? 'live' : 'historical',
        calculatedAt: Date.now()
      };
    } catch (error: any) {
      console.error(`Failed to calculate indicators for ${symbol}:`, error.message);
      return null;
    }
  }
  
  // ===== OPTIONS ANALYTICS =====
  
  /**
   * Get options analytics with caching (30-60s cache)
   * Uses PolygonService methods for data fetching
   */
  async getOptionsAnalytics(symbol: string, optionType: 'call' | 'put' = 'call'): Promise<OptionsAnalytics | null> {
    const cacheKey = `${symbol}_${optionType}`;
    
    // Check cache
    const cached = this.optionsCache.get(cacheKey);
    if (cached && (Date.now() - cached.fetchedAt) < this.OPTIONS_CACHE_DURATION_MS) {
      cached.data.cacheAge = Math.floor((Date.now() - cached.fetchedAt) / 1000);
      return cached.data;
    }
    
    try {
      // Fetch Greeks and IV from PolygonService
      const greeks = await polygonService.getOptionsGreeks(symbol, optionType);
      
      if (!greeks) {
        console.warn(`⚠️ No options data for ${symbol}`);
        return null;
      }
      
      // Get IV percentile from PolygonService
      const ivPercentileData = await polygonService.getIVPercentile(symbol, greeks.impliedVolatility);
      
      // Get unusual volume data from PolygonService
      const volumeData = await polygonService.getUnusualOptionsVolume(symbol, optionType);
      
      const analytics: OptionsAnalytics = {
        symbol,
        strike: greeks.strike,
        expiry: greeks.expiry,
        optionType,
        
        // Greeks
        delta: greeks.delta,
        gamma: greeks.gamma,
        theta: greeks.theta,
        vega: greeks.vega,
        
        // Volatility
        impliedVolatility: greeks.impliedVolatility,
        ivPercentile: ivPercentileData?.ivPercentile || 50,
        
        // Volume
        volume: greeks.volume,
        openInterest: greeks.openInterest,
        avgVolume20Day: volumeData?.avgVolume20Day || greeks.volume,
        volumeRatio: volumeData?.volumeRatio || 1,
        
        // Pricing
        bid: greeks.bid,
        ask: greeks.ask,
        lastPrice: greeks.lastPrice,
        premium: greeks.bid > 0 && greeks.ask > 0 
          ? (greeks.bid + greeks.ask) / 2 
          : greeks.lastPrice,
        
        // Metadata
        timestamp: Date.now(),
        source: 'polygon-rest',
        cacheAge: 0
      };
      
      // Cache result
      this.optionsCache.set(cacheKey, {
        data: analytics,
        fetchedAt: Date.now()
      });
      
      return analytics;
    } catch (error: any) {
      console.error(`Failed to fetch options analytics for ${symbol}:`, error.message);
      return null;
    }
  }
  
  
  // ===== UTILITY METHODS =====
  
  private isQuoteFresh(timestamp: number): boolean {
    return (Date.now() - timestamp) < this.QUOTE_FRESHNESS_THRESHOLD_MS;
  }
  
  private getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }
  
  // ===== TECHNICAL INDICATOR CALCULATIONS =====
  
  private calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = closes.length - period; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
  
  private calculateEMA(values: number[], period: number): number {
    if (values.length === 0) return 0;
    if (values.length < period) return values[values.length - 1];
    
    const multiplier = 2 / (period + 1);
    
    // Start with SMA
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    // Calculate EMA
    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }
  
  private calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1) return 0;
    
    const trs: number[] = [];
    
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }
    
    const recentTRs = trs.slice(-period);
    return recentTRs.reduce((a, b) => a + b, 0) / period;
  }
}

// Export singleton instance
export const liveDataAdapter = LiveDataAdapter.getInstance();
