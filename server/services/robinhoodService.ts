// @ts-ignore - robinhood-nodejs doesn't have TypeScript declarations
import Robinhood from 'robinhood-nodejs';
import type { PortfolioPosition } from '@shared/schema';

interface RobinhoodAuth {
  tokenData: any;
  api: any;
}

class RobinhoodService {
  private auth: RobinhoodAuth | null = null;
  private tokenFile = 'robinhood_auth.json';
  private isAuthenticated = false;
  private circuitBreakerOpen = false;
  private circuitBreakerTimeout: NodeJS.Timeout | null = null;
  private lastError: string | null = null;

  async initialize(): Promise<boolean> {
    if (!process.env.ROBINHOOD_USERNAME || !process.env.ROBINHOOD_PASSWORD) {
      console.log('⚠️ Robinhood credentials not configured - skipping initialization');
      return false;
    }

    try {
      console.log('🔐 Authenticating with Robinhood...');
      
      const { tokenData, api } = await Robinhood({
        username: process.env.ROBINHOOD_USERNAME,
        password: process.env.ROBINHOOD_PASSWORD,
      });

      this.auth = { tokenData, api };
      this.isAuthenticated = true;
      this.circuitBreakerOpen = false;
      this.lastError = null;

      console.log('✅ Robinhood authentication successful');
      return true;
    } catch (error: any) {
      console.error('❌ Robinhood authentication failed:', error.message);
      this.lastError = error.message;
      this.openCircuitBreaker();
      return false;
    }
  }

  private openCircuitBreaker() {
    this.circuitBreakerOpen = true;
    this.isAuthenticated = false;
    
    if (this.circuitBreakerTimeout) {
      clearTimeout(this.circuitBreakerTimeout);
    }
    
    this.circuitBreakerTimeout = setTimeout(() => {
      console.log('🔄 Robinhood circuit breaker reset - will retry on next request');
      this.circuitBreakerOpen = false;
    }, 60000);
  }

  async getPositions(): Promise<PortfolioPosition[]> {
    if (this.circuitBreakerOpen) {
      console.log('⚠️ Robinhood circuit breaker open - returning empty positions');
      return [];
    }

    if (!this.isAuthenticated) {
      const initialized = await this.initialize();
      if (!initialized) {
        return [];
      }
    }

    try {
      if (!this.auth?.api) {
        throw new Error('Robinhood API not initialized');
      }

      const positions = await this.auth.api.positions();
      
      if (!positions || !positions.results) {
        console.log('📊 Robinhood: No positions found');
        return [];
      }

      console.log(`📊 Found ${positions.results.length} Robinhood position(s)`);

      const normalizedPositions: PortfolioPosition[] = [];

      for (const pos of positions.results) {
        try {
          if (parseFloat(pos.quantity) === 0) continue;

          const instrument = await this.auth.api.instrument(pos.instrument);
          const quote = await this.auth.api.quote_data(instrument.symbol);

          const quantity = parseFloat(pos.quantity);
          const avgCost = parseFloat(pos.average_buy_price);
          const currentPrice = parseFloat(quote.last_trade_price || quote.last_extended_hours_trade_price || avgCost);
          const unrealizedPnL = (currentPrice - avgCost) * quantity;

          normalizedPositions.push({
            id: `RH-${pos.url.split('/').pop()}`,
            userId: null,
            ticker: instrument.symbol,
            positionType: 'stock',
            quantity,
            avgCost,
            currentPrice,
            unrealizedPnL,
            realizedPnL: 0,
            openDate: new Date(pos.created_at),
            closeDate: null,
            status: 'open',
            broker: 'robinhood',
            metadata: {
              instrumentUrl: pos.instrument,
              accountUrl: pos.account,
              sharesHeldForSells: pos.shares_held_for_sells,
              pendingAverageBuyPrice: pos.pending_average_buy_price,
            },
          });
        } catch (posError: any) {
          console.error(`❌ Error processing Robinhood position:`, posError.message);
          continue;
        }
      }

      return normalizedPositions;
    } catch (error: any) {
      console.error('❌ Error fetching Robinhood positions:', error.message);
      this.lastError = error.message;
      this.openCircuitBreaker();
      return [];
    }
  }

  async getOptions(): Promise<PortfolioPosition[]> {
    if (this.circuitBreakerOpen) {
      console.log('⚠️ Robinhood circuit breaker open - returning empty options');
      return [];
    }

    if (!this.isAuthenticated) {
      const initialized = await this.initialize();
      if (!initialized) {
        return [];
      }
    }

    try {
      if (!this.auth?.api) {
        throw new Error('Robinhood API not initialized');
      }

      const optionsPositions = await this.auth.api.options_positions();
      
      if (!optionsPositions || !optionsPositions.results) {
        console.log('📊 Robinhood: No options positions found');
        return [];
      }

      console.log(`📊 Found ${optionsPositions.results.length} Robinhood options position(s)`);

      const normalizedOptions: PortfolioPosition[] = [];

      for (const opt of optionsPositions.results) {
        try {
          if (parseFloat(opt.quantity) === 0) continue;

          const optionInstrument = await this.auth.api.options(opt.option);
          
          const quantity = parseFloat(opt.quantity);
          const avgCost = parseFloat(opt.average_price);
          const currentPrice = parseFloat(optionInstrument.mark_price || avgCost);
          const unrealizedPnL = (currentPrice - avgCost) * quantity * 100;

          const optionType = optionInstrument.type === 'call' ? 'CALL' : 'PUT';
          const strike = parseFloat(optionInstrument.strike_price);
          const expiry = optionInstrument.expiration_date;

          normalizedOptions.push({
            id: `RH-OPT-${opt.url.split('/').pop()}`,
            userId: null,
            ticker: optionInstrument.chain_symbol,
            positionType: 'options',
            quantity,
            avgCost,
            currentPrice,
            unrealizedPnL,
            realizedPnL: 0,
            openDate: new Date(opt.created_at),
            closeDate: null,
            status: 'open',
            broker: 'robinhood',
            metadata: {
              strike,
              expiry,
              optionType,
              contracts: quantity,
              instrumentUrl: opt.option,
              chainSymbol: optionInstrument.chain_symbol,
              state: opt.state,
            },
          });
        } catch (optError: any) {
          console.error(`❌ Error processing Robinhood option:`, optError.message);
          continue;
        }
      }

      return normalizedOptions;
    } catch (error: any) {
      console.error('❌ Error fetching Robinhood options:', error.message);
      this.lastError = error.message;
      this.openCircuitBreaker();
      return [];
    }
  }

  async getAllPositions(): Promise<PortfolioPosition[]> {
    const [stocks, options] = await Promise.all([
      this.getPositions(),
      this.getOptions(),
    ]);

    return [...stocks, ...options];
  }

  getStatus(): { connected: boolean; error: string | null } {
    return {
      connected: this.isAuthenticated && !this.circuitBreakerOpen,
      error: this.lastError,
    };
  }
}

export const robinhoodService = new RobinhoodService();
