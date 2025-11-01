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

export class AlphaVantageService {
  private static requestCount = 0;
  private static lastRequestTime = Date.now();
  private static readonly MAX_REQUESTS_PER_MINUTE = 5; // Free tier limit

  /**
   * Rate limiting for Alpha Vantage free tier (5 requests/minute)
   */
  private static async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest > 60000) {
      // Reset counter after 1 minute
      this.requestCount = 0;
      this.lastRequestTime = now;
    }
    
    if (this.requestCount >= this.MAX_REQUESTS_PER_MINUTE) {
      const waitTime = 60000 - timeSinceLastRequest;
      console.log(`Alpha Vantage: Rate limit reached, waiting ${(waitTime / 1000).toFixed(1)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requestCount = 0;
      this.lastRequestTime = Date.now();
    }
    
    this.requestCount++;
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
   * Get real-time quote for a stock
   */
  static async getQuote(symbol: string): Promise<AlphaVantageQuote | null> {
    try {
      await this.rateLimit();
      
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

      const quote = response.data['Global Quote'];
      
      if (!quote || !quote['05. price']) {
        console.warn(`Alpha Vantage: No quote data for ${mappedSymbol} (original: ${symbol})`);
        return null;
      }

      const price = parseFloat(quote['05. price']);
      const change = parseFloat(quote['09. change']);
      const changePercent = parseFloat(quote['10. change percent'].replace('%', ''));
      const volume = parseInt(quote['06. volume']);
      const high = parseFloat(quote['03. high']);
      const low = parseFloat(quote['04. low']);
      const open = parseFloat(quote['02. open']);
      const previousClose = parseFloat(quote['08. previous close']);

      return {
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
    } catch (error) {
      console.error(`Alpha Vantage: Error fetching quote for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get RSI (Relative Strength Index) for a stock
   */
  static async getRSI(symbol: string, timePeriod: number = 14): Promise<number | null> {
    try {
      await this.rateLimit();
      
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

      const technicalAnalysis = response.data['Technical Analysis: RSI'];
      
      if (!technicalAnalysis) {
        console.warn(`Alpha Vantage: No RSI data for ${mappedSymbol} (original: ${symbol})`);
        return null;
      }

      // Get the most recent RSI value
      const dates = Object.keys(technicalAnalysis).sort().reverse();
      if (dates.length === 0) return null;
      
      const latestRSI = parseFloat(technicalAnalysis[dates[0]]['RSI']);
      return isNaN(latestRSI) ? null : latestRSI;
    } catch (error) {
      console.error(`Alpha Vantage: Error fetching RSI for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get 52-week high/low from daily time series
   */
  static async get52WeekRange(symbol: string): Promise<AlphaVantage52WeekRange | null> {
    try {
      await this.rateLimit();
      
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

      const timeSeries = response.data['Time Series (Daily)'];
      
      if (!timeSeries) {
        console.warn(`Alpha Vantage: No time series data for ${mappedSymbol} (original: ${symbol})`);
        return null;
      }

      // Calculate 52-week range (approximately 252 trading days)
      const dates = Object.keys(timeSeries).sort().reverse().slice(0, 252);
      
      if (dates.length === 0) return null;

      let high = 0;
      let low = Infinity;

      for (const date of dates) {
        const dayHigh = parseFloat(timeSeries[date]['2. high']);
        const dayLow = parseFloat(timeSeries[date]['3. low']);
        
        if (dayHigh > high) high = dayHigh;
        if (dayLow < low) low = dayLow;
      }

      return {
        fiftyTwoWeekHigh: high,
        fiftyTwoWeekLow: low === Infinity ? high : low
      };
    } catch (error) {
      console.error(`Alpha Vantage: Error fetching 52-week range for ${symbol}:`, error);
      return null;
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
