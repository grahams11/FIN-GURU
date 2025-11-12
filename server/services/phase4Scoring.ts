/**
 * Phase 4 Scoring System (Shared Module)
 * 4-layer intelligent scoring for options trading
 * Reusable by Ghost 1DTE and Enhanced UOA scanners
 * 
 * Designed to minimize API calls - expects pre-fetched data
 */

export interface Phase4ScoreResult {
  totalScore: number;
  layer1: number; // Max Pain + Gamma Trap (30 pts)
  layer2: number; // IV Skew Inversion (25 pts)
  layer3: number; // Ghost Sweep Detection (30 pts)
  layer4: number; // RSI Extreme (15 pts)
  activeLayers: number; // Count of layers that scored > 0
  breakdown: {
    maxPain: number | null;
    maxPainProximity: number | null;
    ivSkew: { callIV: number; putIV: number } | null;
    volumeSpike: boolean;
    rsi: number | null;
    rsiExtreme: boolean;
  };
}

export interface Phase4InputData {
  symbol: string;
  currentPrice: number;
  volume: number;
  openInterest: number;
  dte: number; // Days to expiry
  optionContracts?: any[]; // Option chain snapshot
  historicalBars?: any[]; // Historical price bars for RSI
  
  // Optional precomputed values (skip calculation if provided)
  precomputedMaxPain?: number | null;
  precomputedIvSkew?: { callIV: number; putIV: number } | null;
  precomputedRsi?: number | null;
}

export interface Phase4Config {
  maxPainProximityThreshold?: number; // Default: 0.007 (0.7%)
  ivSkewRatio?: number; // Default: 0.92
  volumeOiRatio?: number; // Default: 0.5 (50%)
  rsiLowerBound?: number; // Default: 30
  rsiUpperBound?: number; // Default: 70
  dteCutoff?: number; // Default: 3
  layer1Weight?: number; // Default: 30
  layer2Weight?: number; // Default: 25
  layer3Weight?: number; // Default: 30
  layer4Weight?: number; // Default: 15
}

/**
 * Calculate Phase 4 composite score from pre-fetched data
 * NO API calls made - all data must be provided
 */
export class Phase4Scoring {
  
  /**
   * Main scoring function - calculates all 4 layers
   * @param data Input data and optional precomputed metrics
   * @param config Optional configuration for thresholds and weights
   */
  static calculateScore(data: Phase4InputData, config?: Phase4Config): Phase4ScoreResult {
    const { 
      symbol, 
      currentPrice, 
      volume, 
      openInterest, 
      dte, 
      optionContracts, 
      historicalBars,
      precomputedMaxPain,
      precomputedIvSkew,
      precomputedRsi
    } = data;
    
    // Apply default config values
    const cfg: Required<Phase4Config> = {
      maxPainProximityThreshold: config?.maxPainProximityThreshold ?? 0.007,
      ivSkewRatio: config?.ivSkewRatio ?? 0.92,
      volumeOiRatio: config?.volumeOiRatio ?? 0.5,
      rsiLowerBound: config?.rsiLowerBound ?? 30,
      rsiUpperBound: config?.rsiUpperBound ?? 70,
      dteCutoff: config?.dteCutoff ?? 3,
      layer1Weight: config?.layer1Weight ?? 30,
      layer2Weight: config?.layer2Weight ?? 25,
      layer3Weight: config?.layer3Weight ?? 30,
      layer4Weight: config?.layer4Weight ?? 15
    };
    
    // Layer 1: Max Pain + Gamma Trap
    let layer1 = 0;
    let maxPain: number | null = precomputedMaxPain ?? null;
    let maxPainProximity: number | null = null;
    
    // Use precomputed value if available, otherwise calculate
    if (maxPain === null && optionContracts && optionContracts.length > 0) {
      maxPain = this.calculateMaxPain(optionContracts);
    }
    
    if (maxPain !== null) {
      maxPainProximity = Math.abs(currentPrice - maxPain) / currentPrice;
      const gammaTrap = maxPainProximity < cfg.maxPainProximityThreshold;
      layer1 = gammaTrap ? cfg.layer1Weight : 0;
    }
    
    // Layer 2: IV Skew Inversion
    let layer2 = 0;
    let ivSkew: { callIV: number; putIV: number } | null = precomputedIvSkew ?? null;
    
    // Use precomputed value if available, otherwise calculate
    if (ivSkew === null && optionContracts && optionContracts.length > 0) {
      ivSkew = this.calculateIVSkew(optionContracts);
    }
    
    if (ivSkew) {
      const skewBullish = ivSkew.callIV < ivSkew.putIV * cfg.ivSkewRatio;
      layer2 = skewBullish ? cfg.layer2Weight : 0;
    }
    
    // Layer 3: Ghost Sweep Detection
    // Volume spike indicates unusual institutional activity
    const volumeSpike = volume > openInterest * cfg.volumeOiRatio;
    const layer3 = volumeSpike ? cfg.layer3Weight : 0;
    
    // Layer 4: RSI Extreme + DTE
    let layer4 = 0;
    let rsi: number | null = precomputedRsi ?? null;
    let rsiExtreme = false;
    
    // Use precomputed value if available, otherwise calculate
    if (rsi === null && historicalBars && historicalBars.length >= 15) {
      rsi = this.calculateRSI(historicalBars);
    }
    
    if (rsi !== null) {
      rsiExtreme = rsi < cfg.rsiLowerBound || rsi > cfg.rsiUpperBound;
      layer4 = (dte <= cfg.dteCutoff && rsiExtreme) ? cfg.layer4Weight : 0;
    }
    
    // Calculate total and count active layers
    const totalScore = layer1 + layer2 + layer3 + layer4;
    const activeLayers = [layer1, layer2, layer3, layer4].filter(l => l > 0).length;
    
    return {
      totalScore,
      layer1,
      layer2,
      layer3,
      layer4,
      activeLayers,
      breakdown: {
        maxPain,
        maxPainProximity,
        ivSkew,
        volumeSpike,
        rsi,
        rsiExtreme
      }
    };
  }
  
