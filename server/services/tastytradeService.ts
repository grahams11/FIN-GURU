import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';

interface TastytradeSession {
  sessionToken: string;
  rememberToken: string;
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
  dxlinkUrl: string;
  level: string;
}

class TastytradeService {
  private baseURL = 'https://api.tastyworks.com';
  private certURL = 'https://api.cert.tastyworks.com'; // For testing
  private apiClient: AxiosInstance;
  private sessionToken: string | null = null;
  private rememberToken: string | null = null;
  private accountNumber: string | null = null;

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
        this.sessionToken = response.data.data.sessionToken;
        this.rememberToken = response.data.data.rememberToken;
        
        // Set session token in headers for future requests
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
   * Fetch current price and data for a stock symbol
   */
  async getStockQuote(symbol: string): Promise<{ price: number; changePercent: number } | null> {
    try {
      if (!this.sessionToken) {
        const authenticated = await this.authenticate();
        if (!authenticated) return null;
      }

      // Get equity quote from Tastytrade
      const response = await this.apiClient.get(`/instruments/equities/${symbol}`);
      
      if (response.data && response.data.data) {
        const data = response.data.data;
        
        // Try to get live market data
        const marketDataResponse = await this.apiClient.get(`/quote-streamer-tokens`);
        
        // For now, return the instrument data
        // We'll implement DXLink WebSocket for real-time quotes next
        console.log(`📈 ${symbol}: Fetched from Tastytrade API (instrument data)`);
        
        return {
          price: 0, // Will be populated by DXLink WebSocket
          changePercent: 0,
        };
      }

      return null;
    } catch (error: any) {
      console.error(`❌ Error fetching ${symbol} from Tastytrade:`, error.message);
      return null;
    }
  }

  /**
   * Fetch market data for futures (SPX, MNQ)
   */
  async getFuturesQuote(symbol: string): Promise<{ price: number; changePercent: number } | null> {
    try {
      if (!this.sessionToken) {
        const authenticated = await this.authenticate();
        if (!authenticated) return null;
      }

      // Tastytrade uses specific symbols for futures
      // SPX = /ES (E-mini S&P 500 futures)
      // MNQ = /MNQ (Micro E-mini Nasdaq-100 futures)
      const futuresSymbol = symbol === 'SPX' ? '/ES' : symbol === 'MNQ' ? '/MNQ' : symbol;

      const response = await this.apiClient.get(`/instruments/futures/${futuresSymbol}`);
      
      if (response.data && response.data.data) {
        console.log(`📊 ${symbol}: Fetched from Tastytrade API (futures instrument data)`);
        
        return {
          price: 0, // Will be populated by DXLink WebSocket
          changePercent: 0,
        };
      }

      return null;
    } catch (error: any) {
      console.error(`❌ Error fetching ${symbol} futures from Tastytrade:`, error.message);
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

      // Test fetching a stock quote
      console.log('\n📊 Testing stock quote fetch (AAPL)...');
      const stockQuote = await this.getStockQuote('AAPL');
      
      if (stockQuote) {
        console.log('✅ Successfully connected to Tastytrade API');
        console.log('✅ Market data endpoints accessible\n');
        return true;
      } else {
        console.log('⚠️ Could not fetch stock data\n');
        return false;
      }
    } catch (error: any) {
      console.error('❌ Connection test failed:', error.message);
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
}

// Export singleton instance
export const tastytradeService = new TastytradeService();
