import type { PortfolioPosition, TradeRecommendation } from '@shared/schema';
import { ExitAnalysisService } from './exitAnalysis';
import { grokAI, type GrokEnhancement } from './grokAIService';

/**
 * Hybrid AI Analysis Engine (Internal + Grok)
 * 
 * Compiles all existing trading algorithms into a unified recommendation system:
 * - RSI (14-period smoothed) for momentum analysis
 * - VIX volatility analysis for market conditions
 * - Fibonacci retracement (0.618/0.707) for entry/exit validation
 * - Black-Scholes Greeks for options risk management
 * - Exit strategy rules (45% stop loss, 100%+ profit-taking)
 * - 24-hour trade holding and fund settlement constraints
 * 
 * Goal: Grow account from $1,847.60 to $1 million using precision-guided strategy
 */
export class PortfolioAnalysisEngine {
  private exitAnalysisService: ExitAnalysisService;
  
  constructor() {
    this.exitAnalysisService = new ExitAnalysisService();
  }

  /**
   * Analyze entire portfolio and generate AI-powered recommendations
   */
  async analyzePortfolio(
    positions: PortfolioPosition[],
    currentPrices: Record<string, number>,
    dashboardOpportunities: TradeRecommendation[],
    accountValue: number,
    vixLevel: number
  ): Promise<AIPortfolioAnalysis> {
    
    // Analyze each position using exit analysis service
    const positionAnalyses = positions.map(position => {
      const currentPrice = currentPrices[position.ticker] || position.currentPrice || position.avgCost;
      return this.exitAnalysisService.analyzePosition(
        position,
        currentPrice,
        dashboardOpportunities
      );
    });

    // Calculate overall portfolio metrics
    const totalUnrealizedPnL = positionAnalyses.reduce((sum, p) => sum + p.unrealizedPnL, 0);
    const totalCost = positionAnalyses.reduce((sum, p) => sum + p.totalCost, 0);
    const portfolioPnLPercent = totalCost > 0 ? (totalUnrealizedPnL / totalCost) * 100 : 0;

    // Assess market conditions using VIX
    const marketCondition = this.assessMarketCondition(vixLevel);

    // Generate strategic recommendations
    const recommendations = this.generateStrategicRecommendations(
      positionAnalyses,
      dashboardOpportunities,
      accountValue,
      vixLevel,
      marketCondition
    );

    // Calculate progress towards $1M goal
    const goalProgress = this.calculateGoalProgress(accountValue);

    // Determine overall risk level
    const overallRisk = this.calculateOverallRisk(positionAnalyses, portfolioPnLPercent);

    // Generate actionable insights
    const actionableInsights = this.generateActionableInsights(
      positionAnalyses,
      dashboardOpportunities,
      accountValue,
      marketCondition
    );

    // Base analysis from internal AI
    const baseAnalysis: AIPortfolioAnalysis = {
      timestamp: new Date().toISOString(),
      accountValue,
      totalUnrealizedPnL,
      portfolioPnLPercent,
      positionsCount: positions.length,
      riskLevel: overallRisk,
      marketCondition,
      vixLevel,
      goalProgress,
      recommendations,
      actionableInsights,
      positionAnalyses,
      grokEnhancement: null
    };

    // Enhance with Grok AI when:
    // 1. Risk level is HIGH or CRITICAL
    // 2. Have urgent exit recommendations
    // 3. Major rebalancing decisions needed
    const needsGrokEnhancement = 
      overallRisk === 'HIGH' || 
      overallRisk === 'CRITICAL' ||
      recommendations.some(r => r.urgency === 'HIGH' && r.type === 'EXIT_POSITION') ||
      recommendations.some(r => r.type === 'REBALANCE');

    if (needsGrokEnhancement) {
      console.log('🤖 Consulting Grok AI for portfolio enhancement...');
      const grokEnhancement = await grokAI.enhancePortfolioAnalysis(
        baseAnalysis,
        positions,
        dashboardOpportunities
      );
      
      if (grokEnhancement) {
        baseAnalysis.grokEnhancement = grokEnhancement;
        console.log(`✅ Grok AI enhanced analysis (confidence: ${(grokEnhancement.confidence * 100).toFixed(0)}%)`);
      }
    }

    return baseAnalysis;
  }

