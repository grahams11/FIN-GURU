import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';

interface TastytradeSession {
  'session-token': string;
  'remember-token': string;
  user: {
    email: string;
    username: string;
  };
}

interface QuoteData {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  lastPrice: number;
  markPrice: number;
  volume: number;
  openInterest?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
}

interface OptionGreeksData {
  symbol: string;
  premium: number;          // Theoretical option price
  impliedVolatility: number;
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
  };
  quote?: {
    bidPrice: number;
    askPrice: number;
  };
  timestamp: number;
}

interface OptionQuoteData {
  premium: number;
  impliedVolatility: number;
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
  };
}

interface DXLinkToken {
  token: string;
  'dxlink-url': string;
  level: string;
  'ws-url'?: string;
}

interface AccountSnapshot {
  numericSummary: {
    dayEquityChange: number | undefined;
    todaysRealizedPnL: number | undefined;
    todaysUnrealizedPnL: number | undefined;
  };
  rawSummary: any;
  timestamp: number;
}

class TastytradeService {
  private baseURL = 'https://api.tastyworks.com';
  private certURL = 'https://api.cert.tastyworks.com'; // For testing
  private apiClient: AxiosInstance;
  private sessionToken: string | null = null;
  private rememberToken: string | null = null;
  private accountNumber: string | null = null;
  private dxlinkToken: string | null = null;
  private dxlinkUrl: string | null = null;
  private ws: WebSocket | null = null;
  private quoteCache: Map<string, QuoteData> = new Map();
  private optionsCache: Map<string, OptionGreeksData> = new Map();
  private pendingGreeks: Map<string, { resolve: (data: OptionGreeksData) => void; reject: (error: Error) => void }> = new Map();
  private subscribedSymbols: Set<string> = new Set();
  private isConnected = false;
  private accountSummary: Map<string, AccountSnapshot> = new Map(); // Store latest account summary with daily P/L

