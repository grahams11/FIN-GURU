import { WebScraperService } from './webScraper';
import { AIAnalysisService } from './aiAnalysis';
import type { 
  PositionAnalysis, 
  PortfolioAnalysis, 
  PortfolioPosition, 
  OptionsMetadata, 
  Greeks 
} from '@shared/schema';

export class PositionAnalysisService {
  /**
   * Analyzes a single position with live market data
   */
  static async analyzePosition(position: PortfolioPosition): Promise<PositionAnalysis> {
    try {
      // Get live stock price using existing web scraping
      const stockData = await WebScraperService.scrapeStockPrice(position.ticker);
      const currentPrice = stockData.price;
      
      // Generate market sentiment score using volatility and price change
      const sentiment = this.calculateSentiment(stockData.changePercent, stockData.volume || 1000000);
      const confidence = this.calculateConfidence(stockData.changePercent);
      
      // Calculate basic metrics
      const totalCost = position.avgCost * position.quantity;
      const currentValue = currentPrice * position.quantity;
      const unrealizedPnL = currentValue - totalCost;
      const unrealizedPnLPercent = (unrealizedPnL / totalCost) * 100;
      const dayChange = stockData.change * position.quantity;
      const dayChangePercent = stockData.changePercent;
      
      let analysis: PositionAnalysis = {
        id: position.id,
        ticker: position.ticker,
        positionType: position.positionType as 'options' | 'stock',
        currentPrice,
        entryPrice: position.avgCost,
        currentValue,
        unrealizedPnL,
        unrealizedPnLPercent,
        dayChange,
        dayChangePercent,
        quantity: position.quantity,
        totalCost,
        sentiment,
        confidence,
        riskLevel: this.calculateRiskLevel(unrealizedPnLPercent, stockData.changePercent),
        exitStrategy: this.generateExitStrategy(position, currentPrice, unrealizedPnLPercent, { sentiment, confidence })
      };
      
      // Options-specific analysis
      if (position.positionType === 'options' && position.metadata) {
        const optionsData = position.metadata as OptionsMetadata;
        analysis = await this.addOptionsAnalysis(analysis, optionsData, currentPrice);
      }
      
      return analysis;
    } catch (error) {
      console.error(`Error analyzing position ${position.ticker}:`, error);
      throw error;
    }
  }
  
  /**
   * Analyzes the entire portfolio
   */
  static async analyzePortfolio(positions: PortfolioPosition[]): Promise<PortfolioAnalysis> {
    try {
      const positionAnalyses = await Promise.all(
        positions.map(position => this.analyzePosition(position))
      );
      
      const totalValue = positionAnalyses.reduce((sum, pos) => sum + pos.currentValue, 0);
      const totalCost = positionAnalyses.reduce((sum, pos) => sum + pos.totalCost, 0);
      const totalPnL = totalValue - totalCost;
      const totalPnLPercent = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
      const dayChange = positionAnalyses.reduce((sum, pos) => sum + pos.dayChange, 0);
      
      const riskMetrics = this.calculatePortfolioRisk(positionAnalyses);
      const recommendations = this.generatePortfolioRecommendations(positionAnalyses, riskMetrics);
      
      // Calculate overall portfolio sentiment (average of position sentiments)
      const overallSentiment = positionAnalyses.length > 0 
        ? positionAnalyses.reduce((sum, pos) => sum + pos.sentiment, 0) / positionAnalyses.length
        : 0;
      
      // Map portfolio risk to simple risk level
      const riskLevel = riskMetrics.portfolioRisk;
      
      return {
        totalValue,
        totalCost,
        totalPnL,
        totalPnLPercent,
        dayChange,
        positions: positionAnalyses,
        riskMetrics,
        recommendations,
        overallSentiment,
        riskLevel
      };
    } catch (error) {
      console.error('Error analyzing portfolio:', error);
      throw error;
    }
  }
  
  /**
   * Adds options-specific analysis
   */
  private static async addOptionsAnalysis(
    analysis: PositionAnalysis, 
    optionsData: OptionsMetadata, 
    currentPrice: number
  ): Promise<PositionAnalysis> {
    const expiryDate = new Date(optionsData.expiry);
    const now = new Date();
    const timeToExpiry = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 365);
    
    // Calculate moneyness
    let moneyness: 'ITM' | 'OTM' | 'ATM';
    const priceDiff = Math.abs(currentPrice - optionsData.strike);
    const percentDiff = priceDiff / optionsData.strike;
    
