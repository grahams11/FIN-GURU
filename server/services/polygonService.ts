import WebSocket from 'ws';
import axios from 'axios';

interface QuoteData {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  lastPrice: number;
  markPrice: number;
  volume: number;
  timestamp: number;
}

export interface HistoricalBar {
  o: number; // Open
  h: number; // High
  l: number; // Low
  c: number; // Close
  v: number; // Volume
  t: number; // Timestamp (Unix ms)
}

interface PolygonTradeMessage {
  ev: 'T'; // Trade event
  sym: string; // Symbol
  p: number; // Price
  s: number; // Size
  t: number; // Timestamp (Unix ms)
  x: number; // Exchange ID
  c?: number[]; // Conditions
}

interface PolygonQuoteMessage {
  ev: 'Q'; // Quote event
  sym: string; // Symbol
  bp: number; // Bid price
  bs: number; // Bid size
  ap: number; // Ask price
  as: number; // Ask size
  t: number; // Timestamp (Unix ms)
  x: number; // Exchange ID
}

interface PolygonAggregateMessage {
  ev: 'A' | 'AM'; // Aggregate (per second) or Aggregate (per minute)
  sym: string; // Symbol
  o: number; // Open
  h: number; // High
  l: number; // Low
  c: number; // Close
  v: number; // Volume
  s: number; // Start timestamp
  e: number; // End timestamp
}

type PolygonMessage = PolygonTradeMessage | PolygonQuoteMessage | PolygonAggregateMessage | { ev: 'status', status: string, message: string };

enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  AUTHENTICATED = 'authenticated',
  ERROR = 'error'
}

class PolygonService {
  private ws: WebSocket | null = null;
  private quoteCache: Map<string, QuoteData> = new Map();
  private isConnected = false;
  private subscribedSymbols: Set<string> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000; // 5 seconds
  private apiKey: string;
  
  // Health tracking
  private lastMessageTimestamp: number = 0;
  private lastHeartbeatTimestamp: number = 0;
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private quoteFreshnessThreshold = 10000; // 10 seconds - quotes older than this are considered stale
  
  // Options quote caching (short-lived cache for scan optimization)
  private optionsQuoteCache: Map<string, { data: any; timestamp: number }> = new Map();
  private optionsCacheTTL = 60000; // 1 minute cache for options quotes

  // NOTE: No bulk snapshot caching - we need fresh data for real-time opportunities
  // Caching would give stale movers; users want to see NEW opportunities as they emerge

  constructor() {
    // Use the main Polygon API key for WebSocket authentication
    this.apiKey = process.env.POLYGON_API_KEY || '';
    
    if (!this.apiKey) {
      console.error('❌ POLYGON_API_KEY not found in environment variables');
    }
  }

  /**
   * Initialize Polygon WebSocket connection
   */
  async initialize(): Promise<boolean> {
    if (!this.apiKey) {
      console.error('❌ Cannot initialize Polygon service: Missing API key');
      return false;
    }

    console.log('🚀 Initializing Polygon WebSocket service...');
    return this.connect();
  }

  /**
   * Connect to Polygon WebSocket
   */
  private async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        console.log('🔌 Connecting to Polygon WebSocket...');
        
        // Connect to OPTIONS endpoint (user has Options Advanced plan)
        // Options Advanced plan requires /options endpoint, not /stocks
        // Real-time: wss://socket.massive.com/options
        // Delayed: wss://delayed.massive.com/options
        this.ws = new WebSocket('wss://socket.massive.com/options');

        this.ws.on('open', () => {
          console.log('✅ Polygon WebSocket connected');
          
          // Authenticate
          this.authenticate();
          
          this.isConnected = true;
          this.reconnectAttempts = 0;
          resolve(true);
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          console.error('❌ Polygon WebSocket error:', error.message);
          this.isConnected = false;
        });

        this.ws.on('close', () => {
          console.log('🔌 Polygon WebSocket disconnected');
          this.isConnected = false;
          
          // Attempt to reconnect
          this.attemptReconnect();
        });

