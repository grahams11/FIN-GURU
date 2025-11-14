/**
 * Technical Indicator Calculations
 * 
 * Real mathematical implementations for overnight analysis
 * Used by Elite Scanner when market is closed to calculate
 * RSI, EMA, and ATR from overnight aggregate bars
 */

/**
 * Calculate Relative Strength Index (RSI)
 * Measures momentum by comparing upward and downward price movements
 * 
 * @param prices - Array of closing prices (oldest to newest)
 * @param period - Lookback period (default 14)
 * @returns RSI value (0-100), where <30 is oversold, >70 is overbought
 */
export const calculateRSI = (prices: number[], period: number = 14): number => {
  if (prices.length < period + 1) {
    return 50; // Neutral if not enough data
  }
  
  let gains = 0;
  let losses = 0;
  
  // Calculate average gains and losses over the period
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) {
      gains += diff;
    } else {
      losses -= diff; // Make positive
    }
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) {
    return 100; // All gains, no losses
  }
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  return rsi;
};

/**
 * Calculate Exponential Moving Average (EMA)
 * Gives more weight to recent prices than simple moving average
 * 
 * @param prices - Array of closing prices (oldest to newest)
 * @param period - Lookback period (e.g., 20 for EMA20)
 * @returns EMA value
 */
export const calculateEMA = (prices: number[], period: number): number => {
  if (prices.length === 0) {
    return 0;
  }
  
  const k = 2 / (period + 1); // Smoothing factor
  let ema = prices[0]; // Start with first price
  
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  
  return ema;
};

/**
 * Calculate Average True Range (ATR)
 * Measures market volatility by averaging true range over a period
 * 
 * @param bars - Array of OHLC bars with {h, l, c} properties
 * @param period - Lookback period (default 14)
 * @returns ATR value
 */
export const calculateATR = (bars: any[], period: number = 14): number => {
  if (bars.length < period + 1) {
    return 0; // Not enough data
  }
  
  const trueRanges: number[] = [];
  
  // Calculate true range for each bar
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].h;
    const low = bars[i].l;
    const prevClose = bars[i - 1].c;
    
    // True Range = max of:
    // - High - Low
    // - |High - Previous Close|
    // - |Low - Previous Close|
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    
    trueRanges.push(tr);
  }
  
  // Average the last 'period' true ranges
  const recentTRs = trueRanges.slice(-period);
  const atr = recentTRs.reduce((sum, tr) => sum + tr, 0) / period;
  
  return atr;
};
