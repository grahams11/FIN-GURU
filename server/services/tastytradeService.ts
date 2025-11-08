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

interface DXLinkToken {
  token: string;
  'dxlink-url': string;
  level: string;
  'ws-url'?: string;
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
  private isConnected = false;

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
      const response = await this.apiClient.get('/customers/me/accounts');
      
      if (response.data && response.data.data && response.data.data.items) {
        const accounts = response.data.data.items;
        if (accounts.length > 0) {
          this.accountNumber = accounts[0]['account-number'];
          console.log(`📊 Account Number: ${this.accountNumber}`);
        }
      }
    } catch (error: any) {
      console.error('⚠️ Could not fetch account info:', error.message);
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
      
      console.log('📡 API Response:', JSON.stringify(response.data, null, 2));
      
      if (response.data && response.data.data) {
        this.dxlinkToken = response.data.data.token;
        this.dxlinkUrl = response.data.data['dxlink-url'] || response.data.data['ws-url'];
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
            // Step 1: Send SETUP message
            this.ws?.send(JSON.stringify({
              type: 'SETUP',
              channel: 0,
              keepaliveTimeout: 60,
              acceptKeepaliveTimeout: 60,
              version: '0.1-js/1.0.0'
            }));
            console.log('🔧 Sent SETUP message');
            
            // Step 2: Send AUTH message
            this.ws?.send(JSON.stringify({
              type: 'AUTH',
              channel: 0,
              token: this.dxlinkToken
            }));
            console.log('🔐 Sent AUTH message');
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
              
              this.isConnected = true;
              resolve(true);
            }

            // Handle market data
            if (message.type === 'FEED_DATA' && message.data) {
              this.handleFeedData(message.data);
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
    } catch (error: any) {
      console.error('Error handling feed data:', error.message);
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
   * Fetch market data for futures (SPX, MNQ)
   */
  async getFuturesQuote(symbol: string): Promise<{ price: number; changePercent: number } | null> {
    // Tastytrade uses specific symbols for futures
    // SPX = SPX (S&P 500 Index - Tastytrade has SPX quotes)
    // MNQ = Front-month quarterly futures contract (format: MNQZ5 for Dec 2025)
    
    if (symbol === 'SPX') {
      // SPX index is directly available in Tastytrade
      return await this.getQuote('SPX');
    } else if (symbol === 'MNQ') {
      // Try front-month MNQ futures contract
      // MNQ trades quarterly: March(H), June(M), September(U), December(Z)
      const frontMonth = this.getQuarterlyFrontMonth('MNQ');
      console.log(`🔍 MNQ: Requesting Tastytrade front-month contract ${frontMonth}`);
      const result = await this.getQuote(frontMonth);
      
      if (result) {
        console.log(`✅ MNQ: Got Tastytrade futures price $${result.price.toFixed(2)}`);
      } else {
        console.log(`⚠️ MNQ: Tastytrade futures unavailable, will fall back to QQQ proxy`);
      }
      
      return result;
    }
    
    return await this.getQuote(symbol);
  }

  /**
   * Get front-month quarterly futures contract symbol for equity index futures
   * Format: SYMBOL + QUARTERLY_MONTH_CODE + YEAR_DIGIT (NO slash prefix)
   * Quarterly months: H=Mar, M=Jun, U=Sep, Z=Dec
   */
  private getQuarterlyFrontMonth(baseSymbol: string): string {
    const now = new Date();
    const currentMonth = now.getMonth(); // 0-11 (Jan=0, Dec=11)
    const currentYear = now.getFullYear();
    
    // Quarterly month codes and their numeric values
    const quarterlyMonths = [
      { code: 'H', month: 2 },  // March (month 2)
      { code: 'M', month: 5 },  // June (month 5)
      { code: 'U', month: 8 },  // September (month 8)
      { code: 'Z', month: 11 }  // December (month 11)
    ];
    
    // Find the next quarterly expiration month
    let targetQuarter = quarterlyMonths.find(q => q.month >= currentMonth);
    let targetYear = currentYear;
    
    // If no future quarter this year, use first quarter of next year
    if (!targetQuarter) {
      targetQuarter = quarterlyMonths[0]; // March of next year
      targetYear++;
    }
    
    const yearDigit = targetYear % 10;
    const contractSymbol = `${baseSymbol}${targetQuarter.code}${yearDigit}`;
    
    console.log(`📅 MNQ: Front-month contract for ${now.toLocaleDateString()}: ${contractSymbol} (${targetQuarter.code}=${targetYear})`);
    
    return contractSymbol;
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
}

// Export singleton instance
export const tastytradeService = new TastytradeService();