        // Set timeout for connection
        setTimeout(() => {
          if (!this.isConnected) {
            console.error('⏱️ Polygon WebSocket connection timeout');
            resolve(false);
          }
        }, 10000); // 10 second timeout

      } catch (error: any) {
        console.error('❌ Polygon WebSocket connection error:', error.message);
        resolve(false);
      }
    });
  }

  /**
   * Authenticate with Polygon WebSocket
   */
  private authenticate(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('❌ Cannot authenticate: WebSocket not connected');
      return;
    }

    // Trim any whitespace from API key
    const trimmedKey = this.apiKey.trim();
    
    console.log('🔐 Authenticating with Polygon...');
    
    const authMessage = {
      action: 'auth',
      params: trimmedKey
    };

    this.ws.send(JSON.stringify(authMessage));
  }

  /**
   * Subscribe to symbols for real-time data
   */
  async subscribeToSymbols(symbols: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ Cannot subscribe: WebSocket not connected');
      return;
    }

    // Filter out symbols that are already subscribed
    const newSymbols = symbols.filter(s => !this.subscribedSymbols.has(s));
    
    if (newSymbols.length === 0) {
      return; // Already subscribed to all symbols
    }

    // Subscribe to both trades (T.*) and quotes (Q.*) for each symbol
    const subscriptions: string[] = [];
    newSymbols.forEach(symbol => {
      subscriptions.push(`T.${symbol}`); // Trades
      subscriptions.push(`Q.${symbol}`); // Quotes
      this.subscribedSymbols.add(symbol);
    });

    console.log(`📡 Subscribing to Polygon: ${newSymbols.join(', ')}`);

    const subscribeMessage = {
      action: 'subscribe',
      params: subscriptions.join(',')
    };

    this.ws.send(JSON.stringify(subscribeMessage));
  }

  /**
   * Unsubscribe from symbols
   */
  async unsubscribeFromSymbols(symbols: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const unsubscriptions: string[] = [];
    symbols.forEach(symbol => {
      if (this.subscribedSymbols.has(symbol)) {
        unsubscriptions.push(`T.${symbol}`);
        unsubscriptions.push(`Q.${symbol}`);
        this.subscribedSymbols.delete(symbol);
      }
    });

    if (unsubscriptions.length === 0) {
      return;
    }

    console.log(`📡 Unsubscribing from Polygon: ${symbols.join(', ')}`);

    const unsubscribeMessage = {
      action: 'unsubscribe',
      params: unsubscriptions.join(',')
    };

    this.ws.send(JSON.stringify(unsubscribeMessage));
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      // Update last message timestamp for health tracking
      this.lastMessageTimestamp = Date.now();
      
      const messages = JSON.parse(data.toString()) as PolygonMessage[];
      
      if (!Array.isArray(messages)) {
        return;
      }

      for (const message of messages) {
        if (message.ev === 'status') {
          this.handleStatusMessage(message);
        } else if (message.ev === 'T') {
          this.handleTradeMessage(message as PolygonTradeMessage);
        } else if (message.ev === 'Q') {
          this.handleQuoteMessage(message as PolygonQuoteMessage);
        } else if (message.ev === 'A' || message.ev === 'AM') {
          this.handleAggregateMessage(message as PolygonAggregateMessage);
        }
      }
    } catch (error: any) {
      console.error('❌ Error parsing Polygon message:', error.message);
    }
  }

  /**
   * Handle status messages (auth success, subscription confirmations, etc.)
   */
  private handleStatusMessage(message: any): void {
    // Update heartbeat timestamp
    this.lastHeartbeatTimestamp = Date.now();
    
    if (message.status === 'auth_success') {
      console.log('✅ Polygon authentication successful');
      this.connectionStatus = ConnectionStatus.AUTHENTICATED;
    } else if (message.status === 'success') {
      console.log(`✅ Polygon: ${message.message}`);
    } else if (message.status === 'error') {
      console.error(`❌ Polygon error: ${message.message}`);
      this.connectionStatus = ConnectionStatus.ERROR;
    } else {
      console.log(`📨 Polygon status: ${message.status} - ${message.message}`);
    }
  }

  /**
   * Handle trade messages (T.*)
   */
  private handleTradeMessage(trade: PolygonTradeMessage): void {
    const symbol = trade.sym;
    const price = trade.p;
    const volume = trade.s;
    const timestamp = trade.t;

    // Update or create quote data
    const existing = this.quoteCache.get(symbol);
    
    this.quoteCache.set(symbol, {
      symbol,
      bidPrice: existing?.bidPrice || price,
      askPrice: existing?.askPrice || price,
      lastPrice: price,
      markPrice: price,
      volume: existing?.volume ? existing.volume + volume : volume,
      timestamp
    });

    console.log(`📊 Polygon Trade: ${symbol} @ $${price.toFixed(2)} (${volume} shares)`);
  }

  /**
   * Handle quote messages (Q.*)
   */
  private handleQuoteMessage(quote: PolygonQuoteMessage): void {
    const symbol = quote.sym;
    const bidPrice = quote.bp;
    const askPrice = quote.ap;
    const timestamp = quote.t;

    // Calculate mark price as midpoint
    const markPrice = (bidPrice + askPrice) / 2;

    // Update or create quote data
    const existing = this.quoteCache.get(symbol);
    
    this.quoteCache.set(symbol, {
      symbol,
      bidPrice,
      askPrice,
      lastPrice: existing?.lastPrice || markPrice,
      markPrice,
      volume: existing?.volume || 0,
      timestamp
    });

    console.log(`📊 Polygon Quote: ${symbol} Bid $${bidPrice.toFixed(2)} Ask $${askPrice.toFixed(2)}`);
  }

  /**
   * Handle aggregate messages (A.* or AM.*)
   */
  private handleAggregateMessage(agg: PolygonAggregateMessage): void {
    const symbol = agg.sym;
    const close = agg.c;
    const volume = agg.v;
    const timestamp = agg.e;

    // Update or create quote data using close price
    const existing = this.quoteCache.get(symbol);
    
    this.quoteCache.set(symbol, {
      symbol,
      bidPrice: existing?.bidPrice || close,
      askPrice: existing?.askPrice || close,
      lastPrice: close,
      markPrice: close,
      volume,
      timestamp
    });

    console.log(`📊 Polygon Aggregate: ${symbol} Close $${close.toFixed(2)} Vol ${volume}`);
  }

  /**
   * Get cached quote data for a symbol (with freshness check)
   */
  getQuote(symbol: string): QuoteData | null {
    const quote = this.quoteCache.get(symbol);
    
    if (!quote) {
      return null;
    }
    
    // Check if quote is fresh (within threshold)
    const now = Date.now();
    if (now - quote.timestamp > this.quoteFreshnessThreshold) {
      console.warn(`⚠️ Polygon quote for ${symbol} is stale (${Math.round((now - quote.timestamp) / 1000)}s old)`);
      return null; // Return null for stale quotes so SSE can fall back
    }
    
    return quote;
  }

  /**
   * Get cached quote for SSE streaming from Polygon WebSocket
   * Options Advanced plan provides real-time stock data via WebSocket
   */
  async getCachedQuote(symbol: string): Promise<{ lastPrice: number; bidPrice: number; askPrice: number; volume: number } | null> {
    // Get quote from WebSocket cache (fresh data within threshold)
    const cachedQuote = this.getQuote(symbol);
    if (cachedQuote) {
      return {
        lastPrice: cachedQuote.lastPrice,
        bidPrice: cachedQuote.bidPrice,
        askPrice: cachedQuote.askPrice,
        volume: cachedQuote.volume || 0
      };
    }

    // No WebSocket data available - return null to let fallback sources handle it
    return null;
  }

  /**
   * Get real-time stock quote from Polygon WebSocket cache
   * Options Advanced plan provides stock data via WebSocket (not REST API)
   */
  async getStockQuote(symbol: string): Promise<{ price: number; changePercent: number } | null> {
    // Skip market index symbols (^GSPC, ^VIX, etc.) - Polygon doesn't support these
    if (symbol.includes('^') || symbol.includes('%5E')) {
      return null;
    }

    // Get quote from WebSocket cache
    const cachedQuote = this.getQuote(symbol);
    if (cachedQuote) {
      console.log(`✅ ${symbol}: Using Polygon WebSocket - $${cachedQuote.lastPrice.toFixed(2)}`);
      return {
        price: cachedQuote.lastPrice,
        changePercent: 0 // WebSocket doesn't provide changePercent
      };
    }

    // No WebSocket data available - return null to let fallback sources handle it
    return null;
  }

  /**
   * Get all cached quotes
   */
  getAllQuotes(): Map<string, QuoteData> {
    return new Map(this.quoteCache);
  }

  /**
   * Check if service is connected
   */
  isServiceConnected(): boolean {
    return this.isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Check if service is healthy (connected + receiving data)
   */
  isHealthy(): boolean {
    const now = Date.now();
    const connected = this.isServiceConnected();
    const authenticated = this.connectionStatus === ConnectionStatus.AUTHENTICATED;
    const receivingData = this.lastMessageTimestamp > 0 && (now - this.lastMessageTimestamp) < 30000; // 30 seconds
    
    return connected && authenticated && receivingData;
  }

  /**
   * Get health metrics
   */
  getHealth(): {
    status: ConnectionStatus;
    connected: boolean;
    lastMessageAge: number;
    lastHeartbeatAge: number;
    subscribedSymbols: number;
    cachedQuotes: number;
    reconnectAttempts: number;
  } {
    const now = Date.now();
    
    return {
      status: this.connectionStatus,
      connected: this.isServiceConnected(),
      lastMessageAge: this.lastMessageTimestamp ? now - this.lastMessageTimestamp : -1,
      lastHeartbeatAge: this.lastHeartbeatTimestamp ? now - this.lastHeartbeatTimestamp : -1,
      subscribedSymbols: this.subscribedSymbols.size,
      cachedQuotes: this.quoteCache.size,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Attempt to reconnect to WebSocket
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached for Polygon WebSocket');
      return;
    }

    this.reconnectAttempts++;
    console.log(`🔄 Attempting to reconnect to Polygon WebSocket (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      this.connect().then((success) => {
        if (success && this.subscribedSymbols.size > 0) {
          // Re-subscribe to previous symbols
          const symbols = Array.from(this.subscribedSymbols);
          this.subscribedSymbols.clear(); // Clear to allow re-subscription
          this.subscribeToSymbols(symbols);
        }
      });
    }, this.reconnectDelay);
  }

  /**
   * Fetch all active US stock tickers from Polygon reference API
   */
  async fetchAllTickers(): Promise<string[]> {
    const allTickers: string[] = [];
    let nextUrl: string | null = 'https://api.polygon.io/v3/reference/tickers';
    
    const params = new URLSearchParams({
      market: 'stocks',
      type: 'CS', // Common Stock only (no ETFs, warrants, etc.)
      active: 'true',
      limit: '1000',
      apiKey: this.apiKey
    });

    try {
      console.log('🔍 Fetching all active US stock tickers from Polygon...');
      
      // Fetch all pages (pagination)
      while (nextUrl) {
        const url: string = nextUrl.includes('?') ? nextUrl : `${nextUrl}?${params}`;
        
        const response: any = await axios.get(url);
        const data: any = response.data;
        
        if (data.results && Array.isArray(data.results)) {
          const tickers = data.results.map((ticker: any) => ticker.ticker);
          allTickers.push(...tickers);
          console.log(`📊 Fetched ${tickers.length} tickers (total: ${allTickers.length})`);
        }
        
        // Get next page URL
        nextUrl = data.next_url || null;
        
        // Avoid rate limiting
        if (nextUrl) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      console.log(`✅ Total tickers fetched: ${allTickers.length}`);
      return allTickers;
      
    } catch (error: any) {
      console.error('❌ Error fetching tickers from Polygon:', error.message);
      return [];
    }
  }

  /**
   * Fetch ticker details with market cap and liquidity metrics
   */
  async fetchTickerDetails(symbol: string): Promise<{ 
    marketCap?: number; 
    shareClassSharesOutstanding?: number;
    weightedSharesOutstanding?: number;
  } | null> {
    try {
      const response = await axios.get(
        `https://api.polygon.io/v3/reference/tickers/${symbol}`,
        {
          params: { apiKey: this.apiKey }
        }
      );
      
      if (response.data?.results) {
        return {
          marketCap: response.data.results.market_cap,
          shareClassSharesOutstanding: response.data.results.share_class_shares_outstanding,
          weightedSharesOutstanding: response.data.results.weighted_shares_outstanding
        };
      }
      
      return null;
    } catch (error: any) {
      // Silently fail for individual ticker details (avoid log spam)
      return null;
    }
  }

  /**
   * Fetch real option quote with premium, Greeks, and implied volatility
   * Includes retry logic and short-lived caching for reliability
   * @param underlying - Underlying symbol (e.g., "SPX", "AAPL")
   * @param strikePrice - Strike price (e.g., 6800)
   * @param expiryDate - Expiry date in YYYY-MM-DD format
   * @param optionType - 'call' or 'put'
   * @returns Option data with premium, greeks, and IV, or null if not found
   */
  async getOptionQuote(
    underlying: string,
    strikePrice: number,
    expiryDate: string,
    optionType: 'call' | 'put'
  ): Promise<{
    premium: number;
    bid: number;
    ask: number;
    greeks: {
      delta: number;
      gamma: number;
      theta: number;
      vega: number;
    };
    impliedVolatility: number;
    openInterest: number;
  } | null> {
    try {
      // Format option ticker: O:{underlying}{YYMMDD}{C/P}{strike*1000}
      // Example: O:SPX250117C06800000 for SPX Jan 17, 2025 $6800 Call
      const date = new Date(expiryDate);
      const yy = date.getFullYear().toString().slice(-2);
      const mm = (date.getMonth() + 1).toString().padStart(2, '0');
      const dd = date.getDate().toString().padStart(2, '0');
      const callPut = optionType.toLowerCase() === 'call' ? 'C' : 'P'; // Normalize to uppercase
      const strike = Math.round(strikePrice * 1000).toString().padStart(8, '0');
      
      const optionTicker = `O:${underlying.toUpperCase()}${yy}${mm}${dd}${callPut}${strike}`;
      const cacheKey = optionTicker; // Already normalized (uppercase underlying + C/P)
      
      // Check cache first (1-minute TTL)
      const cached = this.optionsQuoteCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.optionsCacheTTL) {
        console.log(`💾 Using cached option quote: ${optionTicker}`);
        return cached.data;
      }
      
      console.log(`📊 Fetching Polygon option quote: ${optionTicker}`);
      
      // Retry logic: 3 attempts with exponential backoff
      const maxRetries = 3;
      let lastError: any = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await axios.get(
            `https://api.polygon.io/v3/snapshot/options/${underlying}/${optionTicker}`,
            {
              params: { apiKey: this.apiKey },
              timeout: 5000
            }
          );
          
          if (response.data?.results) {
            const result = response.data.results;
            const quote = result.last_quote;
            const greeks = result.greeks;
            
            if (!quote || !greeks) {
              console.warn(`⚠️ ${optionTicker}: Missing quote or greeks data`);
              return null;
            }
            
            const premium = quote.midpoint || ((quote.bid + quote.ask) / 2);
            
            const optionData = {
              premium,
              bid: quote.bid,
              ask: quote.ask,
              greeks: {
                delta: greeks.delta || 0,
                gamma: greeks.gamma || 0,
                theta: greeks.theta || 0,
                vega: greeks.vega || 0
              },
              impliedVolatility: result.implied_volatility || 0,
              openInterest: result.open_interest || 0
            };
            
            // Cache the successful result
            this.optionsQuoteCache.set(cacheKey, {
              data: optionData,
              timestamp: Date.now()
            });
            
            console.log(`✅ ${optionTicker}: Premium $${premium.toFixed(2)}, Delta ${greeks.delta?.toFixed(4)}, IV ${(result.implied_volatility * 100).toFixed(1)}%`);
            
            return optionData;
          }
          
          // No results found
          return null;
          
        } catch (error: any) {
          lastError = error;
          
          // Don't retry on 404 or other client errors
          if (error.response?.status && error.response.status >= 400 && error.response.status < 500) {
            console.warn(`⚠️ ${optionTicker}: Client error ${error.response.status}, not retrying`);
            return null;
          }
          
          // Retry on network/server errors
          if (attempt < maxRetries) {
            const backoffMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            console.warn(`⚠️ ${optionTicker}: Attempt ${attempt}/${maxRetries} failed, retrying in ${backoffMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
        }
      }
      
      // All retries exhausted
      console.error(`❌ Error fetching option quote for ${underlying} after ${maxRetries} attempts:`, lastError?.message);
      return null;
      
    } catch (error: any) {
      console.error(`❌ Unexpected error in getOptionQuote for ${underlying}:`, error.message);
      return null;
    }
  }

  /**
   * Get historical price bars (aggregates) for Fibonacci calculations
   * Uses Polygon REST API for historical data
   * 
   * @param symbol Stock symbol
   * @param from Start date (YYYY-MM-DD)
   * @param to End date (YYYY-MM-DD)
   * @param timespan 'day' or 'hour'
   * @param multiplier Number of units (1 = 1 day/hour, 4 = 4 hours, etc.)
   * @returns Array of historical bars or null on error
   */
  async getHistoricalBars(
    symbol: string,
    from: string,
    to: string,
    timespan: 'day' | 'hour' = 'day',
    multiplier: number = 1
  ): Promise<HistoricalBar[] | null> {
    try {
      const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&apiKey=${this.apiKey}`;
      
      const response = await axios.get(url, {
        timeout: 10000
      });

      if (response.data?.results && Array.isArray(response.data.results)) {
        const timeframeLabel = multiplier > 1 ? `${multiplier}-${timespan}` : timespan;
        console.log(`${symbol}: Retrieved ${response.data.results.length} historical ${timeframeLabel} bars from ${from} to ${to}`);
        return response.data.results;
      }

      console.warn(`${symbol}: No historical data found for ${from} to ${to}`);
      return null;

    } catch (error: any) {
      if (error.response?.status === 404) {
        console.warn(`${symbol}: Historical data not available (404)`);
      } else if (error.response?.status === 429) {
        console.error(`${symbol}: Rate limit exceeded for historical data`);
      } else {
        console.error(`${symbol}: Failed to fetch historical bars from ${from} to ${to}:`, error.message);
      }
      return null;
    }
  }

  /**
   * Get today's opening and closing prices for a symbol
   * Uses Polygon REST API to get the most recent trading day's data
   * 
   * @param symbol Stock symbol (without I: prefix - e.g., 'SPX', 'NDX', 'VIX')
   * @returns Object with open and close prices, or null if unavailable
   */
  async getTodayOpenPrice(symbol: string): Promise<{ open: number; close: number } | null> {
    try {
      // Get date range (today and previous 5 trading days for fallback)
      const today = new Date();
      const prevDays = new Date(today);
      prevDays.setDate(prevDays.getDate() - 5); // Go back 5 days to account for weekends
      
      const todayStr = today.toISOString().split('T')[0];
      const prevStr = prevDays.toISOString().split('T')[0];
      
      // For indices, try both with and without I: prefix
      const symbols = [
        `I:${symbol}`,  // Try with I: prefix first (standard for indices)
        symbol          // Fallback to symbol without prefix
      ];
      
      for (const testSymbol of symbols) {
        try {
          const url = `https://api.polygon.io/v2/aggs/ticker/${testSymbol}/range/1/day/${prevStr}/${todayStr}?adjusted=true&limit=5&sort=desc&apiKey=${this.apiKey}`;
          
          const response = await axios.get(url, {
            timeout: 5000
          });

          if (response.data?.results && Array.isArray(response.data.results) && response.data.results.length > 0) {
            // Get the most recent bar (should be today or last trading day)
            const recentBar = response.data.results[0];
            const open = recentBar.o;
            const close = recentBar.c;
            console.log(`${symbol}: Most recent trading day - Open: $${open.toFixed(2)}, Close: $${close.toFixed(2)} from ${testSymbol}`);
            return { open, close };
          }
        } catch (innerError: any) {
          // Try next symbol format
          continue;
        }
      }

      console.warn(`${symbol}: No opening/closing price data available (all formats tried)`);
      return null;

    } catch (error: any) {
      console.warn(`${symbol}: Failed to fetch opening/closing price:`, error.message);
      return null;
    }
  }

  /**
   * Get REAL-TIME bulk market snapshot for TOP 5,000 stocks (NO CACHE!)
   * Uses snapshot endpoint (works during trading hours, not just after close)
   * OPTIMIZED COVERAGE: Fetches top 5 pages (~5,000 most liquid stocks) in ~20-30s
   * NO CACHING: Fresh data every scan to find NEW opportunities as they emerge
   * Returns: Array of { ticker, price, volume, change } for top 5,000 stocks
   */
  async getBulkMarketSnapshot(): Promise<Array<{
    ticker: string;
    price: number;
    volume: number;
    open: number;
    high: number;
    low: number;
    close: number;
    change: number;
    changePercent: number;
  }>> {
    try {
      // Fetch fresh data (no cache - need real-time movers!)
      // OPTIMIZED: Fetch top 5 pages for best balance of coverage vs. API usage
      let allSnapshots: Array<any> = [];
      let nextUrl: string | null = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?limit=1000&apiKey=${this.apiKey}`;
      let pageCount = 0;
      const maxPages = 5; // Top 5,000 stocks (5 pages × 1,000 = 5,000) in ~20-30s
      
      console.log(`📊 Fetching market snapshot (top ${maxPages * 1000} stocks for optimized coverage)...`);
      
      while (nextUrl && pageCount < maxPages) {
        const response: any = await axios.get(nextUrl, {
          timeout: 30000 // 30 seconds per page
        });

        if (response.data?.tickers && Array.isArray(response.data.tickers)) {
          const pageSnapshots = response.data.tickers
            .filter((ticker: any) => {
              // Only include tickers with valid data
              if (!ticker.day && !ticker.lastTrade && !ticker.prevDay) return false;
              
              const dayData = ticker.day || {};
              const lastTrade = ticker.lastTrade || {};
              const prevDay = ticker.prevDay || {};
              
              const currentPrice = lastTrade.p || dayData.c || prevDay.c || 0;
              const todayOpen = dayData.o || prevDay.c || 0;
              const todayVolume = dayData.v || 0;
              
              // Filter out invalid data (zero price, zero volume, zero open)
              return currentPrice > 0 && todayVolume > 0 && todayOpen > 0;
            })
            .map((ticker: any) => {
              const dayData = ticker.day || {};
              const lastTrade = ticker.lastTrade || {};
              const prevDay = ticker.prevDay || {};
              
              // Use current price from last trade, or day close if trade unavailable
              const currentPrice = lastTrade.p || dayData.c || prevDay.c || 0;
              const todayOpen = dayData.o || prevDay.c || 1; // Prevent divide by zero
              const todayVolume = dayData.v || 0;
              
              return {
                ticker: ticker.ticker,
                price: currentPrice,
                volume: todayVolume,
                open: todayOpen,
                high: dayData.h || currentPrice,
                low: dayData.l || currentPrice,
                close: currentPrice,
                change: currentPrice - todayOpen,
                changePercent: ((currentPrice - todayOpen) / todayOpen) * 100
              };
            });
          
          allSnapshots.push(...pageSnapshots);
          pageCount++;
          
          console.log(`  📄 Page ${pageCount}: ${pageSnapshots.length} stocks (total: ${allSnapshots.length})`);
          
          // Get next page URL
          nextUrl = response.data.next_url || null;
          
          // Add small delay between pages to avoid rate limits
          if (nextUrl) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } else {
          break; // No more data
        }
      }
      
      if (allSnapshots.length > 0) {
        console.log(`✅ Retrieved ${allSnapshots.length} FRESH stock snapshots (${pageCount} pages, COMPLETE MARKET)`);
        return allSnapshots;
      }

      console.warn('⚠️ No bulk snapshot data available, falling back to grouped daily bars');
      
      // Fallback to grouped daily bars (previous trading day)
      const fallbackSnapshots = await this.getBulkMarketSnapshotFallback();
      return fallbackSnapshots;

    } catch (error: any) {
      console.error('❌ Error fetching bulk market snapshot:', error.message);
      
      // Try fallback to grouped daily bars
      try {
        console.log('🔄 Attempting fallback to grouped daily bars...');
        const fallbackSnapshots = await this.getBulkMarketSnapshotFallback();
        return fallbackSnapshots;
      } catch (fallbackError: any) {
        console.error('❌ Fallback also failed:', fallbackError.message);
        return [];
      }
    }
  }

  /**
   * Fallback: Get previous trading day's data using grouped daily bars
   * Used when real-time snapshot fails
   * Tries up to 10 days back to account for holidays and market closures
   */
  private async getBulkMarketSnapshotFallback(): Promise<Array<{
    ticker: string;
    price: number;
    volume: number;
    open: number;
    high: number;
    low: number;
    close: number;
    change: number;
    changePercent: number;
  }>> {
    // Try multiple previous days to handle holidays and weekends
    const maxDaysBack = 10;
    const today = new Date();
    
    for (let daysBack = 1; daysBack <= maxDaysBack; daysBack++) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() - daysBack);
      const dateStr = targetDate.toISOString().split('T')[0];
      
      // Skip weekends (save API calls)
      const dayOfWeek = targetDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue; // Skip Sunday (0) and Saturday (6)
      }
      
      try {
        const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${dateStr}?adjusted=true&apiKey=${this.apiKey}`;
        
        console.log(`📊 Trying grouped daily bars for ${dateStr} (${daysBack} days back)...`);
        
        const response = await axios.get(url, {
          timeout: 15000
        });

        if (response.data?.results && Array.isArray(response.data.results) && response.data.results.length > 0) {
          const snapshots = response.data.results
            .filter((bar: any) => bar.o > 0) // Filter out bars with zero open (invalid)
            .map((bar: any) => ({
              ticker: bar.T,
              price: bar.c,
              volume: bar.v,
              open: bar.o,
              high: bar.h,
              low: bar.l,
              close: bar.c,
              change: bar.c - bar.o,
              changePercent: ((bar.c - bar.o) / bar.o) * 100
            }));
          
          if (snapshots.length > 0) {
            console.log(`✅ Retrieved ${snapshots.length} stock snapshots from ${dateStr} (${daysBack} days back)`);
            return snapshots;
          }
        }
      } catch (error: any) {
        // Continue trying previous days
        console.warn(`⚠️ ${dateStr} failed:`, error.message);
        continue;
      }
    }

    console.warn(`⚠️ Fallback exhausted: No market data found in last ${maxDaysBack} days`);
    return [];
  }

  /**
   * Close WebSocket connection
   */
  async close(): Promise<void> {
    if (this.ws) {
      console.log('🔌 Closing Polygon WebSocket connection...');
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.subscribedSymbols.clear();
    }
  }
}

// Export singleton instance
export const polygonService = new PolygonService();
export default polygonService;