    if (percentDiff < 0.02) {
      moneyness = 'ATM';
    } else if (optionsData.optionType === 'call') {
      moneyness = currentPrice > optionsData.strike ? 'ITM' : 'OTM';
    } else {
      moneyness = currentPrice < optionsData.strike ? 'ITM' : 'OTM';
    }
    
    // Calculate break-even for options
    const breakEvenPrice = optionsData.optionType === 'call' 
      ? optionsData.strike + optionsData.entryPrice
      : optionsData.strike - optionsData.entryPrice;
    
    // Estimate Greeks using Black-Scholes
    const riskFreeRate = 0.05; // 5% risk-free rate
    const impliedVolatility = 0.25; // 25% IV estimate
    const greeks = this.calculateBlackScholesGreeks(
      currentPrice,
      optionsData.strike,
      timeToExpiry,
      riskFreeRate,
      impliedVolatility,
      optionsData.optionType
    );
    
    // Recalculate current value for options
    const optionPrice = this.estimateOptionPrice(
      currentPrice,
      optionsData.strike,
      timeToExpiry,
      impliedVolatility,
      optionsData.optionType === 'call'
    );
    
    const currentValue = optionPrice * optionsData.contracts * 100;
    const totalCost = optionsData.entryPrice * optionsData.contracts * 100;
    const unrealizedPnL = currentValue - totalCost;
    const unrealizedPnLPercent = (unrealizedPnL / totalCost) * 100;
    
