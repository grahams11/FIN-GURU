import axios from 'axios';

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const BASE_URL = 'https://www.alphavantage.co/query';

export interface AlphaVantageQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
}

export interface AlphaVantageRSI {
  date: string;
  rsi: number;
}

export interface AlphaVantage52WeekRange {
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class AlphaVantageService {
  private static requestCount = 0;
  private static lastRequestTime = Date.now();
  private static readonly MAX_REQUESTS_PER_MINUTE = 5; // Free tier limit
  private static readonly CACHE_TTL_QUOTES = 5 * 60 * 1000; // 5 minutes for quotes
  private static readonly CACHE_TTL_RSI = 15 * 60 * 1000; // 15 minutes for RSI
  private static readonly CACHE_TTL_52WEEK = 60 * 60 * 1000; // 1 hour for 52-week range
  
  // Simple in-memory cache
  private static quoteCache = new Map<string, CacheEntry<AlphaVantageQuote | null>>();
  private static rsiCache = new Map<string, CacheEntry<number | null>>();
  private static rangeCache = new Map<string, CacheEntry<AlphaVantage52WeekRange | null>>();

  /**
   * Rate limiting for Alpha Vantage free tier (5 requests/minute)
   * Returns false if rate limit would be hit - caller should skip API call
   */
  private static async rateLimit(): Promise<boolean> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest > 60000) {
      // Reset counter after 1 minute
      this.requestCount = 0;
      this.lastRequestTime = now;
    }
    
    if (this.requestCount >= this.MAX_REQUESTS_PER_MINUTE) {
      // Don't wait - return false to indicate rate limit reached
      console.log(`Alpha Vantage: Rate limit reached (${this.requestCount} requests), skipping API call`);
      return false;
    }
    
