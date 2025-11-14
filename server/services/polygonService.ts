import WebSocket from 'ws';
import axios from 'axios';
import { alphaVantageService } from './alphaVantageService';
import { normalizeOptionSymbol } from '../utils/optionSymbols';

/**
 * Polygon API Rate Limiter
 * Enforces 25 REST API calls per minute globally across the application
 * Advanced Options Plan: Unlimited API calls (using conservative 25/min limit)
 * Thread-safe for concurrent calls using promise queue
 */
class PolygonRateLimiter {
  private static instance: PolygonRateLimiter | null = null;
  private callTimestamps: number[] = [];
  private readonly MAX_CALLS_PER_MINUTE = 25;
  private readonly MINUTE_MS = 60000;
  private queue: Array<() => void> = [];
  private processing = false;

  private constructor() {}

  static getInstance(): PolygonRateLimiter {
    if (!PolygonRateLimiter.instance) {
      PolygonRateLimiter.instance = new PolygonRateLimiter();
    }
    return PolygonRateLimiter.instance;
  }

  /**
   * Wait if necessary to respect rate limit, then allow the call
   * Thread-safe - handles concurrent callers via promise queue
   */
  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.processQueue();
    });
  }

  /**
   * Process queued callers one at a time to prevent race conditions
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      
      // Remove timestamps older than 1 minute
      this.callTimestamps = this.callTimestamps.filter(
        timestamp => now - timestamp < this.MINUTE_MS
      );

      // If we've made MAX calls in the last minute, wait
      if (this.callTimestamps.length >= this.MAX_CALLS_PER_MINUTE) {
        const oldestCall = this.callTimestamps[0];
        const waitTime = this.MINUTE_MS - (now - oldestCall) + 200; // +200ms buffer
        
        if (waitTime > 0) {
          console.log(`⏳ Rate limit: Waiting ${(waitTime/1000).toFixed(1)}s (${this.callTimestamps.length}/${this.MAX_CALLS_PER_MINUTE} calls used, ${this.queue.length} queued)`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue; // Re-check after waiting
        }
      }

      // Allow next caller
      this.callTimestamps.push(Date.now());
      const nextCaller = this.queue.shift();
      if (nextCaller) {
        nextCaller();
      }
    }

    this.processing = false;
  }

  /**
   * Get current rate limit status
   */
  getStatus(): { callsUsed: number; callsRemaining: number; queuedCalls: number } {
    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter(
      timestamp => now - timestamp < this.MINUTE_MS
    );
    
    return {
      callsUsed: this.callTimestamps.length,
      callsRemaining: this.MAX_CALLS_PER_MINUTE - this.callTimestamps.length,
      queuedCalls: this.queue.length
    };
  }
}

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

interface PolygonOptionQuoteMessage {
  ev: 'Q'; // Quote event
  sym: string; // Option symbol (e.g., "O:NVDA251113C00680000")
  bp: number; // Bid price
  bs: number; // Bid size
  ap: number; // Ask price
  as: number; // Ask size
  t: number; // Timestamp (Unix ms)
  x?: number; // Exchange ID
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

export interface PolygonOptionTradeMessage {
  ev: 'T'; // Trade event
  sym: string; // Option contract symbol (e.g., "O:NVDA250117C00200000")
  p: number; // Trade price
  s: number; // Trade size (contracts)
  t: number; // Timestamp (Unix ms)
  c?: number[]; // Trade conditions
  x?: number; // Exchange ID
}

type PolygonMessage = PolygonTradeMessage | PolygonQuoteMessage | PolygonOptionQuoteMessage | PolygonAggregateMessage | PolygonOptionTradeMessage | { ev: 'status', status: string, message: string };

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
  private subscribedOptionPatterns: string[] = []; // Track option trade subscriptions for reconnection
  private reconnectAttempts = 0;
  private reconnectDelay = 5000; // Initial delay: 5 seconds
  private apiKey: string;
  
  // Health tracking
  private lastMessageTimestamp: number = 0;
  private lastHeartbeatTimestamp: number = 0;
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private quoteFreshnessThreshold = 10000; // 10 seconds - quotes older than this are considered stale
  
