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
   * Get cached quote for SSE streaming (matches interface used by Tastytrade)
   * Returns fresh cached data or triggers REST API fetch
   */
  async getCachedQuote(symbol: string): Promise<{ lastPrice: number; bidPrice: number; askPrice: number; volume: number } | null> {
    // 1. Check if quote is in cache and fresh (<=10s)
    const cachedQuote = this.getQuote(symbol);
    if (cachedQuote) {
      return {
        lastPrice: cachedQuote.lastPrice,
        bidPrice: cachedQuote.bidPrice,
        askPrice: cachedQuote.askPrice,
        volume: cachedQuote.volume || 0
      };
    }

    // 2. If no fresh cache, try REST API to fetch current quote
    const stockQuote = await this.getStockQuote(symbol);
    if (stockQuote) {
      // getStockQuote already updates the cache, so fetch from cache again
      const updatedQuote = this.getQuote(symbol);
      if (updatedQuote) {
        return {
          lastPrice: updatedQuote.lastPrice,
          bidPrice: updatedQuote.bidPrice,
          askPrice: updatedQuote.askPrice,
          volume: updatedQuote.volume || 0
        };
      }
    }

    // 3. No data available from either source
    return null;
  }

  /**
   * Get real-time stock quote using REST API (fallback when WebSocket cache is stale)
   * Options Advanced plan includes stock NBBO data via REST API
   */
  async getStockQuote(symbol: string): Promise<{ price: number; changePercent: number } | null> {
    try {
      // First check cache for fresh data
      const cachedQuote = this.getQuote(symbol);
      if (cachedQuote) {
        console.log(`✅ ${symbol}: Using Polygon WebSocket cache - $${cachedQuote.lastPrice.toFixed(2)}`);
        return {
          price: cachedQuote.lastPrice,
          changePercent: 0 // Polygon doesn't provide changePercent easily
        };
      }

      // Fallback to REST API if cache is stale or empty
      if (!this.apiKey) {
        return null;
      }

      // Skip market index symbols (^GSPC, ^VIX, etc.) - Polygon doesn't support these
      if (symbol.includes('^') || symbol.includes('%5E')) {
        return null;
      }

      // Use Polygon REST API for real-time NBBO (National Best Bid and Offer)
      // Options Advanced plan includes access to stock quotes
      // Using query parameter authentication (Polygon's standard method)
      const response = await axios.get(
        `https://api.polygon.io/v2/last/nbbo/${symbol}`,
        {
          params: {
            apiKey: this.apiKey
          },
          timeout: 5000
        }
      );

      if (response.data?.status === 'OK' && response.data?.results) {
        const result = response.data.results;
        // Use midpoint of bid/ask as price
        const price = result.P ? result.P : (result.p + result.P) / 2;
        
        console.log(`✅ ${symbol}: Using Polygon REST API - $${price.toFixed(2)}`);
        
        // Cache the result for future use
        this.quoteCache.set(symbol, {
          symbol,
          bidPrice: result.p || price,
          askPrice: result.P || price,
          lastPrice: price,
          markPrice: price,
          volume: result.s || 0,
          timestamp: Date.now()
        });

        return {
          price,
          changePercent: 0
        };
      }

      return null;
    } catch (error: any) {
      console.log(`⚠️ ${symbol}: Polygon REST API error - ${error.message}`);
      return null;
    }
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
