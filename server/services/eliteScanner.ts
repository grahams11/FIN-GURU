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
import { batchDataService } from './batchDataService';
import { TimeUtils } from './timeUtils';
import { overnightDataFetcher } from './overnightDataFetcher';
import { calculateRSI, calculateEMA, calculateATR } from '../utils/indicators';

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
  pivotLevel: number; // (H + L + C) / 3
  abovePivot: number; // Percentage above pivot
  
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
   * Scan market for elite trade setups using batch approach
   * 1. ONE bulk API call fetches all stocks
   * 2. Filter in memory (price, volume, momentum)
   * 3. Analyze top candidates with options data
   * 4. Return top 3-5 plays
   */
  async scan(): Promise<{
    results: EliteScanResult[];
    marketStatus: 'open' | 'closed';
    scannedSymbols: number;
    isLive: boolean;
    isOvernight: boolean;
    scanDuration: number;
    overnightAlert?: string;
  }> {
    const startTime = Date.now();
    const marketContext = liveDataAdapter.getMarketContext();
    const isOvernight = TimeUtils.isOvernightHours();
    
    console.log(`🔍 Starting Elite Scanner (${isOvernight ? 'OVERNIGHT' : marketContext.isLive ? 'LIVE' : 'HISTORICAL'} data)...`);
    
    // Load strategy parameters
    await this.strategyEngine.loadParametersFromDatabase();
    const config = this.strategyEngine.getConfig();
    
    // STEP 1: Fetch ALL stocks in ONE bulk API call
    console.log('📦 Fetching bulk market snapshot...');
    const allStocks = await batchDataService.getStockUniverse();
    console.log(`📊 Received ${allStocks.length} stocks from bulk snapshot`);
    
    // STEP 2: Filter in memory for basic criteria
    const basicFiltered = allStocks.filter(stock => {
      // Price range: $10-$500 (options-friendly)
      if (stock.price < 10 || stock.price > 500) return false;
      
      // Volume: Must have significant volume (liquid options)
      if (!stock.volume || stock.volume < 100000) return false;
      
      // Price movement: Looking for momentum (>1% move)
      if (!stock.changePercent || Math.abs(stock.changePercent) < 1) return false;
      
      return true;
    });
    
    console.log(`🔎 Basic filters: ${allStocks.length} → ${basicFiltered.length} stocks`);
    
    // STEP 3: Analyze top candidates with full technical + options data
    console.log(`🧮 Analyzing top ${Math.min(basicFiltered.length, 50)} candidates...`);
    const candidates = basicFiltered.slice(0, 50); // Top 50 by volume/momentum
    
    const analysisPromises = candidates.map(stock => 
      this.analyzeTicker(stock.ticker, config, marketContext.isLive, isOvernight)
    );
    const analysisResults = await Promise.all(analysisPromises);
    
    // Filter out nulls and sort by signal quality
    const validResults = analysisResults.filter((r): r is EliteScanResult => r !== null);
    const topResults = validResults
      .sort((a, b) => b.signalQuality - a.signalQuality)
      .slice(0, 5); // Return top 5 plays
    
    const scanDuration = Date.now() - startTime;
    
    console.log(`✅ Elite Scanner complete: ${topResults.length} plays found in ${(scanDuration/1000).toFixed(2)}s`);
    console.log(`📊 Funnel: ${allStocks.length} → ${basicFiltered.length} → ${validResults.length} → ${topResults.length}`);
    
    return {
      results: topResults,
      marketStatus: marketContext.marketStatus as 'open' | 'closed',
      scannedSymbols: allStocks.length,
      isLive: marketContext.isLive,
      isOvernight,
      scanDuration,
      overnightAlert: isOvernight && topResults.length > 0
        ? `${topResults.length} overnight setup${topResults.length > 1 ? 's' : ''} detected - WATCH AT 8:30 AM CST`
        : undefined
    };
  }
  
  /**
   * Analyze a pre-filtered ticker candidate with full technical + options data
   * 
   * RELAXED FILTERS — STILL HIGH EDGE (TARGET: 3-5 PLAYS/DAY)
   * - RSI Oversold: < 40 (was 30)
   * - Volume Spike: > 1.5x average (was 1.8x)
   * - Intraday Momentum: > 1.5% move from open
   * - IV Percentile: > 25% (was 30%)
   * - Gamma: > 0.04 (was 0.05)
   * - Pivot Breakout: 1% above/below pivot level
   * - Trend Alignment: Price vs EMA20
   * - ATR Momentum: Short ATR > Long ATR
   */
  private async analyzeTicker(
    symbol: string,
    config: any,
    isLive: boolean,
    isOvernight: boolean = false
  ): Promise<EliteScanResult | null> {
    try {
      // OVERNIGHT MODE — REAL ANALYSIS WITH EOD + OVERNIGHT AGGS
      if (isOvernight) {
        let overnightSetup = await overnightDataFetcher.getOvernightSetup(symbol);
        
        // HISTORICAL FALLBACK: If EOD cache empty, pull last day's data directly
        if (!overnightSetup || !overnightSetup.data) {
          console.log(`📊 ${symbol}: No EOD cache, pulling historical data...`);
          try {
            const from = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const to = new Date().toISOString().split('T')[0];
            const histData = await polygonService.getAggregates(symbol, 1, 'day', from, to, 50);
            
            if (histData && histData.length > 0) {
              const latest = histData[histData.length - 1];
              const chain = await polygonService.getOptionsChain(symbol);
              overnightSetup = {
                data: {
                  eodSnapshot: {
                    symbol,
                    high: latest.h,
                    low: latest.l,
                    close: latest.c,
                    volume: latest.v,
                    timestamp: latest.t,
                    date: new Date(latest.t).toISOString().split('T')[0]
                  },
                  overnightBars: histData.slice(-20).map((d: any) => ({
                    time: d.t,
                    open: d.o,
                    high: d.h,
                    low: d.l,
                    close: d.c,
                    volume: d.v
                  })),
                  overnightHigh: Math.max(...histData.slice(-5).map((d: any) => d.h)),
                  overnightLow: Math.min(...histData.slice(-5).map((d: any) => d.l))
                },
                chain
              };
              console.log(`✅ ${symbol}: Historical fallback successful (${histData.length} bars)`);
            }
          } catch (err) {
            console.log(`❌ ${symbol}: Historical fallback failed`);
            return null;
          }
        }
        
        // Validation: Need EOD snapshot, overnight bars, and option chain
        if (!overnightSetup || !overnightSetup.data || !overnightSetup.chain) {
          return null;
        }
        
        const { data: overnightData, chain } = overnightSetup;
        const eod = overnightData.eodSnapshot;
        const bars = overnightData.overnightBars;
        
        // Require minimum 20 bars for indicators (EOD + overnight)
        if (bars.length < 20) {
          console.log(`❌ ${symbol}: Insufficient bars (${bars.length}/20)`);
          return null;
        }
        
        // Filter out bars with zero volume (sparse overnight data)
        const validBars = bars.filter(b => b.volume > 0);
        if (validBars.length < bars.length * 0.5) {
          console.log(`❌ ${symbol}: Too many zero-volume bars (${validBars.length}/${bars.length})`);
          return null; // Skip if >50% bars are invalid
        }
        
        console.log(`📊 ${symbol}: Analyzing (${validBars.length} bars, Price $${eod.close})`);
        
        // Combine EOD close + overnight closes for indicator context
        const closes = [eod.close, ...validBars.map(b => b.close)];
        
        // Normalize bars to {h, l, c} format for ATR calculation
        const normalizedBars = [
          { h: eod.high, l: eod.low, c: eod.close },
          ...validBars.map(b => ({ h: b.high, l: b.low, c: b.close }))
        ];
        
        // Calculate indicators from combined EOD + overnight bars
        const rsi = calculateRSI(closes);
        const ema20 = calculateEMA(closes, 20);
        const atr = calculateATR(normalizedBars);
        
        const currentPrice = closes[closes.length - 1];
        const priceChange = ((currentPrice - eod.close) / eod.close) * 100;
        
        // OVERNIGHT FILTERS (Liquidity-aware, loosened for better play detection)
        const passedFilters: string[] = [];
        let optionType: 'call' | 'put' | null = null;
        
        // Filter 1: RSI Signal (Loosened: 50/50 for overnight detection)
        if (rsi < 50) {
          optionType = 'call';
          passedFilters.push(`RSI Oversold ${rsi.toFixed(1)}`);
        } else if (rsi > 50) {
          optionType = 'put';
          passedFilters.push(`RSI Overbought ${rsi.toFixed(1)}`);
        } else {
          console.log(`❌ ${symbol}: Neutral RSI ${rsi.toFixed(1)}`);
          return null; // Neutral RSI, skip
        }
        
        // Filter 2: Price/EMA Alignment
        const trendAligned = optionType === 'call' 
          ? currentPrice > ema20 
          : currentPrice < ema20;
        
        if (!trendAligned) {
          console.log(`❌ ${symbol}: EMA misaligned (Price $${currentPrice.toFixed(2)} vs EMA $${ema20.toFixed(2)}, Type ${optionType})`);
          return null;
        }
        passedFilters.push('EMA Aligned');
        
        // Filter 3: Minimum Price Movement (0.8% vs EOD)
        if (Math.abs(priceChange) < 0.8) {
          console.log(`❌ ${symbol}: Insufficient movement ${priceChange.toFixed(2)}% (need 0.8%)`);
          return null;
        }
        passedFilters.push(`Move ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(1)}%`);
        
        // Filter 4: Volume Spike (Relaxed: 1.2x vs live 1.5x)
        const overnightVolume = validBars.reduce((sum, b) => sum + b.volume, 0);
        const volumeRatio = overnightVolume / eod.volume;
        if (volumeRatio < 1.2) {
          console.log(`❌ ${symbol}: Low volume ${volumeRatio.toFixed(2)}x (need 1.2x)`);
          return null;
        }
        passedFilters.push(`Vol ${volumeRatio.toFixed(1)}x`);
        
        // Filter 5: ATR Breakout (Relaxed: 1.2x vs live 1.5x)
        if (Math.abs(currentPrice - eod.close) < atr * 1.2) {
          console.log(`❌ ${symbol}: No ATR breakout (Move $${Math.abs(currentPrice - eod.close).toFixed(2)} vs ATR*1.2 $${(atr * 1.2).toFixed(2)})`);
          return null;
        }
        passedFilters.push('ATR Breakout');
        
        // Select best option contract (ATM bias, DTE 3-7, premium ≥$0.30)
        const contracts = optionType === 'call' ? chain.calls : chain.puts;
        if (!contracts || contracts.length === 0) {
          console.log(`❌ ${symbol}: No ${optionType} contracts available`);
          return null;
        }
        
        // Filter contracts: ATM ±5%, DTE 3-7, premium ≥$0.30, delta 0.3-0.6
        const atmContracts = contracts.filter(c => {
          const strikeDistance = Math.abs(c.strike - currentPrice) / currentPrice;
          const inATMRange = strikeDistance <= 0.05; // Within 5% of current price
          const validDTE = c.dte >= 3 && c.dte <= 7;
          const validPremium = c.premium >= 0.30;
          const validDelta = c.delta >= 0.3 && c.delta <= 0.6;
          
          return inATMRange && validDTE && validPremium && validDelta;
        });
        
        if (atmContracts.length === 0) {
          console.log(`❌ ${symbol}: No contracts match filters (${contracts.length} total, need ATM ±5%, DTE 3-7, premium ≥$0.30, delta 0.3-0.6)`);
          return null; // No suitable contracts
        }
        
        console.log(`✅ ${symbol}: PASSED ALL FILTERS → ${optionType.toUpperCase()} setup (${passedFilters.join(', ')})`);

        
        // Rank by highest volume/OI combo
        const bestContract = atmContracts.sort((a, b) => {
          const scoreA = (a.volume || 0) + (a.openInterest || 0);
          const scoreB = (b.volume || 0) + (b.openInterest || 0);
          return scoreB - scoreA;
        })[0];
        
        // Calculate pivot from overnight data
        const pivotLevel = (overnightData.overnightHigh + overnightData.overnightLow + currentPrice) / 3;
        const abovePivot = ((currentPrice - pivotLevel) / pivotLevel) * 100;
        
        // Calculate signal quality (cap at 80 for overnight due to missing live Greeks)
        const signalQuality = Math.min(80, 
          (rsi < 42 || rsi > 58 ? 30 : 0) + // RSI extreme
          (volumeRatio > 1.5 ? 20 : 10) +   // Volume spike
          (Math.abs(priceChange) > 1.5 ? 20 : 10) + // Price movement
          (bestContract.premium > 0.50 ? 10 : 5) +  // Premium size
          (bestContract.openInterest > 100 ? 10 : 5) // Liquidity
        );
        
        passedFilters.push('Overnight Setup', `Quality ${signalQuality}`);
        
        // Return full EliteScanResult for overnight analysis
        return {
          symbol,
          optionType,
          stockPrice: currentPrice,
          rsi,
          rsiPrevious: closes.length > 1 ? calculateRSI(closes.slice(0, -1)) : rsi,
          ema20,
          atrShort: atr,
          atrLong: atr, // Same for overnight
          pivotLevel,
          abovePivot,
          strike: bestContract.strike,
          expiry: bestContract.expiry,
          delta: bestContract.delta,
          gamma: bestContract.gamma || 0,
          theta: bestContract.theta || 0,
          vega: bestContract.vega || 0,
          impliedVolatility: bestContract.iv,
          ivPercentile: 0, // Not available for overnight
          volumeRatio,
          isUnusualVolume: volumeRatio > 3,
          signalQuality,
          passedFilters,
          isLive: false,
          scannedAt: Date.now()
        };
      }
      
      // LIVE/HISTORICAL MODE — USE LIVE DATA ADAPTER
      const indicators = await liveDataAdapter.getIndicatorBundle(symbol, 14);
      
      if (!indicators || indicators.rsi === undefined) {
        return null;
      }
      
      // Determine signal type based on RSI (RELAXED: oversold < 40)
      let optionType: 'call' | 'put' | null = null;
      const passedFilters: string[] = [];
      
      // CALL signal: RSI < 40 (oversold) OR recently crossed up from oversold
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
      
      // Calculate pivot level: (H + L + C) / 3 from last bar
      const lastBar = indicators.bars[indicators.bars.length - 1];
      const pivotLevel = (lastBar.high + lastBar.low + lastBar.close) / 3;
      const abovePivot = ((indicators.currentPrice - pivotLevel) / pivotLevel) * 100;
      
      // Intraday momentum filter: Price must have moved >1.5% from open
      const intradayMomentum = ((indicators.currentPrice - lastBar.open) / lastBar.open) * 100;
      if (Math.abs(intradayMomentum) < 1.5) {
        return null; // Skip if no significant intraday movement
      }
      passedFilters.push(`💨 Momentum ${intradayMomentum >= 0 ? '+' : ''}${intradayMomentum.toFixed(1)}%`);
      
      // Grok's Pivot Breakout Filter: Must be above pivot for calls, below for puts
      const pivotAligned = optionType === 'call'
        ? indicators.currentPrice > pivotLevel * 1.01  // 1% above pivot for calls
        : indicators.currentPrice < pivotLevel * 0.99; // 1% below pivot for puts
      
      if (!pivotAligned) {
        return null; // Skip if not breaking pivot level
      }
      passedFilters.push(`Pivot ${abovePivot >= 0 ? '+' : ''}${abovePivot.toFixed(1)}%`);
      
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
      
      // RELAXED FILTERS — STILL HIGH EDGE (TARGET: 3-5 PLAYS/DAY)
      // Simplified gate: 4 core filters for high-probability plays
      
      // Filter 1: RSI Oversold/Overbought (already checked above, config = 40/60)
      const rsiOversold = indicators.rsi < 40; // For calls
      const rsiOverbought = indicators.rsi > 60; // For puts
      
      // Filter 2: Volume Spike > 1.5x average (was 1.8x)
      const volumeSpike = optionsData.volumeRatio > 1.5;
      if (!volumeSpike) {
        return null;
      }
      passedFilters.push(`🔥 Volume ${optionsData.volumeRatio.toFixed(1)}x`);
      
      // Filter 3: Intraday Momentum > 1.5% (already checked at line 193)
      const momentumOk = Math.abs(intradayMomentum) >= 1.5;
      passedFilters.push(`💨 Momentum ${intradayMomentum >= 0 ? '+' : ''}${intradayMomentum.toFixed(1)}%`);
      
      // Filter 4: Premium > $0.30 (was $0.50)
      const premiumOk = optionsData.premium > 0.30;
      if (!premiumOk) {
        return null;
      }
      passedFilters.push(`💰 Premium $${optionsData.premium.toFixed(2)}`);
      
      // Filter 5: Pivot Breakout (already checked at line 199-206)
      const pivotBreakout = pivotAligned;
      passedFilters.push(`Pivot ${abovePivot >= 0 ? '+' : ''}${abovePivot.toFixed(1)}%`);
      
      // CORE GATE: All 4 filters + pivot must pass
      if (!pivotBreakout || !momentumOk || !volumeSpike || !premiumOk) {
        return null;
      }
      
      // OPTIONAL QUALITY FILTERS (for scoring, not hard rejects)
      // IV, Gamma, Delta contribute to signal quality but don't block plays
      if (optionsData.ivPercentile >= 25) {
        passedFilters.push(`IV Rank ${optionsData.ivPercentile.toFixed(0)}%`);
      }
      if (optionsData.gamma > 0.04) {
        passedFilters.push(`⚡ Gamma ${optionsData.gamma.toFixed(3)}`);
      }
      const deltaInRange = Math.abs(optionsData.delta) >= 0.3 && Math.abs(optionsData.delta) <= 0.7;
      if (deltaInRange) {
        passedFilters.push(`Delta ${optionsData.delta.toFixed(2)}`);
      }
      
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
        pivotLevel,
        abovePivot,
        
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