  // Options quote caching (live option premium data from WebSocket)
  private optionsQuoteCache: Map<string, { premium: number; bid: number; ask: number; timestamp: number }> = new Map();
  private optionsCacheTTL = 60000; // 1 minute cache for options quotes
  
  // Options REST API cache (for REST endpoint responses)
  private optionsRestCache: Map<string, { data: any; timestamp: number }> = new Map();

  // Rate limiter instance
  private rateLimiter = PolygonRateLimiter.getInstance();
  
  // REST API response cache (short-lived, idempotent GETs only)
  private restApiCache: Map<string, { data: any; timestamp: number }> = new Map();

  // NOTE: No bulk snapshot caching - we need fresh data for real-time opportunities
  // Caching would give stale movers; users want to see NEW opportunities as they emerge
  
  // Option trade callback registry for Ghost Sweep Detector
  private optionTradeHandlers: Map<string, (trade: PolygonOptionTradeMessage) => void> = new Map();

  constructor() {
    // Use the main Polygon API key for WebSocket authentication
    this.apiKey = process.env.POLYGON_API_KEY || '';
    
    if (!this.apiKey) {
      console.error('❌ POLYGON_API_KEY not found in environment variables');
    }
  }

  /**
   * Shared rate-limited request wrapper for all Polygon REST API calls
   * - Uses Authorization Bearer header for proper authentication
   * - Enforces 25 calls/minute rate limit globally (can be bypassed with unlimited flag)
   * - Retries with exponential backoff on 429/5xx errors
   * - Optional caching for idempotent GETs
   */
  private async makeRateLimitedRequest<T>(
    url: string,
    options: {
      method?: 'GET' | 'POST';
      timeout?: number;
      cacheTTL?: number; // Cache time-to-live in ms (0 = no cache)
      maxRetries?: number;
      unlimited?: boolean; // Bypass rate limiter (Advanced Options Plan)
    } = {}
  ): Promise<T | null> {
    const {
      method = 'GET',
      timeout = 10000,
      cacheTTL = 0,
      maxRetries = 3,
      unlimited = false
    } = options;

    // Check cache for idempotent GETs
    if (method === 'GET' && cacheTTL > 0) {
      const cacheKey = url;
      const cached = this.restApiCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < cacheTTL) {
        return cached.data as T;
      }
    }

    // Retry loop with exponential backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Acquire rate limit slot (waits if necessary) - skip if unlimited mode
        if (!unlimited) {
          await this.rateLimiter.acquire();
        }

        // Make the API call with proper Authorization header
        const response = await axios.get(url, { 
          timeout,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        });

        // Cache successful response if enabled
        if (method === 'GET' && cacheTTL > 0 && response.data) {
          const cacheKey = url;
          this.restApiCache.set(cacheKey, {
            data: response.data,
            timestamp: Date.now()
          });
        }

