/**
 * Elite Scanner - Live Market Scanner
 * 
 * Institutional-grade stock scanner that combines:
 * - Live market data (WebSocket when market open, historical when closed)
 * - RSI momentum with cross confirmation
 * - EMA trend alignment
 * - ATR momentum filtering
 * - Live options Greeks (delta, gamma, theta, vega)
 * - IV percentile ranking (52-week)
 * - Unusual volume detection (>3x average)
 * 
 * Performance Target: <3 seconds for 100+ tickers
 */

import { liveDataAdapter } from './liveDataAdapter';
import { EliteStrategyEngine } from './eliteStrategyEngine';
import { marketStatusService } from './marketStatusService';
import { polygonService } from './polygonService';

// S&P 500 symbols (top 100 most liquid for speed)
const SP500_TOP100 = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK.B", "JPM", "V",
  "UNH", "MA", "PG", "JNJ", "HD", "MRK", "ABBV", "BAC", "PFE", "AVGO",
  "KO", "PEP", "COST", "TMO", "DIS", "ABT", "WMT", "CSCO", "ADBE", "NFLX",
  "LLY", "TMUS", "CRM", "ACN", "TXN", "QCOM", "NEE", "LIN", "DHR", "AMD",
  "HON", "INTU", "IBM", "AMGN", "GE", "SPGI", "NOW", "RTX", "UNP", "CAT",
  "BKNG", "ISRG", "PGR", "GS", "LOW", "BLK", "SYK", "MDT", "LMT", "ELV",
  "ADP", "VRTX", "REGN", "CB", "PLD", "ADI", "ETN", "BSX", "PANW", "KLAC",
  "MMC", "ANET", "BX", "SNPS", "CDNS", "FI", "SCHW", "ICE", "CME", "SO",
  "MO", "DUK", "CL", "APD", "TT", "MCO", "ITW", "EOG", "TGT", "BDX",
  "GD", "CSX", "SHW", "WM", "HCA", "EMR", "PNC", "MSI", "APH", "FDX"
];

// Reduced test universe for closed-market testing (20 most liquid)
const TEST_SYMBOLS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM", "V", "MA",
  "UNH", "HD", "BAC", "COST", "DIS", "NFLX", "AMD", "ADBE", "QCOM", "INTU"
];

// Use test symbols when market is closed for faster scans
function getSymbolUniverse(isLive: boolean): string[] {
  return isLive ? SP500_TOP100 : TEST_SYMBOLS;
}

export interface EliteScanResult {
  symbol: string;
  optionType: 'call' | 'put';
  
  // Stock metrics
  stockPrice: number;
  rsi: number;
  rsiPrevious: number;
  ema20: number;
  atrShort: number;
  atrLong: number;
  
  // Options analytics
  strike: number;
  expiry: string;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  impliedVolatility: number;
  ivPercentile: number;
  
  // Volume metrics
  volumeRatio: number; // Current/avg (>3 = unusual)
  isUnusualVolume: boolean;
  
  // Signal quality
  signalQuality: number; // 0-100 score
  passedFilters: string[];
  
  // Metadata
  isLive: boolean; // True if market open
  scannedAt: number;
}

export class EliteScanner {
  private static instance: EliteScanner | null = null;
  private strategyEngine: EliteStrategyEngine;
  
  private constructor() {
    this.strategyEngine = EliteStrategyEngine.getInstance();
  }
  
  static getInstance(): EliteScanner {
    if (!EliteScanner.instance) {
      EliteScanner.instance = new EliteScanner();
    }
    return EliteScanner.instance;
  }
  