    return {
      ...analysis,
      currentValue,
      unrealizedPnL,
      unrealizedPnLPercent,
      breakEvenPrice,
      greeks,
      timeToExpiry,
      impliedVolatility,
      moneyness,
      exitStrategy: this.generateOptionsExitStrategy(
        optionsData, 
        currentPrice, 
        timeToExpiry, 
        unrealizedPnLPercent,
        greeks
      )
    };
  }
  
  /**
   * Calculates risk level based on P&L and volatility
   */
  private static calculateRiskLevel(pnlPercent: number, dayChangePercent: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    const absChange = Math.abs(dayChangePercent);
    
    if (pnlPercent < -20 || absChange > 5) return 'HIGH';
    if (pnlPercent < -10 || absChange > 3) return 'MEDIUM';
    return 'LOW';
  }
  
  /**
   * Generates exit strategy for stock positions
   */
  private static generateExitStrategy(
    position: PortfolioPosition,
    currentPrice: number,
    pnlPercent: number,
    sentimentData: any
  ) {
    const confidence = sentimentData?.confidence || 0.5;
    const sentiment = sentimentData?.sentiment || 0.5;
    
    let recommendation: 'HOLD' | 'TAKE_PROFIT' | 'CUT_LOSS' | 'MONITOR' = 'HOLD';
    const reasoning: string[] = [];
    
    // Profit target (20-40% above entry)
    const profitTarget = position.avgCost * (1.2 + confidence * 0.2);
    
    // Stop loss (10-20% below entry)
    const stopLoss = position.avgCost * (0.8 + confidence * 0.1);
    
    // Decision logic
    if (pnlPercent > 25) {
      recommendation = 'TAKE_PROFIT';
      reasoning.push('Position showing strong gains above 25%');
    } else if (pnlPercent < -15) {
      recommendation = 'CUT_LOSS';
      reasoning.push('Position down more than 15%, consider cutting losses');
    } else if (sentiment < 0.3) {
      recommendation = 'MONITOR';
      reasoning.push('Negative sentiment detected, monitor closely');
    } else if (currentPrice >= profitTarget) {
      recommendation = 'TAKE_PROFIT';
      reasoning.push('Price reached profit target');
    } else if (currentPrice <= stopLoss) {
      recommendation = 'CUT_LOSS';
      reasoning.push('Price hit stop loss level');
    }
    
    // Add sentiment-based reasoning
    if (sentiment > 0.7) {
      reasoning.push('Strong positive sentiment supports holding');
    } else if (sentiment < 0.4) {
      reasoning.push('Weak sentiment suggests caution');
    }
    
    return {
      profitTarget,
      stopLoss,
      timeBasedExit: 'No time constraint for stock positions',
      recommendation,
      reasoning
    };
  }
  
  /**
   * Generates exit strategy for options positions
   */
  private static generateOptionsExitStrategy(
    optionsData: OptionsMetadata,
    currentPrice: number,
    timeToExpiry: number,
    pnlPercent: number,
    greeks: Greeks
  ) {
    let recommendation: 'HOLD' | 'TAKE_PROFIT' | 'CUT_LOSS' | 'MONITOR' = 'HOLD';
    const reasoning: string[] = [];
    
    const profitTarget = optionsData.entryPrice * 1.5; // 50% profit target
    const stopLoss = optionsData.entryPrice * 0.5; // 50% stop loss
    
    // Time-based analysis
    const daysToExpiry = timeToExpiry * 365;
    
    if (daysToExpiry < 7) {
      if (pnlPercent > 0) {
        recommendation = 'TAKE_PROFIT';
        reasoning.push('Less than 7 days to expiry, take profits while available');
      } else {
        recommendation = 'CUT_LOSS';
        reasoning.push('Option expiring soon with losses, cut losses');
      }
    } else if (daysToExpiry < 21) {
      recommendation = 'MONITOR';
      reasoning.push('Approaching expiry, monitor theta decay closely');
    }
    
    // Theta decay analysis
    if (Math.abs(greeks.theta) > 0.1 && daysToExpiry < 30) {
      reasoning.push(`High theta decay (${greeks.theta.toFixed(3)}) accelerating time decay`);
    }
    
    // Delta analysis
    if (Math.abs(greeks.delta) < 0.2) {
      reasoning.push('Low delta indicates option may be too far OTM');
    }
    
    // P&L based decisions
    if (pnlPercent > 50) {
      recommendation = 'TAKE_PROFIT';
      reasoning.push('Excellent gains over 50%, consider taking profits');
    } else if (pnlPercent < -75) {
      recommendation = 'CUT_LOSS';
      reasoning.push('Significant losses over 75%, consider cutting losses');
    }
    
    const timeBasedExit = daysToExpiry < 21 
      ? `Exit before ${Math.floor(daysToExpiry - 7)} days to avoid theta decay` 
      : `Monitor position, ${Math.floor(daysToExpiry)} days remaining`;
    
    return {
      profitTarget,
      stopLoss,
      timeBasedExit,
      recommendation,
      reasoning
    };
  }
  
  /**
   * Calculates portfolio-level risk metrics
   */
  private static calculatePortfolioRisk(positions: PositionAnalysis[]) {
    const totalValue = positions.reduce((sum, pos) => sum + pos.currentValue, 0);
    
    // Concentration risk (% of largest position)
    const largestPosition = Math.max(...positions.map(pos => pos.currentValue));
    const concentration = totalValue > 0 ? (largestPosition / totalValue) * 100 : 0;
    
    // Portfolio risk level
    const highRiskPositions = positions.filter(pos => pos.riskLevel === 'HIGH').length;
    const totalPositions = positions.length;
    const riskRatio = totalPositions > 0 ? highRiskPositions / totalPositions : 0;
    
    let portfolioRisk: 'LOW' | 'MEDIUM' | 'HIGH';
    if (riskRatio > 0.5 || concentration > 50) portfolioRisk = 'HIGH';
    else if (riskRatio > 0.25 || concentration > 30) portfolioRisk = 'MEDIUM';
    else portfolioRisk = 'LOW';
    
    // Max potential loss (sum of all negative positions)
    const maxLoss = positions
      .filter(pos => pos.unrealizedPnL < 0)
      .reduce((sum, pos) => sum + Math.abs(pos.unrealizedPnL), 0);
    
    return {
      portfolioRisk,
      concentration,
      beta: 1.0, // Simplified, would need market correlation analysis
      maxLoss
    };
  }
  
  /**
   * Generates portfolio-level recommendations
   */
  private static generatePortfolioRecommendations(
    positions: PositionAnalysis[], 
    riskMetrics: any
  ): string[] {
    const recommendations: string[] = [];
    
    if (riskMetrics.concentration > 40) {
      recommendations.push('Consider diversifying - largest position represents over 40% of portfolio');
    }
    
    const profitablePositions = positions.filter(pos => pos.unrealizedPnL > 0);
    const losingPositions = positions.filter(pos => pos.unrealizedPnL < 0);
    
    if (profitablePositions.length > losingPositions.length * 2) {
      recommendations.push('Strong performance with majority of positions profitable');
    }
    
    if (riskMetrics.maxLoss > riskMetrics.concentration * 1000) {
      recommendations.push('Consider setting stop losses to limit downside risk');
    }
    
    const optionsPositions = positions.filter(pos => pos.positionType === 'options');
    const shortTimeOptions = optionsPositions.filter(pos => 
      pos.timeToExpiry && pos.timeToExpiry * 365 < 21
    );
    
    if (shortTimeOptions.length > 0) {
      recommendations.push(`${shortTimeOptions.length} options positions expiring within 3 weeks - monitor theta decay`);
    }
    
    return recommendations;
  }
  
  /**
   * Calculate sentiment based on price movement and volume
   */
  private static calculateSentiment(changePercent: number, volume: number): number {
    let sentiment = 0.5; // Neutral baseline
    
    // Price movement influence
    sentiment += Math.min(Math.max(changePercent / 10, -0.3), 0.3);
    
    // Volume influence (higher volume = stronger sentiment)
    const volumeMultiplier = Math.min(volume / 10000000, 2); // Cap at 2x
    if (changePercent > 0) {
      sentiment += (volumeMultiplier - 1) * 0.1;
    } else {
      sentiment -= (volumeMultiplier - 1) * 0.1;
    }
    
    return Math.max(0.1, Math.min(0.9, sentiment));
  }
  
  /**
   * Calculate confidence based on price volatility and movement
   */
  private static calculateConfidence(changePercent: number): number {
    const absChange = Math.abs(changePercent);
    
    // Higher confidence with moderate movements, lower with extreme volatility
    if (absChange < 1) return 0.4 + absChange * 0.2; // 0.4-0.6
    if (absChange < 3) return 0.6 + (absChange - 1) * 0.1; // 0.6-0.8
    if (absChange < 5) return 0.8 - (absChange - 3) * 0.05; // 0.8-0.7
    return Math.max(0.3, 0.7 - (absChange - 5) * 0.02); // Decreasing confidence with extreme moves
  }
  
  /**
   * Calculate Black-Scholes Greeks
   */
  private static calculateBlackScholesGreeks(
    S: number, // Current stock price
    K: number, // Strike price
    T: number, // Time to expiration (in years)
    r: number, // Risk-free rate
    sigma: number, // Volatility
    optionType: 'call' | 'put'
  ): Greeks {
    if (T <= 0) {
      return {
        delta: optionType === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0),
        gamma: 0,
        theta: 0,
        vega: 0,
        rho: 0
      };
    }

    const d1 = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);

    const Nd1 = this.normalCDF(d1);
    const Nd2 = this.normalCDF(d2);
    const nd1 = this.normalPDF(d1);

    if (optionType === 'call') {
      const delta = Nd1;
      const gamma = nd1 / (S * sigma * Math.sqrt(T));
      const theta = -(S * nd1 * sigma / (2 * Math.sqrt(T))) - r * K * Math.exp(-r * T) * Nd2;
      const vega = S * nd1 * Math.sqrt(T);
      const rho = K * T * Math.exp(-r * T) * Nd2;
      
      return {
        delta: Math.round(delta * 10000) / 10000,
        gamma: Math.round(gamma * 10000) / 10000,
        theta: Math.round((theta / 365) * 10000) / 10000,
        vega: Math.round((vega / 100) * 10000) / 10000,
        rho: Math.round((rho / 100) * 10000) / 10000
      };
    } else {
      const delta = Nd1 - 1;
      const gamma = nd1 / (S * sigma * Math.sqrt(T));
      const theta = -(S * nd1 * sigma / (2 * Math.sqrt(T))) + r * K * Math.exp(-r * T) * (1 - Nd2);
      const vega = S * nd1 * Math.sqrt(T);
      const rho = -K * T * Math.exp(-r * T) * (1 - Nd2);
      
      return {
        delta: Math.round(delta * 10000) / 10000,
        gamma: Math.round(gamma * 10000) / 10000,
        theta: Math.round((theta / 365) * 10000) / 10000,
        vega: Math.round((vega / 100) * 10000) / 10000,
        rho: Math.round((rho / 100) * 10000) / 10000
      };
    }
  }
  
  /**
   * Estimate option price using Black-Scholes
   */
  private static estimateOptionPrice(
    S: number,
    K: number,
    T: number,
    sigma: number,
    isCall: boolean
  ): number {
    const r = 0.05; // Risk-free rate
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    
    if (isCall) {
      const callPrice = S * this.normalCDF(d1) - K * Math.exp(-r * T) * this.normalCDF(d2);
      return Math.max(0.05, callPrice); // Minimum $0.05
    } else {
      const putPrice = K * Math.exp(-r * T) * this.normalCDF(-d2) - S * this.normalCDF(-d1);
      return Math.max(0.05, putPrice); // Minimum $0.05
    }
  }
  
  /**
   * Normal cumulative distribution function
   */
  private static normalCDF(x: number): number {
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2.0);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
  }
  
  /**
   * Normal probability density function
   */
  private static normalPDF(x: number): number {
    return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
  }
}