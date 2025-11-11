import axios from 'axios';

interface HistoricalBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

class AlphaVantageRateLimiter {
  private queue: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private requestTimestamps: number[] = [];
  private readonly maxRequestsPerMinute = 25;
  private isProcessing = false;

  async acquire(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const oneMinuteAgo = now - 60000;

      this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);

      if (this.requestTimestamps.length < this.maxRequestsPerMinute) {
        this.requestTimestamps.push(now);
        const waiter = this.queue.shift();
        waiter?.resolve();
      } else {
        const oldestTimestamp = this.requestTimestamps[0];
        const waitTime = oldestTimestamp + 60000 - now;
        console.log(`⏳ Alpha Vantage rate limit: waiting ${(waitTime / 1000).toFixed(1)}s (${this.queue.length} queued)`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    this.isProcessing = false;
  }

  getStatus(): { queued: number; available: number } {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
    
    return {
      queued: this.queue.length,
      available: this.maxRequestsPerMinute - this.requestTimestamps.length
    };
  }
}

class AlphaVantageService {
  private apiKey: string;
  private rateLimiter: AlphaVantageRateLimiter;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();

  constructor() {
    this.apiKey = process.env.ALPHA_VANTAGE_API_KEY || '';
    this.rateLimiter = new AlphaVantageRateLimiter();

    if (!this.apiKey) {
      console.warn('⚠️ ALPHA_VANTAGE_API_KEY not set - Alpha Vantage fallback disabled');
    }
  }

  async getHistoricalBars(
    symbol: string,
    from: string,
    to: string,
    timeframe: 'day' | '4hour' = 'day',
    limit: number = 100
  ): Promise<HistoricalBar[] | null> {
    if (!this.apiKey) {
      console.warn('Alpha Vantage API key not configured');
      return null;
    }

    const cacheKey = `${symbol}-${timeframe}-${from}-${to}-${limit}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 300000) {
      console.log(`${symbol}: Using cached Alpha Vantage data`);
      return cached.data;
    }

    try {
      await this.rateLimiter.acquire();

      const function_name = timeframe === '4hour' ? 'TIME_SERIES_INTRADAY' : 'TIME_SERIES_DAILY';
      const interval = timeframe === '4hour' ? '240min' : undefined;
      
      const params: any = {
        function: function_name,
        symbol: symbol,
        apikey: this.apiKey,
        outputsize: limit > 100 ? 'full' : 'compact'
      };

      if (interval) {
        params.interval = interval;
      }

      const url = 'https://www.alphavantage.co/query';
      console.log(`📊 Alpha Vantage: Fetching ${timeframe} bars for ${symbol}...`);

      const response = await axios.get(url, {
        params,
        timeout: 10000
      });

      const data = response.data;

      if (data['Error Message']) {
        console.warn(`${symbol}: Alpha Vantage error - ${data['Error Message']}`);
        return null;
      }

      if (data['Note']) {
        console.warn(`${symbol}: Alpha Vantage rate limit warning - ${data['Note']}`);
        return null;
      }

      const timeSeriesKey = timeframe === '4hour' 
        ? `Time Series (${interval})` 
        : 'Time Series (Daily)';
      
      const timeSeries = data[timeSeriesKey];

      if (!timeSeries) {
        console.warn(`${symbol}: No time series data from Alpha Vantage`);
        return null;
      }

      // Parse date range for filtering
      const fromTimestamp = new Date(from).getTime();
      const toTimestamp = new Date(to).getTime() + 86400000; // Add 1 day to include 'to' date
      
      const bars: HistoricalBar[] = Object.entries(timeSeries)
        .map(([dateStr, values]: [string, any]) => ({
          t: new Date(dateStr).getTime(),
          o: parseFloat(values['1. open']),
          h: parseFloat(values['2. high']),
          l: parseFloat(values['3. low']),
          c: parseFloat(values['4. close']),
          v: parseFloat(values['5. volume'])
        }))
        .filter(bar => bar.t >= fromTimestamp && bar.t < toTimestamp) // Filter by date range
        .reverse() // Chronological order
        .slice(0, limit); // Respect limit

      this.cache.set(cacheKey, { data: bars, timestamp: Date.now() });
      console.log(`✅ ${symbol}: Retrieved ${bars.length} bars from Alpha Vantage (${from} to ${to})`);

      return bars;

    } catch (error: any) {
      console.error(`${symbol}: Alpha Vantage request failed -`, error.message);
      return null;
    }
  }

  getRateLimiterStatus() {
    return this.rateLimiter.getStatus();
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

export const alphaVantageService = new AlphaVantageService();