  /**
   * Assess market conditions using VIX levels
   */
  private assessMarketCondition(vix: number): MarketCondition {
    if (vix < 12) return { level: 'VERY_LOW_VOLATILITY', description: 'Extremely calm markets - consider selling premium' };
    if (vix < 15) return { level: 'LOW_VOLATILITY', description: 'Calm markets - favorable for directional trades' };
    if (vix < 20) return { level: 'NORMAL', description: 'Normal volatility - standard trading conditions' };
    if (vix < 25) return { level: 'ELEVATED', description: 'Elevated volatility - tighten stops, reduce position sizes' };
    if (vix < 30) return { level: 'HIGH_VOLATILITY', description: 'High volatility - defensive positioning recommended' };
    return { level: 'EXTREME_VOLATILITY', description: 'Extreme volatility - preserve capital, avoid new positions' };
  }

  /**
   * Generate strategic recommendations based on comprehensive analysis
   * 
   * Constraints:
   * - 24-hour hold requirement: Cannot close positions opened today (day trade rule)
   * - 24-hour settlement period: Funds from closed positions unavailable for 24h
   * - Max $2000 per SPX trade, $1000 per other trades
   */
  private generateStrategicRecommendations(
    positionAnalyses: any[],
    opportunities: TradeRecommendation[],
    accountValue: number,
    vix: number,
    marketCondition: MarketCondition
  ): StrategicRecommendation[] {
    const recs: StrategicRecommendation[] = [];
    const now = new Date();

    // 1. Analyze positions requiring immediate action (stop loss)
    const urgentExits = positionAnalyses.filter(p => 
      p.exitStrategy.recommendation === 'CUT_LOSS' || 
      p.unrealizedPnLPercent <= -40
    );

    if (urgentExits.length > 0) {
      urgentExits.forEach(pos => {
        // Check 24-hour hold requirement
        const position = pos as any; // Get access to openDate
        const openDate = position.openDate ? new Date(position.openDate) : null;
        const hoursSinceOpen = openDate ? (now.getTime() - openDate.getTime()) / (1000 * 60 * 60) : 24;
        const canClose = hoursSinceOpen >= 24;

        const reasoning = [
          `Position down ${Math.abs(pos.unrealizedPnLPercent).toFixed(1)}% - stop loss triggered`,
          canClose 
            ? 'Immediate exit required to preserve capital'
            : `⚠️ Day trade rule: Must hold ${(24 - hoursSinceOpen).toFixed(1)} more hours before closing`,
          `Current loss: $${Math.abs(pos.unrealizedPnL).toFixed(2)}`
        ];

        if (!canClose) {
          reasoning.push('Prepare to exit immediately once 24-hour period expires');
        }

        recs.push({
          type: 'EXIT_POSITION',
          ticker: pos.ticker,
          urgency: 'HIGH',
          action: 'CLOSE',
          canExecuteNow: canClose,
          reasoning,
          expectedImpact: {
            capitalFreed: pos.currentValue,
            pnlRealized: pos.unrealizedPnL
          }
        });
      });
    }

    // 2. Identify profit-taking opportunities
    const profitTakers = positionAnalyses.filter(p => 
      p.exitStrategy.recommendation === 'TAKE_PROFIT' && 
      p.unrealizedPnLPercent >= 100
    );

    if (profitTakers.length > 0) {
      profitTakers.forEach(pos => {
        const trimPercent = pos.unrealizedPnLPercent >= 200 ? 50 : 
                           pos.unrealizedPnLPercent >= 150 ? 30 : 25;
        
        recs.push({
          type: 'TAKE_PROFIT',
          ticker: pos.ticker,
          urgency: 'MEDIUM',
          action: 'TRIM',
          trimPercentage: trimPercent,
          reasoning: [
            `Excellent ${pos.unrealizedPnLPercent.toFixed(1)}% gain - time to secure profits`,
            `Trim ${trimPercent}% of position, let remainder run`,
            `Profit to be locked in: $${(pos.unrealizedPnL * trimPercent / 100).toFixed(2)}`
          ],
          expectedImpact: {
            capitalFreed: pos.currentValue * (trimPercent / 100),
            pnlRealized: pos.unrealizedPnL * (trimPercent / 100)
          }
        });
      });
    }

    // 3. Compare with dashboard opportunities for reallocation
    const moderatePositions = positionAnalyses.filter(p => 
      p.unrealizedPnLPercent > -20 && 
      p.unrealizedPnLPercent < 50 &&
      p.exitStrategy.recommendation === 'MONITOR'
    );

    moderatePositions.forEach(pos => {
      const betterOpps = opportunities.filter(opp => 
        opp.ticker !== pos.ticker &&
        opp.projectedROI > 150 &&
        opp.aiConfidence >= 85
      );

      if (betterOpps.length > 0) {
        const bestOpp = betterOpps.sort((a, b) => b.score - a.score)[0];
        
        recs.push({
          type: 'REBALANCE',
          ticker: pos.ticker,
          urgency: 'LOW',
          action: 'REALLOCATE',
          targetTicker: bestOpp.ticker,
          reasoning: [
            `Current position: ${pos.unrealizedPnLPercent.toFixed(1)}% P&L`,
            `Better opportunity: ${bestOpp.ticker} with ${bestOpp.projectedROI}% projected ROI`,
            `AI Confidence: ${bestOpp.aiConfidence}% vs current position momentum`,
            'Consider reallocation to optimize capital efficiency'
          ],
          expectedImpact: {
            capitalFreed: pos.currentValue,
            pnlRealized: pos.unrealizedPnL,
            newOpportunityROI: bestOpp.projectedROI
          }
        });
      }
    });

    // 4. Suggest new positions if capital available and market favorable
    const holdingPositions = positionAnalyses.filter(p => p.exitStrategy.recommendation === 'HOLD');
    const availableCapital = accountValue * 0.25; // Max 25% per position

    if (vix < 25 && opportunities.length > 0 && availableCapital > 500) {
      const topOpps = opportunities
        .filter(opp => opp.aiConfidence >= 85 && opp.projectedROI >= 150)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

      topOpps.forEach(opp => {
        recs.push({
          type: 'NEW_POSITION',
          ticker: opp.ticker,
          urgency: 'LOW',
          action: 'ENTER',
          reasoning: [
            `High-conviction opportunity: ${opp.projectedROI}% projected ROI`,
            `AI Confidence: ${opp.aiConfidence}%`,
            `VIX at ${vix.toFixed(2)} - favorable entry conditions`,
            opp.fibonacciLevel ? `Fibonacci ${opp.fibonacciLevel} bounce confirmed` : ''
          ].filter(Boolean),
          expectedImpact: {
            capitalRequired: Math.min(opp.premium * 100, availableCapital),
            potentialROI: opp.projectedROI
          }
        });
      });
    }

    // Sort by urgency
    return recs.sort((a, b) => {
      const urgencyMap = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      return urgencyMap[b.urgency] - urgencyMap[a.urgency];
    });
  }