  constructor() {
    this.apiClient = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Authenticate with Tastytrade API and get session token
   */
  async authenticate(): Promise<boolean> {
    try {
      const username = process.env.TASTYTRADE_USERNAME;
      const password = process.env.TASTYTRADE_PASSWORD;

      if (!username || !password) {
        console.error('❌ Tastytrade credentials not found in environment variables');
        return false;
      }

      console.log('🔐 Authenticating with Tastytrade API...');

      const response = await this.apiClient.post<{ data: TastytradeSession }>('/sessions', {
        login: username,
        password: password,
        'remember-me': true,
      });

      if (response.data && response.data.data) {
        this.sessionToken = response.data.data['session-token'];
        this.rememberToken = response.data.data['remember-token'];
        
        // Set session token in headers for future requests (no Bearer prefix for Tastytrade)
        this.apiClient.defaults.headers.common['Authorization'] = this.sessionToken;

        console.log('✅ Tastytrade authentication successful');
        console.log(`👤 Logged in as: ${response.data.data.user.username}`);

        // Get account information
        await this.getAccountInfo();

        return true;
      }

      console.error('❌ Tastytrade authentication failed: Invalid response');
      return false;
    } catch (error: any) {
      console.error('❌ Tastytrade authentication error:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Get account information and store account number
   */
  private async getAccountInfo(): Promise<void> {
    try {
      console.log('🔍 Fetching account information...');
      const response = await this.apiClient.get('/customers/me/accounts');
      
      if (response.data && response.data.data && response.data.data.items) {
        const accounts = response.data.data.items;
        console.log(`📋 Found ${accounts.length} account(s)`);
        
        if (accounts.length > 0) {
          // Account number is nested inside account object
          this.accountNumber = accounts[0].account['account-number'];
          console.log('✅ Account authenticated');
        }
      } else {
        console.error('❌ Unexpected account response structure');
      }
    } catch (error: any) {
      console.error('❌ Error fetching account info:', error.response?.data || error.message);
    }
  }

  /**
   * Get DXLink WebSocket token for market data streaming
   */
  private async getDXLinkToken(): Promise<boolean> {
    try {
      if (!this.sessionToken) {
        await this.authenticate();
      }

      console.log('📡 Requesting DXLink quote tokens...');
      const response = await this.apiClient.get<{ data: DXLinkToken }>('/api-quote-tokens');
      
      if (response.data && response.data.data) {
        this.dxlinkToken = response.data.data.token;
        this.dxlinkUrl = response.data.data['dxlink-url'] || response.data.data['ws-url'] || null;
        console.log('✅ DXLink token obtained');
        console.log(`✅ DXLink URL: ${this.dxlinkUrl}`);
        return true;
      }

      console.error('❌ Failed to get DXLink token - no data in response');
      return false;
    } catch (error: any) {
      console.error('❌ Error getting DXLink token:', error.message);
      console.error('❌ Error details:', error.response?.data || error);
      return false;
    }
  }

  /**
   * Connect to DXLink WebSocket for real-time streaming
   */
  async connectWebSocket(): Promise<boolean> {
    try {
      if (!this.dxlinkToken) {
        const tokenObtained = await this.getDXLinkToken();
        if (!tokenObtained) return false;
      }

      if (!this.dxlinkUrl) {
        console.error('❌ No DXLink URL available');
        return false;
      }

      console.log('🔌 Connecting to DXLink WebSocket...');

      this.ws = new WebSocket(this.dxlinkUrl);

      return new Promise((resolve, reject) => {
        if (!this.ws) {
          reject(new Error('WebSocket not initialized'));
          return;
        }

        this.ws.on('open', () => {
          console.log('✅ DXLink WebSocket connected');
          
          // Wait for socket to be fully ready before sending messages
          setTimeout(() => {
            // Check if WebSocket is still open before sending
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              // Step 1: Send SETUP message
              this.ws.send(JSON.stringify({
                type: 'SETUP',
                channel: 0,
                keepaliveTimeout: 60,
                acceptKeepaliveTimeout: 60,
                version: '0.1-js/1.0.0'
              }));
              console.log('🔧 Sent SETUP message');
              
              // Step 2: Send AUTH message
              this.ws.send(JSON.stringify({
                type: 'AUTH',
                channel: 0,
                token: this.dxlinkToken
              }));
              console.log('🔐 Sent AUTH message');
            } else {
              console.warn('⚠️ WebSocket not ready, skipping SETUP/AUTH messages');
            }
          }, 100); // Small delay to ensure socket is ready
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            console.log('📨 Received:', JSON.stringify(message).substring(0, 300));

            // Handle AUTH_STATE response
            if (message.type === 'AUTH_STATE') {
              if (message.state === 'AUTHORIZED') {
                console.log('✅ DXLink authenticated');
                
                // Create feed channel (DXLink protocol step 2)
                this.ws?.send(JSON.stringify({
                  type: 'CHANNEL_REQUEST',
                  channel: 1,
                  service: 'FEED',
                  parameters: { contract: 'AUTO' }
                }));
                console.log('📡 Requested feed channel');
              } else if (message.state === 'UNAUTHORIZED') {
                // Sometimes we get UNAUTHORIZED before AUTHORIZED - wait a bit
                console.log('⏳ Waiting for authorization...');
              }
            }

            // Handle CHANNEL_OPENED response
            if (message.type === 'CHANNEL_OPENED' && message.channel === 1) {
              console.log('✅ Feed channel opened');
              
              // Setup feed (DXLink protocol step 3)
              this.ws?.send(JSON.stringify({
                type: 'FEED_SETUP',
                channel: 1,
                acceptAggregationPeriod: 10.0,
                acceptDataFormat: 'COMPACT'
              }));
              console.log('✅ Feed setup complete');
              
              // Now request ACCOUNTS channel for daily P/L
              this.ws?.send(JSON.stringify({
                type: 'CHANNEL_REQUEST',
                channel: 2,
                service: 'ACCOUNTS'
              }));
              console.log('📡 Requested ACCOUNTS channel for daily P/L');
              
              this.isConnected = true;
              resolve(true);
            }
            
            // Handle ACCOUNTS channel opened
            if (message.type === 'CHANNEL_OPENED' && message.channel === 2) {
              console.log('✅ ACCOUNTS channel opened');
              
              // Subscribe to account summary with daily P/L fields
              this.ws?.send(JSON.stringify({
                type: 'ACCOUNTS_SUBSCRIPTION',
                channel: 2,
                add: [{
                  account: this.accountNumber,
                  fields: ['day-equity-change', 'todays-realized-profit-loss', 'todays-unrealized-profit-loss']
                }]
              }));
              console.log(`✅ Subscribed to account summary for ${this.accountNumber}`);
            }

            // Handle market data
            if (message.type === 'FEED_DATA' && message.data) {
              this.handleFeedData(message.data);
            }
            
            // Handle ACCOUNTS data (daily P/L)
            if (message.type === 'ACCOUNTS_DATA' && message.data) {
              this.handleAccountsData(message.data);
            }

            // Handle config messages
            if (message.type === 'FEED_CONFIG') {
              console.log('📋 Feed configured');
            }

            // Handle KEEPALIVE - must respond to keep connection alive
            if (message.type === 'KEEPALIVE' && message.channel === 0) {
              this.ws?.send(JSON.stringify({
                type: 'KEEPALIVE',
                channel: 0
              }));
              console.log('💓 Sent KEEPALIVE response');
            }
          } catch (error: any) {
            console.error('Error processing message:', error.message);
          }
        });

        this.ws.on('error', (error) => {
          console.error('❌ DXLink WebSocket error:', error.message);
          this.isConnected = false;
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('⚠️ DXLink WebSocket closed');
          this.isConnected = false;
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);
      });
    } catch (error: any) {
      console.error('❌ WebSocket connection error:', error.message);
      return false;
    }
  }

  /**
   * Handle incoming FEED_DATA messages from DXLink (COMPACT format)
   */
  private handleFeedData(data: any[]): void {
    try {
      if (!Array.isArray(data) || data.length < 2) {
        return;
      }

      // Compact format: [eventType, multipleEventsArray]
      const [eventType, events] = data;

      if (!Array.isArray(events) || events.length === 0) {
        return;
      }

      console.log(`📊 Received ${eventType} event`);

      // Process Quote events - each quote has 13 fields
      if (eventType === 'Quote') {
        const QUOTE_FIELD_COUNT = 13;
        let i = 0;
        let quotesProcessed = 0;
        
        while (i + QUOTE_FIELD_COUNT <= events.length) {
          // Extract fields for this quote
          const quoteType = events[i];     // "Quote"
          const symbol = events[i + 1];    // Symbol
          const bidPrice = events[i + 7];  // Bid price
          const askPrice = events[i + 11]; // Ask price
          
          if (quoteType === 'Quote' && symbol && typeof bidPrice === 'number' && typeof askPrice === 'number') {
            this.updateQuoteCache({
              eventSymbol: symbol,
              bidPrice,
              askPrice,
              lastPrice: (bidPrice + askPrice) / 2, // Mid price
            });
            console.log(`✅ Cached ${symbol}: Bid $${bidPrice} Ask $${askPrice}`);
            quotesProcessed++;
          }
          
          i += QUOTE_FIELD_COUNT;
        }
        
        if (quotesProcessed > 0) {
          console.log(`📊 Processed ${quotesProcessed} quotes`);
        }
      }

      // Process Trade events - each trade has 13 fields
      if (eventType === 'Trade') {
        const TRADE_FIELD_COUNT = 13;
        let i = 0;
        let tradesProcessed = 0;
        
        while (i + TRADE_FIELD_COUNT <= events.length) {
          // Extract fields for this trade
          const tradeType = events[i];     // "Trade"
          const symbol = events[i + 1];    // Symbol
          const price = events[i + 7];     // Last trade price
          
          if (tradeType === 'Trade' && symbol && typeof price === 'number') {
            this.updateQuoteCache({
              eventSymbol: symbol,
              lastPrice: price,
              bidPrice: 0,
              askPrice: 0,
            });
            console.log(`✅ Cached ${symbol}: $${price.toFixed(2)} (from trade)`);
            tradesProcessed++;
          }
          
          i += TRADE_FIELD_COUNT;
        }
        
        if (tradesProcessed > 0) {
          console.log(`📊 Processed ${tradesProcessed} trades`);
        }
      }

      // Process Greeks events - each event has 11 fields
      if (eventType === 'Greeks') {
        const GREEKS_FIELD_COUNT = 11;
        let i = 0;
        let greeksProcessed = 0;
        
        while (i + GREEKS_FIELD_COUNT <= events.length) {
          // Extract fields for Greeks event
          const greeksType = events[i];        // "Greeks"
          const symbol = events[i + 1];        // Symbol (e.g., ".SPX251114C06850000")
          const price = events[i + 2];         // Theoretical option price (premium)
          const volatility = events[i + 3];    // Implied volatility
          const delta = events[i + 4];
          const gamma = events[i + 5];
          const theta = events[i + 6];
          const rho = events[i + 7];
          const vega = events[i + 8];
          
          if (greeksType === 'Greeks' && symbol && typeof price === 'number' && typeof volatility === 'number') {
            const optionData: OptionGreeksData = {
              symbol,
              premium: price,
              impliedVolatility: volatility,
              greeks: {
                delta: delta || 0,
                gamma: gamma || 0,
                theta: theta || 0,
                vega: vega || 0,
                rho: rho || 0,
              },
              timestamp: Date.now(),
            };
            
            // Update cache
            this.optionsCache.set(symbol, optionData);
            
            // Resolve pending promise if exists
            const pending = this.pendingGreeks.get(symbol);
            if (pending) {
              pending.resolve(optionData);
              this.pendingGreeks.delete(symbol);
            }
            
            console.log(`✅ Option Greeks cached: ${symbol} - Premium $${price.toFixed(2)}, IV ${(volatility * 100).toFixed(1)}%, Delta ${delta.toFixed(4)}`);
            greeksProcessed++;
          }
          
          i += GREEKS_FIELD_COUNT;
        }
        
        if (greeksProcessed > 0) {
          console.log(`📊 Processed ${greeksProcessed} Greeks events`);
        }
      }
    } catch (error: any) {
      console.error('Error handling feed data:', error.message);
    }
  }

  /**
   * Normalize account field value (handles both plain numbers and { value } objects)
   */
  private normalizeAccountField(field: any): number | undefined {
    if (field === null || field === undefined) {
      return undefined;
    }
    
    // Handle { value, change-format } object format
    if (typeof field === 'object' && 'value' in field) {
      const num = Number(field.value);
      return isNaN(num) ? undefined : num;
    }
    
    // Handle plain number
    const num = Number(field);
    return isNaN(num) ? undefined : num;
  }

  /**
   * Handle incoming ACCOUNTS_DATA messages from DXLink
   */
  private handleAccountsData(data: any): void {
    try {
      // ACCOUNTS_DATA format: { account, dataType, data }
      if (!data || typeof data !== 'object') {
        console.warn('⚠️ Invalid ACCOUNTS_DATA format:', data);
        return;
      }
      
      const { account, dataType, data: accountData } = data;
      
      if (!account || !accountData || typeof accountData !== 'object') {
        console.warn('⚠️ Missing account or data in ACCOUNTS_DATA');
        return;
      }
      
      // Extract and normalize daily P/L fields
      const dayEquityChange = this.normalizeAccountField(accountData['day-equity-change']);
      const todaysRealizedPnL = this.normalizeAccountField(accountData['todays-realized-profit-loss']);
      const todaysUnrealizedPnL = this.normalizeAccountField(accountData['todays-unrealized-profit-loss']);
      
      // Store snapshot
      const snapshot: AccountSnapshot = {
        numericSummary: {
          dayEquityChange,
          todaysRealizedPnL,
          todaysUnrealizedPnL
        },
        rawSummary: accountData,
        timestamp: Date.now()
      };
      
      this.accountSummary.set(account, snapshot);
      
      // Log summary at INFO level
      console.log(`💰 Account ${account} Daily P/L: Total $${(dayEquityChange || 0).toFixed(2)} (Realized: $${(todaysRealizedPnL || 0).toFixed(2)}, Unrealized: $${(todaysUnrealizedPnL || 0).toFixed(2)})`);
      
      // Optionally log raw data at DEBUG level (commented out to reduce noise)
      // console.log('🔍 Raw AccountSummary:', JSON.stringify(accountData, null, 2));
    } catch (error: any) {
      console.error('❌ Error handling ACCOUNTS_DATA:', error.message);
    }
  }

  /**
   * Update quote cache with new data
   */
  private updateQuoteCache(quoteData: any): void {
    const symbol = quoteData.eventSymbol;
    
    this.quoteCache.set(symbol, {
      symbol,
      bidPrice: quoteData.bidPrice || 0,
      askPrice: quoteData.askPrice || 0,
      lastPrice: quoteData.lastPrice || quoteData.price || 0,
      markPrice: (quoteData.bidPrice + quoteData.askPrice) / 2 || quoteData.price || 0,
      volume: quoteData.volume || 0,
      openInterest: quoteData.openInterest,
    });
  }

  /**
   * Subscribe to symbols for real-time quotes
   */
  async subscribeToSymbols(symbols: string[]): Promise<void> {
    if (!this.isConnected || !this.ws) {
      await this.connectWebSocket();
    }

    console.log(`📡 Subscribing to: ${symbols.join(', ')}`);

    // Send FEED_SUBSCRIPTION with Quote and Trade event types
    this.ws?.send(JSON.stringify({
      type: 'FEED_SUBSCRIPTION',
      channel: 1,
      add: symbols.flatMap(symbol => [
        { type: 'Quote', symbol },
        { type: 'Trade', symbol }
      ])
    }));
  }

  /**
   * Get quote from cache or subscribe if not available
   */
  async getQuote(symbol: string): Promise<{ price: number; changePercent: number } | null> {
    try {
      // Ensure WebSocket is connected
      if (!this.isConnected) {
        await this.connectWebSocket();
        await this.subscribeToSymbols([symbol]);
        
        // Wait longer for initial quote data (5 seconds)
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      const cached = this.quoteCache.get(symbol);
      
      if (cached && cached.lastPrice > 0) {
        console.log(`📊 ${symbol}: $${cached.lastPrice.toFixed(2)} (from Tastytrade DXLink)`);
        return {
          price: cached.lastPrice,
          changePercent: 0, // DXLink doesn't provide % change directly
        };
      }

      // If not in cache, subscribe and wait longer
      await this.subscribeToSymbols([symbol]);
      await new Promise(resolve => setTimeout(resolve, 5000));

      const newCached = this.quoteCache.get(symbol);
      if (newCached && newCached.lastPrice > 0) {
        console.log(`📊 ${symbol}: $${newCached.lastPrice.toFixed(2)} (from Tastytrade DXLink)`);
        return {
          price: newCached.lastPrice,
          changePercent: 0,
        };
      }

      console.log(`⚠️ No quote data received for ${symbol} after 5s`);
      return null;
    } catch (error: any) {
      console.error(`❌ Error getting quote for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Fetch current price and data for a stock symbol
   */
  async getStockQuote(symbol: string): Promise<{ price: number; changePercent: number } | null> {
    return await this.getQuote(symbol);
  }

  /**
   * Fetch market data for SPX index only
   */
  async getFuturesQuote(symbol: string): Promise<{ price: number; changePercent: number } | null> {
    // Only SPX is supported - MNQ removed due to lack of reliable live data
    if (symbol === 'SPX') {
      // SPX index is directly available in Tastytrade
      return await this.getQuote('SPX');
    }
    
    return null;
  }

  /**
   * Check if a date is the third Friday of its month (standard monthly expiration)
   */
  private isThirdFriday(date: Date): boolean {
    // Check if it's a Friday (5 = Friday in JS Date)
    if (date.getDay() !== 5) return false;
    
    // Find the first Friday of the month
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    const firstFriday = firstDay.getDay() <= 5 
      ? 1 + (5 - firstDay.getDay())  // First Friday in first week
      : 1 + (12 - firstDay.getDay()); // First Friday in second week
    
    // Third Friday is 14 days after first Friday
    const thirdFriday = firstFriday + 14;
    
    return date.getDate() === thirdFriday;
  }

  /**
   * Format option symbol to DXLink streamer format
   * SPX weekly options: .SPXW{YYMMDD}{C/P}{STRIKE} (non-third-Friday)
   * SPX monthly options: .SPX{YYMMDD}{C/P}{STRIKE} (third Friday)
   * Other underlyings: .{UNDERLYING}{YYMMDD}{C/P}{STRIKE}
   * Example: SPX, 6850, 2025-11-14 (weekly), call -> .SPXW251114C06850000
   * Example: SPX, 6850, 2025-11-21 (monthly), call -> .SPX251121C06850000
   */
  private formatOptionSymbol(
    underlying: string,
    strike: number,
    expiryDate: string,  // YYYY-MM-DD
    optionType: 'call' | 'put'
  ): string {
    // Parse expiry date to get YYMMDD
    const date = new Date(expiryDate);
    const yy = date.getFullYear().toString().slice(-2);
    const mm = (date.getMonth() + 1).toString().padStart(2, '0');
    const dd = date.getDate().toString().padStart(2, '0');
    
    // Format strike to 8 digits with 3 decimal places (multiply by 1000)
    const strikeFormatted = Math.round(strike * 1000).toString().padStart(8, '0');
    
    // C for call, P for put
    const type = optionType.toLowerCase() === 'call' ? 'C' : 'P';
    
    // SPX requires special handling: SPXW for weekly, SPX for monthly (third Friday)
    let symbolPrefix = underlying;
    if (underlying === 'SPX') {
      const isMonthly = this.isThirdFriday(date);
      symbolPrefix = isMonthly ? 'SPX' : 'SPXW';
      console.log(`📅 SPX expiration ${expiryDate}: ${isMonthly ? 'MONTHLY (third Friday)' : 'WEEKLY'} → ${symbolPrefix}`);
    }
    
    // DXLink format: .{UNDERLYING}{YYMMDD}{C/P}{STRIKE}
    return `.${symbolPrefix}${yy}${mm}${dd}${type}${strikeFormatted}`;
  }

  /**
   * Subscribe to option symbols for Greeks and Quote events
   */
  private async subscribeToOptionSymbols(symbols: string[]): Promise<void> {
    if (!this.isConnected || !this.ws) {
      await this.connectWebSocket();
    }

    // Only subscribe to new symbols
    const newSymbols = symbols.filter(s => !this.subscribedSymbols.has(s));
    if (newSymbols.length === 0) {
      return; // Already subscribed
    }

    console.log(`📡 Subscribing to option symbols: ${newSymbols.join(', ')}`);

    // Send FEED_SUBSCRIPTION with Quote and Greeks event types for options
    this.ws?.send(JSON.stringify({
      type: 'FEED_SUBSCRIPTION',
      channel: 1,
      add: newSymbols.flatMap(symbol => [
        { type: 'Quote', symbol },
        { type: 'Greeks', symbol }
      ])
    }));

    // Mark as subscribed
    newSymbols.forEach(s => this.subscribedSymbols.add(s));
  }

  /**
   * Wait for Greeks data to arrive via WebSocket with timeout
   */
  private async waitForGreeksData(symbol: string, timeout: number = 5000): Promise<OptionGreeksData | null> {
    return new Promise((resolve, reject) => {
      // Check cache first
      const cached = this.optionsCache.get(symbol);
      if (cached && (Date.now() - cached.timestamp) < 15000) {
        // Cache valid for 15 seconds
        resolve(cached);
        return;
      }

      // Store promise for resolution when data arrives
      this.pendingGreeks.set(symbol, { 
        resolve: (data: OptionGreeksData) => resolve(data),
        reject
      });

      // Set timeout
      const timeoutId = setTimeout(() => {
        if (this.pendingGreeks.has(symbol)) {
          this.pendingGreeks.delete(symbol);
          console.log(`⏱️ Timeout waiting for Greeks data: ${symbol}`);
          resolve(null); // Return null on timeout instead of rejecting
        }
      }, timeout);

      // Clear timeout if data arrives
      const originalResolve = this.pendingGreeks.get(symbol)?.resolve;
      if (originalResolve) {
        this.pendingGreeks.set(symbol, {
          resolve: (data: OptionGreeksData) => {
            clearTimeout(timeoutId);
            originalResolve(data);
          },
          reject
        });
      }
    });
  }

  /**
   * Fetch option quote with Greeks and IV from DXLink
   * Primary data source for options - matches Polygon API interface
   */
  async getOptionQuote(
    underlying: string,
    strike: number,
    expiryDate: string,  // YYYY-MM-DD
    optionType: 'call' | 'put'
  ): Promise<OptionQuoteData | null> {
    try {
      // Ensure WebSocket is connected
      if (!this.isConnected) {
        await this.connectWebSocket();
      }

      // Format to DXLink symbol
      const dxSymbol = this.formatOptionSymbol(underlying, strike, expiryDate, optionType);
      console.log(`📊 Fetching option Greeks from Tastytrade DXLink: ${dxSymbol}`);

      // Subscribe to the option symbol
      await this.subscribeToOptionSymbols([dxSymbol]);

      // Wait for Greeks data with 5 second timeout
      const greeksData = await this.waitForGreeksData(dxSymbol, 5000);

      if (!greeksData) {
        console.log(`⚠️ No Greeks data received for ${dxSymbol} after timeout`);
        return null;
      }

      console.log(`✅ Tastytrade option data: ${underlying} ${optionType.toUpperCase()} - Premium $${greeksData.premium.toFixed(2)}, IV ${(greeksData.impliedVolatility * 100).toFixed(1)}%, Delta ${greeksData.greeks.delta.toFixed(4)}`);

      return {
        premium: greeksData.premium,
        impliedVolatility: greeksData.impliedVolatility,
        greeks: greeksData.greeks,
      };
    } catch (error: any) {
      console.error(`❌ Error getting option quote from Tastytrade: ${error.message}`);
      return null;
    }
  }

  /**
   * Test connection and verify live data feed
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log('\n🧪 Testing Tastytrade API Connection...\n');
      
      // Test authentication
      const authenticated = await this.authenticate();
      if (!authenticated) {
        console.log('❌ Authentication failed\n');
        return false;
      }

      console.log('✅ Authentication successful');
      console.log('✅ Session token obtained');
      
      if (this.accountNumber) {
        console.log(`✅ Account number: ${this.accountNumber}`);
      }

      // Test DXLink WebSocket connection
      console.log('\n🔌 Testing DXLink WebSocket connection...');
      const connected = await this.connectWebSocket();
      
      if (!connected) {
        console.log('❌ WebSocket connection failed\n');
        return false;
      }

      console.log('✅ DXLink WebSocket connected');

      // Test fetching real-time quotes
      console.log('\n📊 Testing real-time quote fetch (AAPL)...');
      const stockQuote = await this.getStockQuote('AAPL');
      
      if (stockQuote && stockQuote.price > 0) {
        console.log(`✅ Real-time quote received: $${stockQuote.price.toFixed(2)}`);
        console.log('✅ Live data streaming working\n');
        return true;
      } else {
        console.log('⚠️ Could not fetch live quote data\n');
        return false;
      }
    } catch (error: any) {
      console.error('❌ Connection test failed:', error.message);
      return false;
    }
  }

  /**
   * Initialize Tastytrade service on server startup
   * Connects WebSocket and subscribes to common symbols
   */
  async init(): Promise<boolean> {
    try {
      console.log('🚀 Initializing Tastytrade service...');
      
      // Authenticate
      const authenticated = await this.authenticate();
      if (!authenticated) {
        console.error('❌ Failed to authenticate Tastytrade');
        return false;
      }

      // Connect WebSocket for real-time data
      const connected = await this.connectWebSocket();
      if (!connected) {
        console.error('❌ Failed to connect DXLink WebSocket');
        return false;
      }

      console.log('✅ Tastytrade service initialized successfully');
      
      // Subscribe to common symbols for faster first queries
      // Don't await - let it run in background
      this.subscribeToSymbols(['AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL', 'META', 'AMZN', 'QQQ', 'SPY']).catch(err => {
        console.warn('⚠️ Background subscription failed:', err.message);
      });

      return true;
    } catch (error: any) {
      console.error('❌ Tastytrade initialization error:', error.message);
      return false;
    }
  }

  /**
   * Fetch real account positions from Tastytrade
   */
  async fetchPositions(): Promise<any[]> {
    try {
      await this.ensureAuthenticated();
      
      if (!this.accountNumber) {
        console.error('❌ No account number available');
        return [];
      }

      console.log('📊 Fetching positions...');
      
      const response = await this.apiClient.get(`/accounts/${this.accountNumber}/positions`);
      
      if (!response.data || !response.data.data || !response.data.data.items) {
        console.log('⚠️ No positions found or invalid response');
        return [];
      }

      const positions = response.data.data.items;
      console.log(`✅ Found ${positions.length} position(s)`);

      // Map Tastytrade positions to our PortfolioPosition schema
      const normalizedPositions = positions.map((pos: any) => {
        const isOption = pos['instrument-type'] === 'Equity Option';
        const isFuture = pos['instrument-type'] === 'Future Option' || pos['instrument-type'] === 'Future';
        
        // Parse option symbol (e.g., "SPY 250117C500" -> strike: 500, expiry: 2025-01-17, type: CALL)
        let metadata: any = null;
        let ticker = pos['underlying-symbol'] || pos.symbol;
        
        if (isOption || isFuture) {
          const parsed = this.parseOptionSymbol(pos.symbol);
          if (parsed) {
            ticker = parsed.underlying;
            metadata = {
              optionType: parsed.optionType.toLowerCase(),
              strike: parsed.strike,
              expiryDate: parsed.expiry,
            };
          }
        }

        // Calculate current price from Tastytrade data or use cached quote
        // Use Number.isFinite to ensure valid numbers, default to 0 for missing values
        const parsedCurrentPrice = parseFloat(pos['close-price'] || pos['average-open-price'] || '0');
        const currentPrice = Number.isFinite(parsedCurrentPrice) ? parsedCurrentPrice : 0;
        
        const parsedAvgCost = parseFloat(pos['average-open-price'] || '0');
        const avgCost = Number.isFinite(parsedAvgCost) ? parsedAvgCost : 0;
        
        const parsedQuantity = parseFloat(pos.quantity || '0');
        const quantity = Math.abs(Number.isFinite(parsedQuantity) ? parsedQuantity : 0);
        
        const parsedMultiplier = parseFloat(pos.multiplier || '1');
        const multiplier = Number.isFinite(parsedMultiplier) ? parsedMultiplier : 1;
        
        // Calculate day P/L from yesterday's close
        const parsedYesterdayClose = parseFloat(pos['average-daily-market-close-price'] || currentPrice.toString());
        const yesterdayClose = Number.isFinite(parsedYesterdayClose) ? parsedYesterdayClose : currentPrice;
        const dayPnL = (currentPrice - yesterdayClose) * quantity * multiplier;
        
        // Calculate P&L with contract multiplier
        const totalCost = avgCost * quantity * multiplier;
        const currentValue = currentPrice * quantity * multiplier;
        const unrealizedPnL = currentValue - totalCost;

        return {
          id: pos.symbol,
          ticker,
          positionType: isOption || isFuture ? 'options' : 'stock',
          quantity,
          avgCost,
          currentPrice,
          unrealizedPnL,
          realizedPnL: Number.isFinite(dayPnL) ? dayPnL : 0, // Day P/L from yesterday's close
          openDate: pos['created-at'] ? new Date(pos['created-at']) : new Date(),
          status: 'open',
          metadata,
          // Additional Tastytrade-specific data
          tastytradeData: {
            symbol: pos.symbol,
            instrumentType: pos['instrument-type'],
            quantityDirection: pos['quantity-direction'],
            multiplier,
            costEffect: pos['cost-effect'],
            expiresAt: pos['expires-at'],
          },
        };
      });

      return normalizedPositions;
    } catch (error: any) {
      console.error('❌ Error fetching positions:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Parse option symbol from Tastytrade format
   * Example: "SPY 250117C500" -> {underlying: "SPY", expiry: "2025-01-17", optionType: "CALL", strike: 500}
   */
  private parseOptionSymbol(symbol: string): { underlying: string; expiry: string; optionType: 'CALL' | 'PUT'; strike: number } | null {
    try {
      // Format: "SYMBOL YYMMDDCSTRIKE" or "SYMBOL YYMMDDPSTRIKE"
      // Example: "SPY 250117C500" = SPY, Jan 17 2025, CALL, $500 strike
      const match = symbol.match(/^([A-Z]+)\s+(\d{6})([CP])(\d+\.?\d*)$/);
      
      if (!match) {
        console.warn(`⚠️ Could not parse option symbol: ${symbol}`);
        return null;
      }

      const [, underlying, dateStr, optionChar, strikeStr] = match;
      
      // Parse date: YYMMDD
      const year = 2000 + parseInt(dateStr.substring(0, 2));
      const month = parseInt(dateStr.substring(2, 4));
      const day = parseInt(dateStr.substring(4, 6));
      const expiry = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      
      // Parse option type
      const optionType = optionChar === 'C' ? 'CALL' : 'PUT';
      
      // Parse strike (divide by 1000 if needed for proper decimal)
      let strike = parseFloat(strikeStr);
      if (strike > 10000) {
        strike = strike / 1000; // Handle strikes like "500000" -> 500.00
      }

      return {
        underlying,
        expiry,
        optionType,
        strike,
      };
    } catch (error: any) {
      console.error(`❌ Error parsing option symbol ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Validate session and re-authenticate if needed
   */
  async ensureAuthenticated(): Promise<boolean> {
    if (this.sessionToken) {
      // TODO: Validate token is still valid
      return true;
    }
    return await this.authenticate();
  }
  
  /**
   * Get connection status
   */
  isServiceConnected(): boolean {
    return this.isConnected && this.ws !== null;
  }
  
  /**
   * Get cached quote without waiting
   */
  getCachedQuote(symbol: string): QuoteData | null {
    return this.quoteCache.get(symbol) || null;
  }
  
  /**
   * Fetch account balance information
   */
  async fetchAccountBalance(): Promise<{
    netLiquidatingValue: number;
    cashBalance: number;
    totalValue: number;
  }> {
    try {
      await this.ensureAuthenticated();
      
      if (!this.accountNumber) {
        console.error('❌ No account number available');
        return { netLiquidatingValue: 0, cashBalance: 0, totalValue: 0 };
      }

      const response = await this.apiClient.get(`/accounts/${this.accountNumber}/balances`);
      
      if (!response.data || !response.data.data) {
        return { netLiquidatingValue: 0, cashBalance: 0, totalValue: 0 };
      }

      const data = response.data.data;
      
      const netLiquidatingValue = parseFloat(data['net-liquidating-value'] || '0');
      const cashBalance = parseFloat(data['cash-balance'] || '0');

      return {
        netLiquidatingValue,
        cashBalance,
        totalValue: netLiquidatingValue
      };
    } catch (error: any) {
      console.error('❌ Error fetching account balance:', error.response?.data || error.message);
      return { netLiquidatingValue: 0, cashBalance: 0, totalValue: 0 };
    }
  }

  /**
   * Fetch lifetime realized P/L from all closed positions
   */
  async fetchLifetimeRealizedPnL(): Promise<number> {
    try {
      await this.ensureAuthenticated();
      
      if (!this.accountNumber) {
        console.error('❌ No account number available');
        return 0;
      }

      // Fetch all transactions with pagination
      let allTransactions: any[] = [];
      let page = 0;
      const perPage = 250;
      let hasMore = true;

      while (hasMore) {
        const response = await this.apiClient.get(`/accounts/${this.accountNumber}/transactions`, {
          params: {
            'per-page': perPage,
            'page-offset': page * perPage,
            'sort': 'Asc'
          }
        });

        if (!response.data || !response.data.data || !response.data.data.items) {
          break;
        }

        const items = response.data.data.items;
        allTransactions = allTransactions.concat(items);

        // Check if there are more pages
        hasMore = items.length === perPage;
        page++;
      }

      if (allTransactions.length === 0) {
        return 0;
      }

      console.log(`📊 Processing ${allTransactions.length} transactions for lifetime P/L`);

      // Build cost basis map: symbol -> { totalCost, totalQuantity }
      const costBasis = new Map<string, { totalCost: number; totalQuantity: number }>();
      let totalRealizedPnL = 0;
      
      allTransactions.forEach((tx: any) => {
        const symbol = tx.symbol;
        const subType = tx['transaction-sub-type'];
        const netValue = parseFloat(tx['net-value'] || 0);
        const quantity = Math.abs(parseFloat(tx.quantity || 0));
        
        // Track opening transactions for cost basis
        if (subType === 'Buy to Open' || subType === 'Sell to Open') {
          if (!costBasis.has(symbol)) {
            costBasis.set(symbol, { totalCost: 0, totalQuantity: 0 });
          }
          const basis = costBasis.get(symbol)!;
          
          if (subType === 'Buy to Open') {
            basis.totalCost += netValue;
            basis.totalQuantity += quantity;
          } else {
            // Sell to Open: credit (short position)
            basis.totalCost -= netValue;
            basis.totalQuantity += quantity;
          }
        }
        
        // Calculate realized P/L for closing transactions
        if (subType === 'Sell to Close' || subType === 'Buy to Close') {
          const basis = costBasis.get(symbol);
          
          if (basis && basis.totalQuantity > 0) {
            const costPerContract = basis.totalCost / basis.totalQuantity;
            const costOfClosedPosition = costPerContract * quantity;
            
            if (subType === 'Sell to Close') {
              // Closed long: P/L = proceeds - cost
              totalRealizedPnL += (netValue - costOfClosedPosition);
            } else {
              // Closed short: P/L = cost - buy price
              totalRealizedPnL += (costOfClosedPosition - netValue);
            }
            
            // Update cost basis after close
            basis.totalCost -= costOfClosedPosition;
            basis.totalQuantity -= quantity;
          }
        }
      });
      
      console.log(`📊 Lifetime Realized P/L: $${totalRealizedPnL.toFixed(2)}`);
      return totalRealizedPnL;
    } catch (error: any) {
      console.error('❌ Error fetching lifetime realized P/L:', error.response?.data || error.message);
      return 0;
    }
  }

  /**
   * Fetch today's P/L directly from balance API
   */
  async fetchTodayPnL(): Promise<{ realized: number; unrealized: number; total: number }> {
    try {
      if (!this.accountNumber) {
        console.error('❌ No account number available');
        return { realized: 0, unrealized: 0, total: 0 };
      }

      // Get full balance data to inspect all fields
      const response = await this.apiClient.get(`/accounts/${this.accountNumber}/balances`);
      
      if (!response.data || !response.data.data) {
        return { realized: 0, unrealized: 0, total: 0 };
      }

      const data = response.data.data;
      
      // DEBUG: Log ALL fields to find daily P/L
      console.log('🔍 FULL BALANCE API RESPONSE:');
      console.log(JSON.stringify(data, null, 2));

      // Get current net liquidation value
      const currentNetLiq = parseFloat(data['net-liquidating-value'] || '0');

      // Calculate yesterday's date in YYYY-MM-DD format
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      console.log(`📅 Fetching EOD balance snapshot for ${yesterdayStr}...`);

      // Get yesterday's end-of-day balance snapshot
      const snapshotResponse = await this.apiClient.get(
        `/accounts/${this.accountNumber}/balance-snapshots`,
        {
          params: {
            'snapshot-date': yesterdayStr,
            'time-of-day': 'EOD'
          }
        }
      );

      if (!snapshotResponse.data || !snapshotResponse.data.data) {
        console.warn('⚠️ No balance snapshot available for yesterday');
        
        // Fallback: Try net-liq history
        const historyResponse = await this.apiClient.get(
          `/accounts/${this.accountNumber}/net-liq/history`,
          {
            params: {
              'time-back': '3d'
            }
          }
        );

        if (historyResponse.data && historyResponse.data.data && historyResponse.data.data.length > 0) {
          const history = historyResponse.data.data;
          // Get second-to-last entry (yesterday's close)
          const yesterdayClose = parseFloat(history[history.length - 2]?.close || history[history.length - 1]?.close || currentNetLiq);
          const dailyPnL = currentNetLiq - yesterdayClose;
          
          console.log(`💰 Daily P/L (from history): $${dailyPnL.toFixed(2)} (Current: $${currentNetLiq.toFixed(2)}, Yesterday Close: $${yesterdayClose.toFixed(2)})`);
          
          return {
            realized: 0,
            unrealized: dailyPnL,
            total: dailyPnL
          };
        }
        
        return { realized: 0, unrealized: 0, total: 0 };
      }

      const snapshotData = snapshotResponse.data.data;
      const yesterdayClose = parseFloat(snapshotData['net-liquidating-value'] || currentNetLiq);

      // Calculate daily P/L (same as Tastytrade dashboard)
      const dailyPnL = currentNetLiq - yesterdayClose;

      console.log(`💰 Daily P/L: $${dailyPnL.toFixed(2)} (Current: $${currentNetLiq.toFixed(2)}, Yesterday EOD: $${yesterdayClose.toFixed(2)})`);

      return {
        realized: 0,
        unrealized: dailyPnL,
        total: dailyPnL
      };
    } catch (error: any) {
      console.error('❌ Error fetching today P/L:', error.response?.data || error.message);
      return { realized: 0, unrealized: 0, total: 0 };
    }
  }
}

// Export singleton instance
export const tastytradeService = new TastytradeService();
export default tastytradeService;
