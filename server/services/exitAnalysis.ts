import type { PortfolioPosition, PositionAnalysis, PortfolioAnalysis, Greeks, TradeRecommendation, OptionsMetadata } from '@shared/schema';
import { getContractMultiplier } from '@shared/constants';
import { BlackScholesCalculator } from './financialCalculations';

interface ExitRecommendation {
  action: 'HOLD' | 'TAKE_PROFIT' | 'TRIM_PROFIT' | 'STOP_LOSS' | 'REALLOCATE';
  reasoning: string[];
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  trimPercentage?: number;
  betterOpportunity?: TradeRecommendation;
}

export class ExitAnalysisService {
  
  /**
   * Analyze a single portfolio position and provide exit recommendations
   */
  analyzePosition(
    position: PortfolioPosition,
    currentPrice: number,
    availableOpportunities: TradeRecommendation[] = []
  ): PositionAnalysis {
    const metadata = position.metadata as OptionsMetadata | null;
    const isOptions = position.positionType === 'options';
    
    // Calculate P&L with proper contract multiplier for options
    const contractMultiplier = getContractMultiplier(position.positionType);
    const totalCost = position.avgCost * position.quantity * contractMultiplier;
    const currentValue = currentPrice * position.quantity * contractMultiplier;
    const unrealizedPnL = currentValue - totalCost;
    const unrealizedPnLPercent = (unrealizedPnL / totalCost) * 100;
    
    // Calculate Greeks for options
    let greeks: Greeks | undefined;
    let timeToExpiry: number | undefined;
    let impliedVolatility: number | undefined;
    let moneyness: 'ITM' | 'OTM' | 'ATM' | undefined;
    
    if (isOptions && metadata) {
      const expiryDate = new Date(metadata.expiry);
      timeToExpiry = (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      
      // Use implied volatility or default to 30%
      const iv = impliedVolatility || 0.30;
      
      greeks = BlackScholesCalculator.calculateGreeks(
        currentPrice,
        metadata.strike,
        timeToExpiry / 365,
        0.05, // risk-free rate
        iv,
        metadata.optionType
      );
      
      // Determine moneyness
      const priceDiff = currentPrice - metadata.strike;
      const threshold = currentPrice * 0.02; // 2% threshold
      
      if (metadata.optionType === 'call') {
        if (priceDiff > threshold) moneyness = 'ITM';
        else if (Math.abs(priceDiff) <= threshold) moneyness = 'ATM';
        else moneyness = 'OTM';
      } else {
        if (priceDiff < -threshold) moneyness = 'ITM';
        else if (Math.abs(priceDiff) <= threshold) moneyness = 'ATM';
        else moneyness = 'OTM';
      }
    }
    
    // Generate exit strategy
    const exitStrategy = this.generateExitStrategy(
      position,
      unrealizedPnLPercent,
      timeToExpiry,
      greeks,
      availableOpportunities
    );
    
    // Assess risk level
    const riskLevel = this.assessRiskLevel(unrealizedPnLPercent, timeToExpiry, moneyness);
    
    // Calculate break-even price for options
    let breakEvenPrice: number | undefined;
    if (isOptions && metadata) {
      breakEvenPrice = metadata.optionType === 'call'
        ? metadata.strike + metadata.entryPrice
        : metadata.strike - metadata.entryPrice;
    }
    
    return {
      id: position.id,
      ticker: position.ticker,
      positionType: position.positionType as 'options' | 'stock',
      currentPrice,
      entryPrice: position.avgCost,
      currentValue,
      unrealizedPnL,
      unrealizedPnLPercent,
      dayChange: position.realizedPnL || 0, // Real day P/L from Tastytrade
      dayChangePercent: position.realizedPnL && currentValue > 0 
        ? (position.realizedPnL / currentValue) * 100 
        : 0,
      quantity: position.quantity,
      totalCost,
      breakEvenPrice,
      greeks,
      timeToExpiry,
      impliedVolatility,
      moneyness,
      sentiment: this.calculateSentiment(unrealizedPnLPercent, timeToExpiry),
      confidence: this.calculateConfidence(greeks, timeToExpiry, moneyness),
      riskLevel,
      exitStrategy
    };
  }
  
  /**
   * Generate exit strategy recommendations based on position performance
   */
  private generateExitStrategy(
    position: PortfolioPosition,
    pnlPercent: number,
    timeToExpiry: number | undefined,
    greeks: Greeks | undefined,
    opportunities: TradeRecommendation[]
  ): PositionAnalysis['exitStrategy'] {
    const reasoning: string[] = [];
    let recommendation: 'HOLD' | 'TAKE_PROFIT' | 'CUT_LOSS' | 'MONITOR' = 'HOLD';
    let trimPercentage: number | undefined;
    
    // STOP LOSS: Recommend exit at -45% loss
    if (pnlPercent <= -45) {
      recommendation = 'CUT_LOSS';
      reasoning.push(`Position down ${Math.abs(pnlPercent).toFixed(1)}% - STOP LOSS triggered`);
      reasoning.push('Cut losses immediately to preserve capital');
    }
    // WARNING: Approaching stop loss at -40%
    else if (pnlPercent <= -40) {
      recommendation = 'MONITOR';
      reasoning.push(`Position down ${Math.abs(pnlPercent).toFixed(1)}% - approaching stop loss level`);
      reasoning.push('Monitor closely, consider cutting losses if downtrend continues');
    }
    // PARTIAL PROFIT-TAKING STRATEGY: Aggressive early profit capture
    // Take 50% at +35% ROI, close remaining 50% at +65% ROI
    else if (pnlPercent >= 65) {
      recommendation = 'TAKE_PROFIT';
      trimPercentage = 100; // Close entire remaining position
      reasoning.push(`Excellent ${pnlPercent.toFixed(1)}% gain - CLOSE ENTIRE POSITION`);
      reasoning.push('🎯 Target achieved: 65%+ ROI - take full profits and redeploy capital');
      reasoning.push('Already secured 50% at +35% ROI - lock in remaining 50% now');
    }
    // FIRST PROFIT LEVEL: Take half at 35%
    else if (pnlPercent >= 35) {
      recommendation = 'TAKE_PROFIT';
      trimPercentage = 50; // Trim half the position
      reasoning.push(`Strong ${pnlPercent.toFixed(1)}% gain - TRIM 50% OF POSITION`);
      reasoning.push('🎯 First profit target: Secure 50% gains at +35% ROI');
      reasoning.push('Hold remaining 50% for +65% ROI target to maximize returns');
    }
    // APPROACHING FIRST PROFIT TARGET: 25-35%
    else if (pnlPercent >= 25) {
      recommendation = 'MONITOR';
      reasoning.push(`Good ${pnlPercent.toFixed(1)}% gain - approaching first profit target`);
      reasoning.push('Prepare to trim 50% at +35% ROI level');
      reasoning.push('Watch for resistance levels and momentum signals');
    }
    
    // Time decay warning for options
    // Only override recommendation if we haven't already triggered profit-taking or stop loss
    if (timeToExpiry !== undefined) {
      if (timeToExpiry < 3 && pnlPercent < 50 && recommendation !== 'TAKE_PROFIT' && recommendation !== 'CUT_LOSS') {
        recommendation = 'MONITOR';
        reasoning.push(`Only ${timeToExpiry.toFixed(0)} days until expiry - theta decay accelerating`);
        if (pnlPercent < 0) {
          reasoning.push('Consider closing to avoid worthless expiration');
        }
      } else if (timeToExpiry < 7) {
        reasoning.push(`${timeToExpiry.toFixed(0)} days to expiry - monitor time decay closely`);
      }
    }
    
    // Greek-based warnings
    if (greeks) {
      if (greeks.delta < 0.3 && position.positionType === 'options') {
        reasoning.push('Low delta - position losing directional exposure');
      }
      if (greeks.theta < -50) {
        reasoning.push(`High theta decay ($${Math.abs(greeks.theta).toFixed(0)}/day) - time working against you`);
      }
    }
    
    // Check for better opportunities
    const betterOpp = this.findBetterOpportunity(position, pnlPercent, opportunities);
    if (betterOpp) {
      if (pnlPercent > -20) { // Only suggest reallocation if not in deep loss
        recommendation = 'MONITOR';
        reasoning.push(`Better ${betterOpp.projectedROI}% ROI opportunity available in ${betterOpp.ticker}`);
        reasoning.push(`Consider reallocating capital to higher-conviction trade`);
      }
    }
    
    // Default holding guidance
    if (reasoning.length === 0) {
      reasoning.push('Position within normal range - continue holding');
      reasoning.push('Monitor for +35% profit target (50% trim) or -45% stop loss');
    }
    
    // Set profit targets and stop loss
    const profitTarget = position.avgCost * 1.35; // 35% first target (50% trim), 65% full exit
    const stopLoss = position.avgCost * 0.55; // 45% loss
    const timeBasedExit = timeToExpiry 
      ? `${timeToExpiry.toFixed(0)} days to expiry`
      : 'No time-based exit';
    
    return {
      profitTarget,
      stopLoss,
      timeBasedExit,
      recommendation,
      reasoning,
      trimPercentage
    };
  }
  
  /**
   * Find better trade opportunities compared to current position
   */
  private findBetterOpportunity(
    position: PortfolioPosition,
    currentPnL: number,
    opportunities: TradeRecommendation[]
  ): TradeRecommendation | null {
    if (opportunities.length === 0) return null;
    
    // Don't suggest reallocation if position is already profitable (>20%)
    if (currentPnL > 20) return null;
    
    // Find opportunities with significantly better ROI projections
    const betterOpps = opportunities.filter(opp => {
      // Must be different symbol
      if (opp.ticker === position.ticker) return false;
      
      // Must have significantly better ROI (at least 100% more)
      const currentExpectedROI = 50; // Conservative estimate for current position
      if (opp.projectedROI < currentExpectedROI + 100) return false;
      
      // Must have high confidence (>80%)
      if (opp.aiConfidence < 80) return false;
      
      return true;
    });
    
    // Return best opportunity by score
    if (betterOpps.length > 0) {
      return betterOpps.sort((a, b) => b.score - a.score)[0];
    }
    
    return null;
  }
  
  /**
   * Assess risk level of position
   */
  private assessRiskLevel(
    pnlPercent: number,
    timeToExpiry?: number,
    moneyness?: 'ITM' | 'OTM' | 'ATM'
  ): 'LOW' | 'MEDIUM' | 'HIGH' {
    // High risk conditions
    if (pnlPercent < -30) return 'HIGH';
    if (timeToExpiry !== undefined && timeToExpiry < 5 && moneyness === 'OTM') return 'HIGH';
    if (timeToExpiry !== undefined && timeToExpiry < 3) return 'HIGH';
    
    // Medium risk conditions
    if (pnlPercent < -15) return 'MEDIUM';
    if (timeToExpiry !== undefined && timeToExpiry < 10) return 'MEDIUM';
    if (moneyness === 'OTM') return 'MEDIUM';
    
    // Low risk
    return 'LOW';
  }
  
  /**
   * Calculate sentiment based on position performance
   */
  private calculateSentiment(pnlPercent: number, timeToExpiry?: number): number {
    let sentiment = 0.5; // Neutral
    
    // Adjust for P&L
    if (pnlPercent > 100) sentiment = 0.95;
    else if (pnlPercent > 50) sentiment = 0.80;
    else if (pnlPercent > 20) sentiment = 0.65;
    else if (pnlPercent > 0) sentiment = 0.55;
    else if (pnlPercent > -20) sentiment = 0.40;
    else if (pnlPercent > -40) sentiment = 0.25;
    else sentiment = 0.10;
    
    // Adjust for time decay (if options)
    if (timeToExpiry !== undefined && timeToExpiry < 7) {
      sentiment *= 0.8; // Reduce sentiment as expiry approaches
    }
    
    return sentiment;
  }
  
  /**
   * Calculate confidence in position
   */
  private calculateConfidence(
    greeks?: Greeks,
    timeToExpiry?: number,
    moneyness?: 'ITM' | 'OTM' | 'ATM'
  ): number {
    let confidence = 0.7; // Base confidence
    
    if (greeks) {
      // Higher delta = more confidence
      if (greeks.delta > 0.7) confidence += 0.15;
      else if (greeks.delta < 0.3) confidence -= 0.20;
      
      // Lower theta decay = more confidence
      if (greeks.theta > -30) confidence += 0.10;
      else if (greeks.theta < -80) confidence -= 0.15;
    }
    
    if (timeToExpiry !== undefined) {
      // More time = more confidence
      if (timeToExpiry > 30) confidence += 0.10;
      else if (timeToExpiry < 7) confidence -= 0.20;
    }
    
    if (moneyness) {
      if (moneyness === 'ITM') confidence += 0.15;
      else if (moneyness === 'OTM') confidence -= 0.10;
    }
    
    return Math.max(0, Math.min(1, confidence)); // Clamp to 0-1
  }
  
  /**
   * Analyze entire portfolio and provide comprehensive recommendations
   */
  analyzePortfolio(
    positions: PortfolioPosition[],
    currentPrices: Map<string, number>,
    availableOpportunities: TradeRecommendation[] = []
  ): PortfolioAnalysis {
    const positionAnalyses: PositionAnalysis[] = positions
      .filter(p => p.status === 'open')
      .map(position => {
        const currentPrice = currentPrices.get(position.ticker) || position.avgCost;
        return this.analyzePosition(position, currentPrice, availableOpportunities);
      });
    
    // Calculate portfolio totals
    const totalCost = positionAnalyses.reduce((sum, p) => sum + p.totalCost, 0);
    const totalValue = positionAnalyses.reduce((sum, p) => sum + p.currentValue, 0);
    const totalPnL = totalValue - totalCost;
    const totalPnLPercent = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
    const dayChange = positionAnalyses.reduce((sum, p) => sum + p.dayChange, 0);
    
    // Calculate risk metrics
    const maxLoss = positionAnalyses.reduce((sum, p) => {
      return sum + (p.totalCost * 0.45); // Max 45% loss per position
    }, 0);
    
    // Portfolio concentration (largest position as % of total)
    const largestPosition = Math.max(...positionAnalyses.map(p => p.currentValue));
    const concentration = totalValue > 0 ? (largestPosition / totalValue) * 100 : 0;
    
    // Overall portfolio risk
    const highRiskCount = positionAnalyses.filter(p => p.riskLevel === 'HIGH').length;
    const mediumRiskCount = positionAnalyses.filter(p => p.riskLevel === 'MEDIUM').length;
    let portfolioRisk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    
    if (highRiskCount > 2 || highRiskCount / positionAnalyses.length > 0.3) {
      portfolioRisk = 'HIGH';
    } else if (highRiskCount > 0 || mediumRiskCount > positionAnalyses.length * 0.5) {
      portfolioRisk = 'MEDIUM';
    }
    
    // Generate portfolio-level recommendations
    const recommendations = this.generatePortfolioRecommendations(
      positionAnalyses,
      portfolioRisk,
      concentration,
      totalPnLPercent
    );
    
    // Calculate overall sentiment
    const overallSentiment = positionAnalyses.reduce((sum, p) => sum + p.sentiment, 0) / 
      (positionAnalyses.length || 1);
    
    return {
      totalValue,
      totalCost,
      totalPnL,
      totalPnLPercent,
      dayChange,
      positions: positionAnalyses,
      riskMetrics: {
        portfolioRisk,
        concentration,
        beta: 1.2, // Simplified
        maxLoss
      },
      recommendations,
      overallSentiment,
      riskLevel: portfolioRisk
    };
  }
  
  /**
   * Generate portfolio-level recommendations
   */
  private generatePortfolioRecommendations(
    positions: PositionAnalysis[],
    portfolioRisk: 'LOW' | 'MEDIUM' | 'HIGH',
    concentration: number,
    totalPnLPercent: number
  ): string[] {
    const recommendations: string[] = [];
    
    // Overall performance
    if (totalPnLPercent > 50) {
      recommendations.push(`🎯 Portfolio performing well at +${totalPnLPercent.toFixed(1)}% - consider trimming winners`);
    } else if (totalPnLPercent < -20) {
      recommendations.push(`⚠️ Portfolio down ${Math.abs(totalPnLPercent).toFixed(1)}% - review losing positions`);
    }
    
    // Risk warnings
    if (portfolioRisk === 'HIGH') {
      recommendations.push('🔴 High portfolio risk detected - consider reducing exposure in high-risk positions');
    }
    
    // Concentration warnings
    if (concentration > 40) {
      recommendations.push(`⚠️ Portfolio concentrated (${concentration.toFixed(0)}% in one position) - diversify to reduce risk`);
    }
    
    // Position-specific
    const stopLossPositions = positions.filter(p => p.exitStrategy.recommendation === 'CUT_LOSS');
    if (stopLossPositions.length > 0) {
      recommendations.push(`🛑 ${stopLossPositions.length} position(s) at stop loss level - immediate action needed`);
    }
    
    const profitPositions = positions.filter(p => p.exitStrategy.recommendation === 'TAKE_PROFIT');
    if (profitPositions.length > 0) {
      recommendations.push(`💰 ${profitPositions.length} position(s) ready for profit-taking - trim to secure gains`);
    }
    
    const expiringOptions = positions.filter(p => 
      p.positionType === 'options' && p.timeToExpiry !== undefined && p.timeToExpiry < 7
    );
    if (expiringOptions.length > 0) {
      recommendations.push(`⏰ ${expiringOptions.length} option(s) expiring within 7 days - monitor theta decay`);
    }
    
    if (recommendations.length === 0) {
      recommendations.push('✅ Portfolio within normal parameters - continue monitoring positions');
    }
    
    return recommendations;
  }
}

export const exitAnalysisService = new ExitAnalysisService();