    this.requestCount++;
    return true;
  }
  
  /**
   * Get cached data if available and not expired
   */
  private static getCached<T>(cache: Map<string, CacheEntry<T>>, key: string, ttl: number): T | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    
    const age = Date.now() - entry.timestamp;
    if (age > ttl) {
      cache.delete(key);
      return undefined;
    }
    
    console.log(`Alpha Vantage: Using cached data for ${key} (age: ${Math.round(age / 1000)}s)`);
    return entry.data;
  }
  
  /**
   * Set cached data
   */
  private static setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
    cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Map index symbols to Alpha Vantage compatible symbols
   */
  private static mapSymbol(symbol: string): string {
    const symbolMap: Record<string, string> = {
      '^GSPC': 'SPY',     // S&P 500 → SPY ETF
      '^SPX': 'SPY',      // S&P 500 Index → SPY ETF
      'SPX': 'SPY',       // S&P 500 Index → SPY ETF
      '^IXIC': 'QQQ',     // NASDAQ → QQQ ETF
      '^VIX': 'VIX',      // VIX Index
      'VIX': 'VIX',       // VIX Index
      'MNQ': 'NQ=F',      // Micro NASDAQ futures
      '^MNQ': 'NQ=F'      // Micro NASDAQ futures
    };
    
    return symbolMap[symbol] || symbol;
  }

  /**
   * Get real-time quote for a stock (with caching)
   */
  static async getQuote(symbol: string): Promise<AlphaVantageQuote | null> {
    // Check cache first
    const cached = this.getCached(this.quoteCache, symbol, this.CACHE_TTL_QUOTES);
    if (cached !== undefined) return cached;
    
    try {
      // Check rate limit before making API call
      const canProceed = await this.rateLimit();
      if (!canProceed) {
        // Rate limit hit - return null to fall back to web scraping
        return null;
      }
      
      // Map index symbols to Alpha Vantage compatible symbols
      const mappedSymbol = this.mapSymbol(symbol);
      
      const response = await axios.get(BASE_URL, {
        params: {
          function: 'GLOBAL_QUOTE',
          symbol: mappedSymbol,
          apikey: API_KEY
        },
        timeout: 10000
      });

      // Check for API error responses
      if (response.data['Error Message']) {
        console.error(`Alpha Vantage API Error: ${response.data['Error Message']}`);
        return null; // Don't cache errors
      }
      
      if (response.data['Note']) {
        console.warn(`Alpha Vantage API Note: ${response.data['Note']}`);
        return null; // Don't cache rate limit messages
      }
      
      if (response.data['Information']) {
        console.warn(`Alpha Vantage API Info: ${response.data['Information']}`);
        return null; // Don't cache informational messages
      }

      const quote = response.data['Global Quote'];
      
      if (!quote || !quote['05. price']) {
        console.warn(`Alpha Vantage: No quote data for ${mappedSymbol} (original: ${symbol}) - raw response:`, JSON.stringify(response.data).substring(0, 200));
        return null; // Don't cache null results
      }

      const price = parseFloat(quote['05. price']);
      const change = parseFloat(quote['09. change']);
      const changePercent = parseFloat(quote['10. change percent'].replace('%', ''));
      const volume = parseInt(quote['06. volume']);
      const high = parseFloat(quote['03. high']);
      const low = parseFloat(quote['04. low']);
      const open = parseFloat(quote['02. open']);
      const previousClose = parseFloat(quote['08. previous close']);

      const result = {
        symbol,
        price,
        change,
        changePercent,
        volume: isNaN(volume) ? undefined : volume,
        high,
        low,
        open,
        previousClose
      };
      
      // Only cache successful results
      this.setCached(this.quoteCache, symbol, result);
      console.log(`Alpha Vantage: Successfully fetched ${symbol} price: $${price.toFixed(2)}`);
      return result;
    } catch (error) {
      console.error(`Alpha Vantage: Error fetching quote for ${symbol}:`, error);
      return null; // Don't cache errors
    }
  }

  /**
   * Get RSI (Relative Strength Index) for a stock (with caching)
   */
  static async getRSI(symbol: string, timePeriod: number = 14): Promise<number | null> {
    const cacheKey = `${symbol}_${timePeriod}`;
    
    // Check cache first
    const cached = this.getCached(this.rsiCache, cacheKey, this.CACHE_TTL_RSI);
    if (cached !== undefined) return cached;
    
    try {
      // Check rate limit before making API call
      const canProceed = await this.rateLimit();
      if (!canProceed) {
        // Rate limit hit - return null to fall back to alternative method
        return null;
      }
      
      // Map index symbols to Alpha Vantage compatible symbols
      const mappedSymbol = this.mapSymbol(symbol);
      
      const response = await axios.get(BASE_URL, {
        params: {
          function: 'RSI',
          symbol: mappedSymbol,
          interval: 'daily',
          time_period: timePeriod,
          series_type: 'close',
          apikey: API_KEY
        },
        timeout: 10000
      });

      // Check for API error responses
      if (response.data['Error Message']) {
        console.error(`Alpha Vantage RSI API Error: ${response.data['Error Message']}`);
        return null; // Don't cache errors
      }
      if (response.data['Note']) {
        console.warn(`Alpha Vantage RSI API Note: ${response.data['Note']}`);
        return null; // Don't cache rate limit messages
      }

      const technicalAnalysis = response.data['Technical Analysis: RSI'];
      
      if (!technicalAnalysis) {
        console.warn(`Alpha Vantage: No RSI data for ${mappedSymbol} (original: ${symbol})`);
        return null; // Don't cache null results
      }

      // Get the most recent RSI value
      const dates = Object.keys(technicalAnalysis).sort().reverse();
      if (dates.length === 0) {
        return null; // Don't cache null results
      }
      
      const latestRSI = parseFloat(technicalAnalysis[dates[0]]['RSI']);
      const result = isNaN(latestRSI) ? null : latestRSI;
      
      if (result !== null) {
        // Only cache successful results
        this.setCached(this.rsiCache, cacheKey, result);
        console.log(`Alpha Vantage: Successfully fetched ${symbol} RSI: ${result.toFixed(1)}`);
      }
      return result;
    } catch (error) {
      console.error(`Alpha Vantage: Error fetching RSI for ${symbol}:`, error);
      return null; // Don't cache errors
    }
  }

  /**
   * Get 52-week high/low from daily time series (with caching)
   * NOTE: This uses TIME_SERIES_DAILY which is expensive - cache aggressively
   */
  static async get52WeekRange(symbol: string): Promise<AlphaVantage52WeekRange | null> {
    // Check cache first
    const cached = this.getCached(this.rangeCache, symbol, this.CACHE_TTL_52WEEK);
    if (cached !== undefined) return cached;
    
    try {
      // Check rate limit before making API call
      const canProceed = await this.rateLimit();
      if (!canProceed) {
        // Rate limit hit - return null to fall back to web scraping
        console.log(`Alpha Vantage: Skipping 52-week range for ${symbol} due to rate limit`);
        return null;
      }
      
      // Map index symbols to Alpha Vantage compatible symbols
      const mappedSymbol = this.mapSymbol(symbol);
      
      const response = await axios.get(BASE_URL, {
        params: {
          function: 'TIME_SERIES_DAILY',
          symbol: mappedSymbol,
          outputsize: 'full', // Get full history
          apikey: API_KEY
        },
        timeout: 15000
      });

      // Check for API error responses
      if (response.data['Error Message']) {
        console.error(`Alpha Vantage 52-week API Error: ${response.data['Error Message']}`);
        return null; // Don't cache errors
      }
      if (response.data['Note']) {
        console.warn(`Alpha Vantage 52-week API Note: ${response.data['Note']}`);
        return null; // Don't cache rate limit messages
      }

      const timeSeries = response.data['Time Series (Daily)'];
      
      if (!timeSeries) {
        console.warn(`Alpha Vantage: No time series data for ${mappedSymbol} (original: ${symbol})`);
        return null; // Don't cache null results
      }

      // Calculate 52-week range (approximately 252 trading days)
      const dates = Object.keys(timeSeries).sort().reverse().slice(0, 252);
      
      if (dates.length === 0) {
        return null; // Don't cache null results
      }

      let high = 0;
      let low = Infinity;

      for (const date of dates) {
        const dayHigh = parseFloat(timeSeries[date]['2. high']);
        const dayLow = parseFloat(timeSeries[date]['3. low']);
        
        if (dayHigh > high) high = dayHigh;
        if (dayLow < low) low = dayLow;
      }

      const result = {
        fiftyTwoWeekHigh: high,
        fiftyTwoWeekLow: low === Infinity ? high : low
      };
      
      // Only cache successful results
      this.setCached(this.rangeCache, symbol, result);
      console.log(`Alpha Vantage: Successfully fetched ${symbol} 52-week range: $${result.fiftyTwoWeekLow.toFixed(2)} - $${result.fiftyTwoWeekHigh.toFixed(2)}`);
      return result;
    } catch (error) {
      console.error(`Alpha Vantage: Error fetching 52-week range for ${symbol}:`, error);
      return null; // Don't cache errors
    }
  }

  /**
   * Get market overview (S&P 500, NASDAQ, VIX)
   * 
   * NOTE: Alpha Vantage does NOT support market indexes like VIX (discontinued).
   * Only stocks and ETFs are supported. Use ETF proxies for indices:
   * - SPY for S&P 500
   * - QQQ for NASDAQ
   * - VIX is NOT available (returns null, must use web scraping fallback)
   */
  static async getMarketIndices(): Promise<{
    sp500: AlphaVantageQuote | null;
    nasdaq: AlphaVantageQuote | null;
    vix: AlphaVantageQuote | null;
  }> {
    // Alpha Vantage uses ETF proxies for indices
    // VIX is not supported and will return null (app will fall back to web scraping)
    const [sp500, nasdaq] = await Promise.all([
      this.getQuote('SPY'), // S&P 500 ETF as proxy
      this.getQuote('QQQ')  // NASDAQ 100 ETF as proxy
    ]);

    return { 
      sp500, 
      nasdaq, 
      vix: null  // VIX not supported by Alpha Vantage - falls back to web scraping
    };
  }

  /**
   * Get news sentiment for a stock
   */
  static async getNewsSentiment(symbol: string): Promise<{
    headlines: string[];
    overallSentiment: number; // -1 to 1
  } | null> {
    try {
      await this.rateLimit();
      
      const response = await axios.get(BASE_URL, {
        params: {
          function: 'NEWS_SENTIMENT',
          tickers: symbol,
          limit: 10,
          apikey: API_KEY
        },
        timeout: 10000
      });

      const feed = response.data.feed;
      
      if (!feed || feed.length === 0) {
        return {
          headlines: [],
          overallSentiment: 0
        };
      }

      const headlines = feed.slice(0, 5).map((item: any) => item.title);
      
      // Calculate average sentiment score
      let totalSentiment = 0;
      let sentimentCount = 0;
      
      for (const item of feed) {
        if (item.ticker_sentiment) {
          for (const tickerData of item.ticker_sentiment) {
            if (tickerData.ticker === symbol) {
              const score = parseFloat(tickerData.ticker_sentiment_score);
              if (!isNaN(score)) {
                totalSentiment += score;
                sentimentCount++;
              }
            }
          }
        }
      }

      const overallSentiment = sentimentCount > 0 ? totalSentiment / sentimentCount : 0;

      return {
        headlines,
        overallSentiment
      };
    } catch (error) {
      console.error(`Alpha Vantage: Error fetching news sentiment for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Batch fetch quotes with automatic rate limiting
   */
  static async batchGetQuotes(symbols: string[]): Promise<Map<string, AlphaVantageQuote>> {
    const results = new Map<string, AlphaVantageQuote>();
    
    for (const symbol of symbols) {
      const quote = await this.getQuote(symbol);
      if (quote) {
        results.set(symbol, quote);
      }
    }
    
    return results;
  }
}