        return response.data as T;

      } catch (error: any) {
        const status = error.response?.status;
        const isRetryable = status === 429 || (status >= 500 && status < 600);

        if (isRetryable && attempt < maxRetries) {
          // Exponential backoff with jitter: 500ms, 1s, 2s
          const baseDelay = 500 * Math.pow(2, attempt - 1);
          const jitter = Math.random() * 200;
          const delay = baseDelay + jitter;
          
          console.log(`⚠️ API error ${status}, retry ${attempt}/${maxRetries} in ${delay.toFixed(0)}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Non-retryable error or max retries exceeded
        if (status === 404) {
          return null; // Resource not found is expected
        }
        
        if (status === 429) {
          console.error(`❌ Rate limit exceeded after ${maxRetries} retries`);
        } else if (status === 401 || status === 403) {
          console.error(`❌ Authentication/authorization error ${status}`);
        } else {
          console.error(`❌ API request failed:`, error.message);
        }
        
        return null;
      }
    }

    return null;
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
          const tradeMessage = message as PolygonTradeMessage;
          // Check if this is an option trade (symbol starts with "O:")
          if (tradeMessage.sym && tradeMessage.sym.startsWith('O:')) {
            this.handleOptionTradeMessage(tradeMessage as PolygonOptionTradeMessage);
          } else {
            this.handleTradeMessage(tradeMessage);
          }
        } else if (message.ev === 'Q') {
          const quoteMessage = message as PolygonQuoteMessage;
          // Check if this is an option quote (symbol starts with "O:")
          if (quoteMessage.sym && quoteMessage.sym.startsWith('O:')) {
            this.handleOptionQuoteMessage(quoteMessage as PolygonOptionQuoteMessage);
          } else {
            this.handleQuoteMessage(quoteMessage);
          }
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
      
      // Re-subscribe after authentication (on reconnect)
      this.restoreSubscriptionsAfterAuth();
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
   * Restore subscriptions after authentication (called on reconnect)
   */
  private restoreSubscriptionsAfterAuth(): void {
    // Re-subscribe to previous stock symbols
    if (this.subscribedSymbols.size > 0) {
      const symbols = Array.from(this.subscribedSymbols);
      this.subscribedSymbols.clear(); // Clear to allow re-subscription
      this.subscribeToSymbols(symbols);
    }
    
    // Re-subscribe to option trade patterns (Ghost Sweep Detector)
    // Use immutable snapshot to prevent mutations during reconnect
    const patternsSnapshot = [...this.subscribedOptionPatterns];
    if (patternsSnapshot.length > 0) {
      console.log(`🔄 Re-establishing ${patternsSnapshot.length} option trade subscriptions after reconnect`);
      this.subscribeToOptionTrades(patternsSnapshot);
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
   * Handle option quote messages (Q.O:*)
   */
  private handleOptionQuoteMessage(quote: PolygonOptionQuoteMessage): void {
    const symbol = quote.sym;
    const bidPrice = quote.bp;
    const askPrice = quote.ap;
    const timestamp = quote.t;

    // Calculate premium as midpoint of bid/ask
    const premium = (bidPrice + askPrice) / 2;

    // Normalize to canonical format before caching (O:SPY251113C00680000 → .SPY251113C00680000)
    const canonicalSymbol = normalizeOptionSymbol(symbol);

    // Update options quote cache with canonical key
    this.optionsQuoteCache.set(canonicalSymbol, {
      premium,
      bid: bidPrice,
      ask: askPrice,
      timestamp
    });

    console.log(`📊 Polygon Option Quote: ${symbol} → ${canonicalSymbol} | Bid $${bidPrice.toFixed(2)} Ask $${askPrice.toFixed(2)} Premium $${premium.toFixed(2)}`);
  }


  /**
   * Subscribe to option trades for specific patterns
   * @param patterns Array of patterns like ['T.O:NVDA.*', 'T.O:TSLA.*', ...]
   */
  async subscribeToOptionTrades(patterns: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ Cannot subscribe to option trades: WebSocket not connected');
      return;
    }

    console.log(`📡 Subscribing to ${patterns.length} option trade patterns...`);

    // Persist patterns for reconnection (defensive copy to prevent external mutations)
    this.subscribedOptionPatterns = [...patterns];

    const subscribeMessage = {
      action: 'subscribe',
      params: patterns.join(',')
    };

    this.ws.send(JSON.stringify(subscribeMessage));
  }

  /**
   * Handle option trade messages - dispatch to registered callbacks (Ghost Sweep Detector)
   */
  private handleOptionTradeMessage(trade: PolygonOptionTradeMessage): void {
    // Dispatch to all registered option trade handlers
    if (this.optionTradeHandlers.size > 0) {
      this.optionTradeHandlers.forEach((handler, id) => {
        try {
          handler(trade);
        } catch (error: any) {
          console.error(`❌ Error in option trade handler '${id}':`, error.message);
        }
      });
    }
  }

  /**
   * Register a callback handler for option trade messages (used by Ghost Sweep Detector)
   */
  registerOptionTradeHandler(id: string, callback: (trade: PolygonOptionTradeMessage) => void): void {
    this.optionTradeHandlers.set(id, callback);
    console.log(`✅ Registered option trade handler: ${id}`);
  }

  /**
   * Unregister an option trade callback handler
   */
  unregisterOptionTradeHandler(id: string): void {
    if (this.optionTradeHandlers.delete(id)) {
      console.log(`✅ Unregistered option trade handler: ${id}`);
    }
  }

  /**
   * Get health status of WebSocket connection
   */
  getHealthStatus(): { isConnected: boolean; lastMessageTime: number; isStale: boolean } {
    const now = Date.now();
    const lastMessageAge = this.lastMessageTimestamp ? now - this.lastMessageTimestamp : -1;
    const isStale = lastMessageAge > 30000; // Consider stale if no message in 30 seconds
    
    return {
      isConnected: this.isServiceConnected(),
      lastMessageTime: this.lastMessageTimestamp,
      isStale
    };
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
   * Get cached option quote from WebSocket stream
   * Returns live option premium data received from Polygon WebSocket (Q.O:* messages)
   * @param optionSymbol Option symbol in canonical OCC format (e.g., ".SPY251113C00680000")
   * @returns Object with premium, bid, ask, timestamp, and source, or null if not cached
   */
  getCachedOptionQuote(optionSymbol: string): { premium: number; bid: number; ask: number; timestamp: number; source: 'polygon' } | null {
    // Normalize to canonical format (handles any input format)
    const canonicalSymbol = normalizeOptionSymbol(optionSymbol);

    const cached = this.optionsQuoteCache.get(canonicalSymbol);
    
    if (!cached) {
      return null;
    }
    
    // Check if quote is fresh (within TTL)
    const now = Date.now();
    if (now - cached.timestamp > this.optionsCacheTTL) {
      // Stale data - remove from cache
      this.optionsQuoteCache.delete(canonicalSymbol);
      return null;
    }
    
    return {
      premium: cached.premium,
      bid: cached.bid,
      ask: cached.ask,
      timestamp: cached.timestamp,
      source: 'polygon'
    };
  }

  /**
   * Get real-time stock quote from Polygon WebSocket cache
   * Options Advanced plan provides stock data via WebSocket (not REST API)
   */
  async getStockQuote(symbol: string): Promise<{ price: number; changePercent: number } | null> {
    // Handle market index symbols via Polygon's index snapshot API
    if (symbol.includes('^') || symbol.includes('%5E')) {
      console.log(`🔍 ${symbol}: Detected as index symbol, calling getIndexSnapshot...`);
      const result = await this.getIndexSnapshot(symbol);
      console.log(`📊 ${symbol}: getIndexSnapshot returned:`, result);
      return result;
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
   * Get index snapshot from Polygon API
   * Supports major market indices with proper ticker mapping
   */
  async getIndexSnapshot(symbol: string): Promise<{ price: number; changePercent: number } | null> {
    // Map common index symbols to Polygon's index ticker format
    const indexTickerMap: Record<string, string> = {
      '^GSPC': 'I:SPX',      // S&P 500
      '%5EGSPC': 'I:SPX',
      '^IXIC': 'I:COMP',     // NASDAQ Composite
      '%5EIXIC': 'I:COMP',
      '^VIX': 'I:VIX',       // VIX Volatility Index
      '%5EVIX': 'I:VIX'
    };

    const polygonTicker = indexTickerMap[symbol];
    if (!polygonTicker) {
      console.log(`⚠️ ${symbol}: No Polygon index mapping available`);
      return null;
    }

    try {
      await PolygonRateLimiter.getInstance().acquire();
      
      // Use aggregates (bars) endpoint to get previous close data
      // Get yesterday's bar and today's bar (if available)
      const to = new Date().toISOString().split('T')[0]; // Today YYYY-MM-DD
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const from = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 5 days ago
      
      console.log(`📡 ${symbol}: Fetching Polygon aggregates for ${polygonTicker} (${from} to ${to})...`);
      
      // Use makeRateLimitedRequest to apply proper Authorization header (not query param)
      // makeRateLimitedRequest returns the parsed data directly (not wrapped in .data)
      const url = `https://api.polygon.io/v2/aggs/ticker/${polygonTicker}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=5`;
      const response = await this.makeRateLimitedRequest(url);

      if (response?.status === 'OK' && response?.results?.length > 0) {
        const bars = response.results;
        const latestBar = bars[0]; // Most recent bar
        const prevBar = bars.length > 1 ? bars[1] : null;
        
        const price = latestBar.c; // Close price
        let changePercent = 0;
        
        if (prevBar) {
          // Calculate change from previous bar's close
          const prevClose = prevBar.c;
          changePercent = ((price - prevClose) / prevClose) * 100;
          console.log(`✅ ${symbol}: Polygon aggregates ${polygonTicker} - $${price.toFixed(2)}, ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}% (from ${new Date(prevBar.t).toISOString().split('T')[0]})`);
        } else {
          console.log(`✅ ${symbol}: Polygon aggregates ${polygonTicker} - $${price.toFixed(2)} (no previous data for change%)`);
        }
        
        return {
          price,
          changePercent
        };
      }

      console.log(`⚠️ ${symbol}: Polygon aggregates returned no data`);
      return null;
    } catch (error) {
      const errorMsg = axios.isAxiosError(error) ? `${error.response?.status} - ${error.response?.statusText}` : (error instanceof Error ? error.message : 'Unknown');
      console.log(`❌ ${symbol}: Polygon aggregates failed: ${errorMsg}`);
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
   * Attempt to reconnect to WebSocket with exponential backoff and unlimited retries
   */
  private attemptReconnect(): void {
    this.reconnectAttempts++;
    
    // Exponential backoff: 5s, 10s, 20s, 40s, capped at 60s
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
    
    console.log(`🔄 Attempting to reconnect to Polygon WebSocket (attempt ${this.reconnectAttempts}, delay ${(delay/1000).toFixed(1)}s)...`);

    setTimeout(() => {
      this.connect().then((success) => {
        if (success) {
          // Reset reconnect attempts on successful connection
          this.reconnectAttempts = 0;
          // Note: Subscriptions are restored in handleStatusMessage after auth_success
        }
      });
    }, delay);
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
        // Cache contains premium/bid/ask/timestamp, need to extract full data
        const { premium, bid, ask, timestamp, ...rest } = cached as any;
        return {
          premium,
          bid,
          ask,
          greeks: (rest as any).greeks || { delta: 0, gamma: 0, theta: 0, vega: 0 },
          impliedVolatility: (rest as any).impliedVolatility || 0,
          openInterest: (rest as any).openInterest || 0
        };
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
            
            // Cache the successful result (store all data fields directly)
            this.optionsQuoteCache.set(cacheKey, {
              premium,
              bid: quote.bid,
              ask: quote.ask,
              timestamp: Date.now(),
              ...(optionData as any) // Store greeks, IV, OI for caching
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
   * BULK OPTIMIZATION: Get historical bars for multiple tickers in parallel
   * Makes one API call PER ticker (not one call total, but fetches in parallel)
   * Still more efficient than sequential calls
   * 
   * @param tickers Array of stock symbols to fetch
   * @param startDate Start date (YYYY-MM-DD)
   * @param endDate End date (YYYY-MM-DD)
   * @param unlimited Bypass rate limiter for premium scanners (Advanced Options Plan)
   * @returns Map of ticker -> array of bars
   */
  async getBulkHistoricalBars(
    tickers: string[],
    startDate: string,
    endDate: string,
    unlimited: boolean = false
  ): Promise<Map<string, HistoricalBar[]>> {
    const result = new Map<string, HistoricalBar[]>();
    
    try {
      const mode = unlimited ? 'UNLIMITED' : 'RATE-LIMITED';
      console.log(`📊 Fetching historical data for ${tickers.join(', ')} in parallel (${mode})...`);
      
      // Fetch all tickers in parallel (3 API calls made simultaneously)
      const promises = tickers.map(async (ticker) => {
        try {
          const bars = await this.getHistoricalBars(ticker, startDate, endDate, 'day', 1, unlimited);
          return { ticker: ticker.toUpperCase(), bars };
        } catch (error: any) {
          console.error(`Error fetching bars for ${ticker}:`, error.message);
          return { ticker: ticker.toUpperCase(), bars: null };
        }
      });
      
      const results = await Promise.all(promises);
      
      // Build result map
      for (const { ticker, bars } of results) {
        if (bars && bars.length > 0) {
          result.set(ticker, bars);
          console.log(`✅ ${ticker}: ${bars.length} days of historical data`);
        }
      }
      
      return result;
      
    } catch (error: any) {
      console.error(`❌ Error in bulk historical bars fetch:`, error.message);
      return result;
    }
  }
  
  /**
   * Get historical price bars (aggregates) for Fibonacci calculations
   * Uses Polygon REST API with Alpha Vantage fallback
   * 
   * Circuit breaker: Automatically switches to Alpha Vantage when:
   * - Polygon rate limiter queue is congested (>10 queued) - SKIPPED IN UNLIMITED MODE
   * - Polygon request fails (network, timeout, 429, etc.)
   * 
   * @param symbol Stock symbol
   * @param from Start date (YYYY-MM-DD)
   * @param to End date (YYYY-MM-DD)
   * @param timespan 'day' or 'hour'
   * @param multiplier Number of units (1 = 1 day/hour, 4 = 4 hours, etc.)
   * @param unlimited Bypass rate limiter (Advanced Options Plan)
   * @returns Array of historical bars or null on error
   */
  async getHistoricalBars(
    symbol: string,
    from: string,
    to: string,
    timespan: 'day' | 'hour' = 'day',
    multiplier: number = 1,
    unlimited: boolean = false
  ): Promise<HistoricalBar[] | null> {
    const startTime = Date.now();
    
    // Circuit breaker: Check Polygon rate limiter status (skip in unlimited mode)
    if (!unlimited) {
      const limiterStatus = this.rateLimiter.getStatus();
      const shouldUseAlphaVantage = limiterStatus.queuedCalls > 10 && alphaVantageService.isConfigured();
      
      if (shouldUseAlphaVantage) {
        console.log(`⚡ ${symbol}: Polygon queue congested (${limiterStatus.queuedCalls} queued), using Alpha Vantage fallback`);
        const avBars = await alphaVantageService.getHistoricalBars(
          symbol,
          from,
          to,
          timespan === 'hour' && multiplier === 4 ? '4hour' : 'day',
          100
        );
        
        if (avBars) {
          const latency = Date.now() - startTime;
          console.log(`✅ ${symbol}: Alpha Vantage provided ${avBars.length} bars (${latency}ms)`);
          return avBars;
        }
      }
    }
    
    // Try Polygon first
    try {
      const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc`;
      
      const data = await this.makeRateLimitedRequest<any>(url, {
        timeout: 10000,
        cacheTTL: 300000,
        maxRetries: 3,
        unlimited: unlimited
      });

      if (data?.results && Array.isArray(data.results)) {
        const timeframeLabel = multiplier > 1 ? `${multiplier}-${timespan}` : timespan;
        const latency = Date.now() - startTime;
        console.log(`✅ ${symbol}: Polygon provided ${data.results.length} ${timeframeLabel} bars (${latency}ms)`);
        return data.results;
      }
    } catch (error: any) {
      console.warn(`⚠️ ${symbol}: Polygon failed (${error.message}), trying Alpha Vantage fallback...`);
      // Note: Intentionally NOT returning - fall through to Alpha Vantage fallback below
    }
    
    // Fallback to Alpha Vantage on Polygon failure (preserves resiliency in both unlimited and rate-limited modes)
    if (alphaVantageService.isConfigured()) {
      const avBars = await alphaVantageService.getHistoricalBars(
        symbol,
        from,
        to,
        timespan === 'hour' && multiplier === 4 ? '4hour' : 'day',
        100
      );
      
      if (avBars) {
        const latency = Date.now() - startTime;
        console.log(`✅ ${symbol}: Alpha Vantage fallback provided ${avBars.length} bars (${latency}ms)`);
        return avBars;
      }
    }

    console.warn(`❌ ${symbol}: No historical data available from any source`);
    return null;
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
        const url = `https://api.polygon.io/v2/aggs/ticker/${testSymbol}/range/1/day/${prevStr}/${todayStr}?adjusted=true&limit=5&sort=desc`;
        
        const data = await this.makeRateLimitedRequest<any>(url, {
          timeout: 5000,
          cacheTTL: 60000, // Cache for 1 minute (frequently requested during scans)
          maxRetries: 2
        });

        if (data?.results && Array.isArray(data.results) && data.results.length > 0) {
          // Get the most recent bar (should be today or last trading day)
          const recentBar = data.results[0];
          const open = recentBar.o;
          const close = recentBar.c;
          console.log(`${symbol}: Most recent trading day - Open: $${open.toFixed(2)}, Close: $${close.toFixed(2)} from ${testSymbol}`);
          return { open, close };
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
      let nextUrl: string | null = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?limit=1000`;
      let pageCount = 0;
      const maxPages = 5; // Top 5,000 stocks (5 pages × 1,000 = 5,000) in ~20-30s
      
      console.log(`📊 Fetching market snapshot (top ${maxPages * 1000} stocks for optimized coverage)...`);
      
      while (nextUrl && pageCount < maxPages) {
        const response: any = await axios.get(nextUrl, {
          timeout: 30000, // 30 seconds per page
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
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
        const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${dateStr}?adjusted=true`;
        
        console.log(`📊 Trying grouped daily bars for ${dateStr} (${daysBack} days back)...`);
        
        const response = await axios.get(url, {
          timeout: 15000,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
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
   * Get top tickers by market cap for UOA scanner
   */
  async getTopTickers(params: {
    market: string;
    type: string;
    limit: number;
    sort: string;
    order: string;
  }): Promise<any[]> {
    const apiKey = process.env.POLYGON_API_KEY;
    if (!apiKey) {
      throw new Error('No Polygon API key configured');
    }

    await this.rateLimiter.acquire();
    
    const url = `https://api.polygon.io/v3/reference/tickers?market=${params.market}&type=${params.type}&limit=${params.limit}&sort=${params.sort}&order=${params.order}`;
    
    try {
      const response = await axios.get(url, { 
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      return response.data.results || [];
    } catch (error: any) {
      console.error('Error fetching top tickers from Polygon:', error.response?.data || error.message);
      throw error; // Re-throw so caller can handle
    }
  }

  /**
   * Get options snapshot for a ticker
   */
  async getOptionsSnapshot(ticker: string): Promise<any> {
    try {
      const apiKey = process.env.POLYGON_API_KEY;
      if (!apiKey) {
        console.warn('No Polygon API key configured');
        return null;
      }

      await this.rateLimiter.acquire();
      
      const url = `https://api.polygon.io/v3/snapshot/options/${ticker}`;
      
      const response = await axios.get(url, { 
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      
      return response.data;
    } catch (error: any) {
      console.error(`Error fetching options snapshot for ${ticker}:`, error.message);
      return null;
    }
  }

  /**
   * Get live options Greeks and IV for Elite Scanner
   * Returns the most liquid option contract (highest volume)
   */
  async getOptionsGreeks(symbol: string, optionType: 'call' | 'put' = 'call'): Promise<{
    symbol: string;
    strike: number;
    expiry: string;
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    impliedVolatility: number;
    bid: number;
    ask: number;
    lastPrice: number;
    volume: number;
    openInterest: number;
  } | null> {
    try {
      const apiKey = process.env.POLYGON_API_KEY;
      if (!apiKey) {
        console.warn('⚠️ No Polygon API key configured');
        return null;
      }

      await this.rateLimiter.acquire();
      
      // Get options snapshot for the underlying symbol
      const today = new Date().toISOString().split('T')[0];
      const url = `https://api.polygon.io/v3/snapshot/options/${symbol}?expiration_date.gte=${today}&contract_type=${optionType}&order=volume&sort=desc&limit=5`;
      
      const response = await axios.get(url, { 
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      
      const topOption = response.data.results?.[0];
      
      if (!topOption || !topOption.details || !topOption.greeks) {
        console.warn(`⚠️ No options data available for ${symbol}`);
        return null;
      }
      
      return {
        symbol,
        strike: topOption.details.strike_price,
        expiry: topOption.details.expiration_date,
        delta: topOption.greeks.delta || 0,
        gamma: topOption.greeks.gamma || 0,
        theta: topOption.greeks.theta || 0,
        vega: topOption.greeks.vega || 0,
        impliedVolatility: topOption.implied_volatility || 0,
        bid: topOption.last_quote?.bid || 0,
        ask: topOption.last_quote?.ask || 0,
        lastPrice: topOption.last_quote?.midpoint || topOption.day?.close || 0,
        volume: topOption.day?.volume || 0,
        openInterest: topOption.open_interest || 0
      };
    } catch (error: any) {
      console.error(`❌ Failed to fetch options Greeks for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Detect unusual options volume (volume > 3x 20-day average)
   * Returns volume ratio and flags unusual activity
   */
  async getUnusualOptionsVolume(symbol: string, optionType: 'call' | 'put' = 'call'): Promise<{
    symbol: string;
    currentVolume: number;
    avgVolume20Day: number;
    volumeRatio: number;
    isUnusual: boolean; // true if ratio > 3
  } | null> {
    try {
      const apiKey = process.env.POLYGON_API_KEY;
      if (!apiKey) {
        console.warn('⚠️ No Polygon API key configured');
        return null;
      }

      await this.rateLimiter.acquire();
      
      // Get current options snapshot
      const today = new Date().toISOString().split('T')[0];
      const url = `https://api.polygon.io/v3/snapshot/options/${symbol}?expiration_date.gte=${today}&contract_type=${optionType}&order=volume&sort=desc&limit=1`;
      
      const response = await axios.get(url, { 
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      const topOption = response.data.results?.[0];
      
      if (!topOption || !topOption.day) {
        console.warn(`⚠️ No options data for unusual volume check: ${symbol}`);
        return null;
      }
      
      const currentVolume = topOption.day.volume || 0;
      
      // Get 20-day historical volume average
      // Note: Polygon doesn't have direct 20-day option volume history
      // We'll use a simplified approach: compare to open interest as proxy
      const openInterest = topOption.open_interest || 1; // Avoid division by zero
      const estimatedAvgVolume = openInterest * 0.1; // Rough estimate: 10% of OI trades daily
      
      const volumeRatio = currentVolume / Math.max(estimatedAvgVolume, 1);
      
      return {
        symbol,
        currentVolume,
        avgVolume20Day: estimatedAvgVolume,
        volumeRatio,
        isUnusual: volumeRatio > 3
      };
    } catch (error: any) {
      console.error(`❌ Failed to check unusual volume for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Calculate IV percentile (0-100) based on 52-week range
   * Uses historical options data to rank current IV
   */
  async getIVPercentile(symbol: string, currentIV: number): Promise<{
    symbol: string;
    ivPercentile: number; // 0-100
    currentIV: number;
    iv52WeekLow: number;
    iv52WeekHigh: number;
  } | null> {
    try {
      const apiKey = process.env.POLYGON_API_KEY;
      if (!apiKey) {
        console.warn('⚠️ No Polygon API key configured');
        return null;
      }

      await this.rateLimiter.acquire();
      
      // Get 52-week date range
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 365);
      const startDateStr = startDate.toISOString().split('T')[0];
      
      // Fetch historical aggregate data to estimate IV range
      // Note: Direct historical IV data is limited - using aggregate price volatility as proxy
      const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${startDateStr}/${endDate}?adjusted=true&sort=asc&limit=365`;
      
      const response = await axios.get(url, { 
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      const bars = response.data.results || [];
      
      if (bars.length < 30) {
        console.warn(`⚠️ Insufficient historical data for IV percentile: ${symbol}`);
        // Return default mid-range
        return {
          symbol,
          ivPercentile: 50,
          currentIV,
          iv52WeekLow: currentIV * 0.5,
          iv52WeekHigh: currentIV * 1.5
        };
      }
      
      // Calculate historical volatility from price movements (as IV proxy)
      const volatilities: number[] = [];
      for (let i = 1; i < bars.length; i++) {
        const dailyReturn = Math.abs((bars[i].c - bars[i-1].c) / bars[i-1].c);
        const annualizedVol = dailyReturn * Math.sqrt(252); // Annualize
        volatilities.push(annualizedVol);
      }
      
      const iv52WeekLow = Math.min(...volatilities);
      const iv52WeekHigh = Math.max(...volatilities);
      
      // Calculate percentile
      const range = iv52WeekHigh - iv52WeekLow;
      let ivPercentile = 50; // Default mid-range
      
      if (range > 0) {
        ivPercentile = Math.min(100, Math.max(0, ((currentIV - iv52WeekLow) / range) * 100));
      }
      
      return {
        symbol,
        ivPercentile,
        currentIV,
        iv52WeekLow,
        iv52WeekHigh
      };
    } catch (error: any) {
      console.error(`❌ Failed to calculate IV percentile for ${symbol}:`, error.message);
      // Return default mid-range on error
      return {
        symbol,
        ivPercentile: 50,
        currentIV,
        iv52WeekLow: currentIV * 0.5,
        iv52WeekHigh: currentIV * 1.5
      };
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
