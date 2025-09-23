interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export class BlackScholesCalculator {
  static calculateGreeks(
    S: number, // Current stock price
    K: number, // Strike price
    T: number, // Time to expiration (in years)
    r: number, // Risk-free rate
    sigma: number, // Volatility
    optionType: 'call' | 'put' = 'call'
  ): Greeks {
    // Handle edge cases
    if (T <= 0) {
      return {
        delta: optionType === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0),
        gamma: 0,
        theta: 0,
        vega: 0,
        rho: 0
      };
    }

    const d1 = this.calculateD1(S, K, T, r, sigma);
    const d2 = d1 - sigma * Math.sqrt(T);

    if (optionType === 'call') {
      return this.calculateCallGreeks(S, K, T, r, sigma, d1, d2);
    } else {
      return this.calculatePutGreeks(S, K, T, r, sigma, d1, d2);
    }
  }

  private static calculateD1(S: number, K: number, T: number, r: number, sigma: number): number {
    return (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * Math.sqrt(T));
  }

  private static calculateCallGreeks(
    S: number, K: number, T: number, r: number, sigma: number, d1: number, d2: number
  ): Greeks {
    const Nd1 = this.normalCDF(d1);
    const Nd2 = this.normalCDF(d2);
    const nd1 = this.normalPDF(d1);

    const delta = Nd1;
    const gamma = nd1 / (S * sigma * Math.sqrt(T));
    const theta = -(S * nd1 * sigma / (2 * Math.sqrt(T))) - r * K * Math.exp(-r * T) * Nd2;
    const vega = S * nd1 * Math.sqrt(T);
    const rho = K * T * Math.exp(-r * T) * Nd2;

    return {
      delta: this.roundToDecimalPlaces(delta, 4),
      gamma: this.roundToDecimalPlaces(gamma, 4),
      theta: this.roundToDecimalPlaces(theta / 365, 4), // Daily theta
      vega: this.roundToDecimalPlaces(vega / 100, 4), // Vega per 1% change in IV
      rho: this.roundToDecimalPlaces(rho / 100, 4) // Rho per 1% change in interest rate
    };
  }

  private static calculatePutGreeks(
    S: number, K: number, T: number, r: number, sigma: number, d1: number, d2: number
  ): Greeks {
    const Nd1 = this.normalCDF(d1);
    const Nd2 = this.normalCDF(d2);
    const nd1 = this.normalPDF(d1);

    const delta = Nd1 - 1;
    const gamma = nd1 / (S * sigma * Math.sqrt(T));
    const theta = -(S * nd1 * sigma / (2 * Math.sqrt(T))) + r * K * Math.exp(-r * T) * (1 - Nd2);
    const vega = S * nd1 * Math.sqrt(T);
    const rho = -K * T * Math.exp(-r * T) * (1 - Nd2);

    return {
      delta: this.roundToDecimalPlaces(delta, 4),
      gamma: this.roundToDecimalPlaces(gamma, 4),
      theta: this.roundToDecimalPlaces(theta / 365, 4), // Daily theta
      vega: this.roundToDecimalPlaces(vega / 100, 4), // Vega per 1% change in IV
      rho: this.roundToDecimalPlaces(rho / 100, 4) // Rho per 1% change in interest rate
    };
  }

  // Standard normal cumulative distribution function
  private static normalCDF(x: number): number {
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  // Standard normal probability density function
  private static normalPDF(x: number): number {
    return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
  }

  // Error function approximation
  private static erf(x: number): number {
    // Abramowitz and Stegun approximation
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;

    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  private static roundToDecimalPlaces(value: number, places: number): number {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
  }

  // Calculate Black-Scholes option price
  static calculateOptionPrice(
    S: number, // Current stock price
    K: number, // Strike price
    T: number, // Time to expiration (in years)
    r: number, // Risk-free rate
    sigma: number, // Volatility
    optionType: 'call' | 'put' = 'call'
  ): number {
    if (T <= 0) {
      return optionType === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
    }

    const d1 = this.calculateD1(S, K, T, r, sigma);
    const d2 = d1 - sigma * Math.sqrt(T);

    if (optionType === 'call') {
      const callPrice = S * this.normalCDF(d1) - K * Math.exp(-r * T) * this.normalCDF(d2);
      return Math.max(0, callPrice);
    } else {
      const putPrice = K * Math.exp(-r * T) * this.normalCDF(-d2) - S * this.normalCDF(-d1);
      return Math.max(0, putPrice);
    }
  }

  // Calculate implied volatility using Newton-Raphson method
  static calculateImpliedVolatility(
    marketPrice: number,
    S: number, // Current stock price
    K: number, // Strike price
    T: number, // Time to expiration (in years)
    r: number, // Risk-free rate
    optionType: 'call' | 'put' = 'call',
    tolerance: number = 0.0001,
    maxIterations: number = 100
  ): number {
    let sigma = 0.3; // Initial guess
    
    for (let i = 0; i < maxIterations; i++) {
      const price = this.calculateOptionPrice(S, K, T, r, sigma, optionType);
      const diff = price - marketPrice;
      
      if (Math.abs(diff) < tolerance) {
        return this.roundToDecimalPlaces(sigma, 4);
      }
      
      const vega = this.calculateGreeks(S, K, T, r, sigma, optionType).vega * 100;
      
      if (vega === 0) break;
      
      sigma = sigma - diff / vega;
      sigma = Math.max(0.001, Math.min(5.0, sigma)); // Keep sigma in reasonable bounds
    }
    
    return this.roundToDecimalPlaces(sigma, 4);
  }

  // Calculate portfolio Greeks for multiple positions
  static calculatePortfolioGreeks(positions: Array<{
    quantity: number;
    S: number;
    K: number;
    T: number;
    r: number;
    sigma: number;
    optionType: 'call' | 'put';
  }>): Greeks {
    const totalGreeks = positions.reduce((acc, position) => {
      const greeks = this.calculateGreeks(
        position.S,
        position.K,
        position.T,
        position.r,
        position.sigma,
        position.optionType
      );
      
      return {
        delta: acc.delta + (greeks.delta * position.quantity),
        gamma: acc.gamma + (greeks.gamma * position.quantity),
        theta: acc.theta + (greeks.theta * position.quantity),
        vega: acc.vega + (greeks.vega * position.quantity),
        rho: acc.rho + (greeks.rho * position.quantity)
      };
    }, { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 });

    return {
      delta: this.roundToDecimalPlaces(totalGreeks.delta, 4),
      gamma: this.roundToDecimalPlaces(totalGreeks.gamma, 4),
      theta: this.roundToDecimalPlaces(totalGreeks.theta, 4),
      vega: this.roundToDecimalPlaces(totalGreeks.vega, 4),
      rho: this.roundToDecimalPlaces(totalGreeks.rho, 4)
    };
  }
}

// RSI Calculator
export class TechnicalIndicators {
  static calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) {
      throw new Error('Not enough price data for RSI calculation');
    }

    const changes = prices.slice(1).map((price, index) => price - prices[index]);
    
    let avgGain = 0;
    let avgLoss = 0;
    
    // Calculate initial averages
    for (let i = 0; i < period; i++) {
      if (changes[i] > 0) {
        avgGain += changes[i];
      } else {
        avgLoss += Math.abs(changes[i]);
      }
    }
    
    avgGain /= period;
    avgLoss /= period;
    
    // Calculate RSI for subsequent periods using smoothed averages
    for (let i = period; i < changes.length; i++) {
      const change = changes[i];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return Math.round(rsi * 100) / 100;
  }

  static calculateMovingAverage(prices: number[], period: number): number[] {
    const movingAverages: number[] = [];
    
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      movingAverages.push(sum / period);
    }
    
    return movingAverages;
  }

  static calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): {
    upper: number[];
    middle: number[];
    lower: number[];
  } {
    const movingAverages = this.calculateMovingAverage(prices, period);
    const upper: number[] = [];
    const lower: number[] = [];
    
    for (let i = 0; i < movingAverages.length; i++) {
      const dataIndex = i + period - 1;
      const dataSlice = prices.slice(dataIndex - period + 1, dataIndex + 1);
      const mean = movingAverages[i];
      
      // Calculate standard deviation
      const variance = dataSlice.reduce((acc, price) => acc + Math.pow(price - mean, 2), 0) / period;
      const standardDeviation = Math.sqrt(variance);
      
      upper.push(mean + (standardDeviation * stdDev));
      lower.push(mean - (standardDeviation * stdDev));
    }
    
    return {
      upper,
      middle: movingAverages,
      lower
    };
  }
}