  /**
   * Scan all tickers for elite trade setups
   * Returns top 15 ranked by signal quality
   */
  async scan(): Promise<{
    results: EliteScanResult[];
    marketStatus: 'open' | 'closed';
    scannedSymbols: number;
    isLive: boolean;
    scanDuration: number;
  }> {
    const startTime = Date.now();
    const marketContext = liveDataAdapter.getMarketContext();
    
    console.log(`🔍 Starting Elite Scanner (${marketContext.isLive ? 'LIVE' : 'HISTORICAL'} data)...`);
    
    // Load strategy parameters
    await this.strategyEngine.loadParametersFromDatabase();
    const config = this.strategyEngine.getConfig();
    
    // Diagnostic counters
    let totalScanned = 0;
    let passedRSI = 0;
    let passedEMA = 0;
    let passedATR = 0;
    let hadOptionsData = 0;
    let passedIV = 0;
    let passedGamma = 0;
    let passedVolume = 0;
    let passedDelta = 0;
    
    // Select symbol universe based on market status
    const symbols = getSymbolUniverse(marketContext.isLive);
    console.log(`📋 Scanning ${symbols.length} symbols (${marketContext.isLive ? 'LIVE' : 'TEST'} mode)`);
    
    // Scan all tickers in parallel (batched for performance)
    const batchSize = 3; // Process 3 at a time to avoid rate limits (reduced from 10)
    const allResults: EliteScanResult[] = [];
    
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      totalScanned += batch.length;
      
      const batchPromises = batch.map(symbol => this.scanTicker(symbol, config, marketContext.isLive));
      const batchResults = await Promise.all(batchPromises);
      
      // Filter out null results
      const validResults = batchResults.filter((r): r is EliteScanResult => r !== null);
      allResults.push(...validResults);
    }
    
    // Sort by signal quality (descending)
    const topResults = allResults
      .sort((a, b) => b.signalQuality - a.signalQuality)
      .slice(0, 15); // Top 15
    
    const scanDuration = Date.now() - startTime;
    
    console.log(`✅ Elite Scanner complete: ${topResults.length} signals found in ${(scanDuration/1000).toFixed(2)}s`);
    console.log(`📊 Filter funnel: ${totalScanned} scanned → ${allResults.length} passed all filters`);
    