  /**
   * Calculate Max Pain from option chain snapshot
   * Max Pain = strike price with maximum total open interest
   */
  static calculateMaxPain(contracts: any[], expiry?: string): number | null {
    try {
      if (!contracts || contracts.length === 0) {
        return null;
      }
      
      // Filter for specific expiry if provided
      let filteredContracts = contracts;
      if (expiry) {
        filteredContracts = contracts.filter((c: any) => {
          const contractExpiry = new Date(c.details?.expiration_date || c.expiration_date);
          return contractExpiry.toISOString().split('T')[0] === expiry;
        });
      }
      
      // Sum open interest by strike price
      const oiByStrike = new Map<number, number>();
      
      for (const contract of filteredContracts) {
        const strike = contract.details?.strike_price || contract.strike_price;
        const oi = contract.open_interest || 0;
        if (strike) {
          oiByStrike.set(strike, (oiByStrike.get(strike) || 0) + oi);
        }
      }
      
      if (oiByStrike.size === 0) return null;
      
      // Find strike with maximum OI
      let maxStrike = 0;
      let maxOI = 0;
      
      const entries = Array.from(oiByStrike.entries());
      for (const [strike, oi] of entries) {
        if (oi > maxOI) {
          maxOI = oi;
          maxStrike = strike;
        }
      }
      
      return maxStrike;
      
    } catch (error) {
      console.error(`Error calculating max pain:`, error);
      return null;
    }
  }
  
  /**
   * Calculate IV Skew from option chain snapshot
   * Returns average implied volatility for calls vs puts
   */
  static calculateIVSkew(contracts: any[]): { callIV: number; putIV: number } | null {
    try {
      if (!contracts || contracts.length === 0) {
        return null;
      }
      
      // Separate calls and puts
      const calls = contracts.filter((opt: any) => 
        (opt.details?.contract_type || opt.contract_type) === 'call'
      );
      const puts = contracts.filter((opt: any) => 
        (opt.details?.contract_type || opt.contract_type) === 'put'
      );
      
      if (calls.length === 0 || puts.length === 0) {
        return null;
      }
      
      // Calculate average IV
      const callIV = calls.reduce((sum: number, c: any) => 
        sum + (c.implied_volatility || 0), 0
      ) / calls.length;
      const putIV = puts.reduce((sum: number, p: any) => 
        sum + (p.implied_volatility || 0), 0
      ) / puts.length;
      
      return { callIV, putIV };
      
    } catch (error) {
      console.error(`Error calculating IV skew:`, error);
      return null;
    }
  }
  
  /**
   * Calculate RSI (Relative Strength Index) from historical bars
   * @param bars Historical price bars with 'c' (close) property
   * @param period RSI period (default: 14)
   */
  static calculateRSI(bars: any[], period = 14): number | null {
    try {
      if (!bars || bars.length < period + 1) {
        return null;
      }
      
      const prices = bars.map(bar => bar.c);
      const gains: number[] = [];
      const losses: number[] = [];
      
      for (let i = 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) {
          gains.push(diff);
          losses.push(0);
        } else {
          gains.push(0);
          losses.push(-diff);
        }
      }
      
      const recentGains = gains.slice(-period);
      const recentLosses = losses.slice(-period);
      
      const avgGain = recentGains.reduce((sum, g) => sum + g, 0) / period;
      const avgLoss = recentLosses.reduce((sum, l) => sum + l, 0) / period;
      
      // Handle edge cases
      if (avgLoss === 0) {
        return avgGain > 0 ? 100 : 50;
      }
      
      const rs = avgGain / avgLoss;
      return 100 - (100 / (1 + rs));
      
    } catch (error) {
      console.error(`Error calculating RSI:`, error);
      return null;
    }
  }
  
  /**
   * Determine if a score meets quality threshold
   * @param score Phase 4 score result
   * @param minScore Minimum total score (default: 70)
   * @param minActiveLayers Minimum active layers (default: 2)
   */
  static meetsThreshold(
    score: Phase4ScoreResult, 
    minScore: number = 70, 
    minActiveLayers: number = 2
  ): boolean {
    return score.totalScore >= minScore && score.activeLayers >= minActiveLayers;
  }
}