  /**
   * Calculate progress towards $1M goal
   */
  private calculateGoalProgress(currentValue: number): GoalProgress {
    const startingValue = 1847.60;
    const targetValue = 1000000;
    
    const progressPercent = ((currentValue - startingValue) / (targetValue - startingValue)) * 100;
    const growthPercent = ((currentValue - startingValue) / startingValue) * 100;
    const remaining = targetValue - currentValue;
    
    // Calculate required growth rate
    const requiredMultiplier = targetValue / currentValue;
    
    return {
      current: currentValue,
      target: targetValue,
      progressPercent: Math.max(0, progressPercent),
      growthPercent,
      remaining,
      requiredMultiplier: requiredMultiplier.toFixed(2) + 'x',
      onTrack: growthPercent > 0
    };
  }

  /**
   * Calculate overall portfolio risk level
   */
  private calculateOverallRisk(
    positionAnalyses: any[],
    portfolioPnL: number
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const highRiskCount = positionAnalyses.filter(p => p.riskLevel === 'HIGH').length;
    const avgRisk = positionAnalyses.length > 0 
      ? positionAnalyses.filter(p => p.riskLevel === 'HIGH').length / positionAnalyses.length
      : 0;

    if (portfolioPnL < -30 || highRiskCount >= 2) return 'CRITICAL';
    if (portfolioPnL < -15 || avgRisk > 0.5) return 'HIGH';
    if (portfolioPnL < 0 || highRiskCount > 0) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Generate actionable insights for the user
   */
  private generateActionableInsights(
    positionAnalyses: any[],
    opportunities: TradeRecommendation[],
    accountValue: number,
    marketCondition: MarketCondition
  ): ActionableInsight[] {
    const insights: ActionableInsight[] = [];

    // Portfolio health insight
    const totalPnL = positionAnalyses.reduce((sum, p) => sum + p.unrealizedPnL, 0);
    if (totalPnL > 0) {
      insights.push({
        category: 'PORTFOLIO_HEALTH',
        priority: 'MEDIUM',
        message: `Portfolio up $${totalPnL.toFixed(2)} - maintain disciplined profit-taking`,
        action: 'Review positions at 100%+ gains for partial exits'
      });
    } else {
      insights.push({
        category: 'PORTFOLIO_HEALTH',
        priority: 'HIGH',
        message: `Portfolio down $${Math.abs(totalPnL).toFixed(2)} - risk management critical`,
        action: 'Review stop losses and consider defensive positioning'
      });
    }

    // Market condition insight
    if (marketCondition.level === 'HIGH_VOLATILITY' || marketCondition.level === 'EXTREME_VOLATILITY') {
      insights.push({
        category: 'MARKET_CONDITIONS',
        priority: 'HIGH',
        message: marketCondition.description,
        action: 'Reduce position sizes and tighten stop losses'
      });
    }

    // Opportunity insight
    const highConfidenceOpps = opportunities.filter(o => o.aiConfidence >= 90);
    if (highConfidenceOpps.length > 0) {
      insights.push({
        category: 'OPPORTUNITIES',
        priority: 'MEDIUM',
        message: `${highConfidenceOpps.length} high-confidence opportunities available`,
        action: `Review ${highConfidenceOpps[0].ticker} - ${highConfidenceOpps[0].projectedROI}% projected ROI`
      });
    }

    // Time decay warning
    const expiringPositions = positionAnalyses.filter(p => 
      p.timeToExpiry !== undefined && p.timeToExpiry < 5
    );
    if (expiringPositions.length > 0) {
      insights.push({
        category: 'RISK_MANAGEMENT',
        priority: 'HIGH',
        message: `${expiringPositions.length} positions expiring within 5 days`,
        action: 'Take action on options nearing expiration to avoid theta decay'
      });
    }

    return insights;
  }
}

// Type definitions
export interface AIPortfolioAnalysis {
  timestamp: string;
  accountValue: number;
  totalUnrealizedPnL: number;
  portfolioPnLPercent: number;
  positionsCount: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  marketCondition: MarketCondition;
  vixLevel: number;
  goalProgress: GoalProgress;
  recommendations: StrategicRecommendation[];
  actionableInsights: ActionableInsight[];
  positionAnalyses: any[];
  grokEnhancement: GrokEnhancement | null;
}

interface MarketCondition {
  level: 'VERY_LOW_VOLATILITY' | 'LOW_VOLATILITY' | 'NORMAL' | 'ELEVATED' | 'HIGH_VOLATILITY' | 'EXTREME_VOLATILITY';
  description: string;
}

interface GoalProgress {
  current: number;
  target: number;
  progressPercent: number;
  growthPercent: number;
  remaining: number;
  requiredMultiplier: string;
  onTrack: boolean;
}

export interface StrategicRecommendation {
  type: 'EXIT_POSITION' | 'TAKE_PROFIT' | 'REBALANCE' | 'NEW_POSITION';
  ticker: string;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  action: 'CLOSE' | 'TRIM' | 'REALLOCATE' | 'ENTER';
  canExecuteNow?: boolean; // 24-hour hold/settlement constraint
  trimPercentage?: number;
  targetTicker?: string;
  reasoning: string[];
  expectedImpact: {
    capitalFreed?: number;
    capitalRequired?: number;
    pnlRealized?: number;
    potentialROI?: number;
    newOpportunityROI?: number;
  };
}

interface ActionableInsight {
  category: 'PORTFOLIO_HEALTH' | 'MARKET_CONDITIONS' | 'OPPORTUNITIES' | 'RISK_MANAGEMENT';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
  action: string;
}