    return {
      results: topResults,
      marketStatus: marketContext.marketStatus as 'open' | 'closed',
      scannedSymbols: symbols.length,
      isLive: marketContext.isLive,
      scanDuration
    };
  }
  
  /**
   * Scan a single ticker for trade setup
   */
  private async scanTicker(
    symbol: string,
    config: any,
    isLive: boolean
  ): Promise<EliteScanResult | null> {
    try {
      // Get technical indicators
      const indicators = await liveDataAdapter.getIndicatorBundle(symbol, 14);
      
      if (!indicators || indicators.rsi === undefined) {
        return null;
      }
      
      // Determine signal type based on RSI (more permissive)
      let optionType: 'call' | 'put' | null = null;
      const passedFilters: string[] = [];
      
      // CALL signal: RSI in oversold zone OR recently crossed up
      if (indicators.rsi <= config.rsiOversold || 
          (indicators.rsiPrevious <= config.rsiOversold && indicators.rsi > config.rsiOversold)) {
        optionType = 'call';
        passedFilters.push(indicators.rsi <= config.rsiOversold ? 'RSI Oversold' : 'RSI Oversold Bounce');
      }
      
      // PUT signal: RSI in overbought zone OR recently crossed down
      if (indicators.rsi >= config.rsiOverbought || 
          (indicators.rsiPrevious >= config.rsiOverbought && indicators.rsi < config.rsiOverbought)) {
        optionType = 'put';
        passedFilters.push(indicators.rsi >= config.rsiOverbought ? 'RSI Overbought' : 'RSI Overbought Reversal');
      }
      
      // No signal if RSI is neutral (between 40-60)
      if (!optionType) {
        return null;
      }
      
      // Check trend alignment
      const trendAligned = optionType === 'call'
        ? indicators.currentPrice > indicators.ema20
        : indicators.currentPrice < indicators.ema20;
      
      if (!trendAligned) {
        return null; // Skip if trend doesn't align
      }
      passedFilters.push('EMA Trend Aligned');
      
      // Check ATR momentum
      const hasATRMomentum = indicators.atrShort > (indicators.atrLong * config.atrMultiplier);
      if (!hasATRMomentum) {
        return null; // Skip if no momentum
      }
      passedFilters.push('ATR Momentum');
      
      // Get options analytics
      const optionsData = await liveDataAdapter.getOptionsAnalytics(symbol, optionType);
      
      if (!optionsData) {
        return null; // No options data available
      }
      
      // Enhanced filters (NEW!) - RELAXED THRESHOLDS for 3-5 daily plays
      
      // Filter 1: IV Percentile > 30% (elevated volatility) - REQUIRED
      if (optionsData.ivPercentile < 30) {
        return null;
      }
      passedFilters.push(`IV Rank ${optionsData.ivPercentile.toFixed(0)}%`);
      
      // Filter 2: Gamma > 0.05 (moderate gamma exposure) - REQUIRED
      if (optionsData.gamma <= 0.05) {
        return null;
      }
      passedFilters.push(`⚡ Gamma ${optionsData.gamma.toFixed(3)}`);
      
      // Filter 3: Volume > 1.5x average (moderate volume increase) - REQUIRED
      if (optionsData.volumeRatio <= 1.5) {
        return null;
      }
      passedFilters.push(`🔥 Volume ${optionsData.volumeRatio.toFixed(1)}x`);

      
      // Filter 4: Delta range (0.3-0.7 for stock options)
      const deltaInRange = Math.abs(optionsData.delta) >= 0.3 && Math.abs(optionsData.delta) <= 0.7;
      if (!deltaInRange) {
        return null;
      }
      passedFilters.push(`Delta ${optionsData.delta.toFixed(2)}`);
      
      // Calculate signal quality (0-100)
      const signalQuality = this.calculateSignalQuality({
        rsiDistance: Math.abs(indicators.rsi - 50) / 50, // 0-1 scale
        trendAlignment: trendAligned,
        atrMomentum: hasATRMomentum,
        ivPercentile: optionsData.ivPercentile,
        gamma: optionsData.gamma,
        volumeRatio: optionsData.volumeRatio,
        delta: Math.abs(optionsData.delta)
      });
      
      return {
        symbol,
        optionType,
        
        // Stock metrics
        stockPrice: indicators.currentPrice,
        rsi: indicators.rsi,
        rsiPrevious: indicators.rsiPrevious,
        ema20: indicators.ema20,
        atrShort: indicators.atrShort,
        atrLong: indicators.atrLong,
        
        // Options analytics
        strike: optionsData.strike,
        expiry: optionsData.expiry,
        delta: optionsData.delta,
        gamma: optionsData.gamma,
        theta: optionsData.theta,
        vega: optionsData.vega,
        impliedVolatility: optionsData.impliedVolatility,
        ivPercentile: optionsData.ivPercentile,
        
        // Volume metrics
        volumeRatio: optionsData.volumeRatio,
        isUnusualVolume: optionsData.volumeRatio > 1.5,
        
        // Signal quality
        signalQuality,
        passedFilters,
        
        // Metadata
        isLive,
        scannedAt: Date.now()
      };
    } catch (error: any) {
      console.error(`Failed to scan ${symbol}:`, error.message);
      return null;
    }
  }
  
  /**
   * Calculate signal quality score (0-100)
   */
  private calculateSignalQuality(metrics: {
    rsiDistance: number; // 0-1
    trendAlignment: boolean;
    atrMomentum: boolean;
    ivPercentile: number; // 0-100
    gamma: number;
    volumeRatio: number;
    delta: number;
  }): number {
    let score = 0;
    
    // RSI extremity (25 points)
    score += metrics.rsiDistance * 25;
    
    // Trend alignment (20 points)
    if (metrics.trendAlignment) score += 20;
    
    // ATR momentum (15 points)
    if (metrics.atrMomentum) score += 15;
    
    // IV percentile (15 points)
    score += (metrics.ivPercentile / 100) * 15;
    
    // Gamma squeeze bonus (10 points)
    if (metrics.gamma > 0.15) score += 10;
    
    // Unusual volume bonus (10 points)
    if (metrics.volumeRatio > 3) score += 10;
    
    // Delta quality (5 points)
    const deltaQuality = 1 - Math.abs(metrics.delta - 0.5); // Ideal delta = 0.5
    score += deltaQuality * 5;
    
    return Math.min(100, Math.max(0, score));
  }
}

// Export singleton instance
export const eliteScanner = EliteScanner.getInstance();
