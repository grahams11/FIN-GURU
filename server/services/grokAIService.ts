import OpenAI from "openai";
import type { AIPortfolioAnalysis, StrategicRecommendation } from './portfolioAnalysisEngine';
import type { PortfolioPosition, TradeRecommendation } from '@shared/schema';

/**
 * Grok AI Service
 * 
 * Enhances internal AI engine with advanced reasoning from xAI's Grok
 * 
 * Use Cases:
 * 1. Fallback: When internal AI confidence is low (<70%), consult Grok
 * 2. Enhancement: Enrich recommendations with Grok's market insights
 * 3. Validation: Cross-check high-risk decisions with Grok's reasoning
 * 4. Learning: Train internal AI by analyzing Grok's logic patterns
 */
export class GrokAIService {
  private client: OpenAI | null = null;
  private model: string = "grok-2-1212"; // 131K context window
  private enabled: boolean;
  
  constructor() {
    // Initialize Grok client with xAI API
    this.enabled = !!process.env.XAI_API_KEY;
    
    if (this.enabled) {
      this.client = new OpenAI({
        baseURL: "https://api.x.ai/v1",
        apiKey: process.env.XAI_API_KEY
      });
      console.log('✅ Grok AI Service initialized - fallback and enhancement enabled');
    } else {
      console.warn('⚠️ Grok AI Service disabled - XAI_API_KEY not found');
    }
  }
  
  /**
   * Enhance portfolio analysis with Grok's reasoning
   * Called when internal AI needs guidance on complex decisions
   */
  async enhancePortfolioAnalysis(
    analysis: AIPortfolioAnalysis,
    positions: PortfolioPosition[],
    opportunities: TradeRecommendation[]
  ): Promise<GrokEnhancement | null> {
    if (!this.enabled || !this.client) return null;
    
    try {
      // Prepare context for Grok
      const context = this.buildAnalysisContext(analysis, positions, opportunities);
      
      // Query Grok for strategic insights
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: this.getSystemPrompt()
          },
          {
            role: "user",
            content: context
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 2000
      });
      
      const grokResponse = JSON.parse(response.choices[0].message.content || '{}');
      
      return {
        enhancedRecommendations: grokResponse.recommendations || [],
        riskAssessment: grokResponse.riskAssessment || {},
        marketInsights: grokResponse.marketInsights || '',
        confidence: grokResponse.confidence || 0.5,
        reasoning: grokResponse.reasoning || []
      };
      
    } catch (error) {
      console.error('❌ Grok AI enhancement failed:', error);
      return null;
    }
  }
  
  /**
   * Validate a high-risk decision with Grok's reasoning
   * Used before executing stop losses or major rebalances
   */
  async validateHighRiskDecision(
    decision: StrategicRecommendation,
    position: PortfolioPosition,
    accountValue: number
  ): Promise<GrokValidation | null> {
    if (!this.enabled || !this.client) return null;
    
    try {
      const prompt = `
You are a professional options trader analyzing a HIGH-RISK decision.

ACCOUNT STATUS:
- Total Value: $${accountValue.toFixed(2)}
- Goal: Grow to $1,000,000
- Current Progress: ${((accountValue / 1000000) * 100).toFixed(2)}%

POSITION AT RISK:
- Ticker: ${position.ticker}
- Type: ${position.positionType}
- Entry: $${position.avgCost.toFixed(2)}
- Quantity: ${position.quantity}
- P&L: ${position.currentPrice ? ((position.currentPrice - position.avgCost) / position.avgCost * 100).toFixed(1) : 'N/A'}%

PROPOSED ACTION:
- Type: ${decision.type}
- Action: ${decision.action}
- Urgency: ${decision.urgency}
- Reasoning: ${decision.reasoning.join('; ')}

VALIDATE THIS DECISION:
1. Is this the right move given the $1M goal?
2. Are there better alternatives?
3. What are the risks of executing vs. holding?

Respond with JSON:
{
  "approved": boolean,
  "confidence": 0-1,
  "alternativeAction": "string or null",
  "risks": ["risk1", "risk2"],
  "reasoning": ["point1", "point2"]
}`;

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are an expert options trader with 20 years of experience. Validate trading decisions with precision and risk awareness."
          },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3, // Lower temp for validation
        max_tokens: 1000
      });
      
      return JSON.parse(response.choices[0].message.content || '{}');
      
    } catch (error) {
      console.error('❌ Grok validation failed:', error);
      return null;
    }
  }
  
  /**
   * Analyze why internal AI confidence is low and suggest improvements
   * Learning mode: Help train the internal AI
   */
  async analyzeConfidenceGap(
    recommendation: TradeRecommendation,
    marketData: any
  ): Promise<GrokLearning | null> {
    if (!this.enabled || !this.client) return null;
    
    try {
      const prompt = `
INTERNAL AI GENERATED THIS TRADE:
- Ticker: ${recommendation.ticker}
- Type: ${recommendation.optionType}
- Strike: $${recommendation.strikePrice}
- ROI Projection: ${recommendation.projectedROI}%
- AI Confidence: ${(recommendation.aiConfidence * 100).toFixed(0)}%

MARKET CONTEXT:
- VIX: ${marketData.vix || 'N/A'}
- SPX Change: ${marketData.sp500?.changePercent || 0}%
- Sentiment: ${recommendation.sentiment}

WHY IS CONFIDENCE LOW (<85%)?
Analyze what factors the internal AI might be missing:
1. Missing technical indicators?
2. Market conditions unclear?
3. Risk factors underweighted?
4. Better entry/exit timing available?

Respond with JSON:
{
  "missingFactors": ["factor1", "factor2"],
  "suggestedImprovements": ["improvement1", "improvement2"],
  "confidenceBoost": 0-0.3,
  "reasoning": ["reason1", "reason2"]
}`;

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are an AI training expert helping improve trading algorithms. Identify gaps and suggest enhancements."
          },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.5,
        max_tokens: 800
      });
      
      return JSON.parse(response.choices[0].message.content || '{}');
      
    } catch (error) {
      console.error('❌ Grok learning analysis failed:', error);
      return null;
    }
  }
  
  /**
   * Get real-time market sentiment from Grok
   * Grok has access to X (Twitter) data for sentiment analysis
   */
  async getMarketSentiment(ticker: string): Promise<GrokSentiment | null> {
    if (!this.enabled || !this.client) return null;
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You analyze market sentiment using social media, news, and trading patterns. Provide concise, actionable sentiment scores."
          },
          {
            role: "user",
            content: `What is the current market sentiment for ${ticker}? Consider social media buzz, recent news, and trader positioning. Respond with JSON: { "sentiment": 0-1, "confidence": 0-1, "summary": "brief explanation" }`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 300
      });
      
      return JSON.parse(response.choices[0].message.content || '{}');
      
    } catch (error) {
      console.error(`❌ Grok sentiment analysis failed for ${ticker}:`, error);
      return null;
    }
  }
  
  // --- PRIVATE HELPERS ---
  
  private getSystemPrompt(): string {
    return `You are Grok, an elite options trading AI assistant integrated into "The 1 App" trading system.

YOUR ROLE:
- Enhance internal AI recommendations with advanced reasoning
- Identify gaps the internal AI might have missed
- Provide strategic insights for growing $1,847 to $1,000,000
- Focus on risk management and capital preservation

TRADING RULES YOU MUST RESPECT:
- 24-hour hold requirement (no day trading)
- 24-hour settlement period (funds unavailable after closing)
- Max $2000 per SPX trade, $1000 per other trades
- 45% stop loss threshold
- 100%+ ROI targets for profit-taking
- Fibonacci (0.618/0.707) validation preferred

ANALYSIS FRAMEWORK:
1. VIX + RSI momentum signals
2. Black-Scholes Greeks for options risk
3. Exit strategy optimization
4. Market condition assessment
5. Goal progress tracking ($1M target)

Provide JSON responses with clear reasoning, risk assessments, and actionable recommendations.`;
  }
  
  private buildAnalysisContext(
    analysis: AIPortfolioAnalysis,
    positions: PortfolioPosition[],
    opportunities: TradeRecommendation[]
  ): string {
    return `
PORTFOLIO STATUS:
- Account Value: $${analysis.accountValue.toFixed(2)}
- Unrealized P&L: $${analysis.totalUnrealizedPnL.toFixed(2)} (${analysis.portfolioPnLPercent.toFixed(1)}%)
- Open Positions: ${analysis.positionsCount}
- Risk Level: ${analysis.riskLevel}
- Goal Progress: ${analysis.goalProgress.progressPercent.toFixed(2)}% to $1M

MARKET CONDITIONS:
- VIX: ${analysis.vixLevel.toFixed(2)}
- Condition: ${analysis.marketCondition.level}
- Description: ${analysis.marketCondition.description}

CURRENT POSITIONS:
${positions.map(p => `- ${p.ticker}: ${p.quantity} ${p.positionType} @ $${p.avgCost.toFixed(2)}`).join('\n')}

INTERNAL AI RECOMMENDATIONS:
${analysis.recommendations.map((r, i) => `
${i + 1}. ${r.type} - ${r.ticker}
   Action: ${r.action}
   Urgency: ${r.urgency}
   Reasoning: ${r.reasoning.join('; ')}
   Can Execute Now: ${r.canExecuteNow !== false ? 'Yes' : 'No (24h rule)'}
`).join('\n')}

AVAILABLE OPPORTUNITIES:
${opportunities.slice(0, 3).map(opp => `
- ${opp.ticker} ${opp.optionType.toUpperCase()}: ${opp.projectedROI}% ROI, ${(opp.aiConfidence * 100).toFixed(0)}% confidence
`).join('\n')}

ENHANCE THIS ANALYSIS:
1. Validate internal AI recommendations
2. Identify any missed opportunities or risks
3. Suggest strategic adjustments for $1M goal
4. Provide risk assessment and confidence scores

Respond with JSON:
{
  "recommendations": [{"action": "string", "reasoning": "string", "priority": "HIGH|MEDIUM|LOW"}],
  "riskAssessment": {"level": "CRITICAL|HIGH|MEDIUM|LOW", "concerns": ["concern1"]},
  "marketInsights": "Overall market analysis",
  "confidence": 0-1,
  "reasoning": ["point1", "point2"]
}`;
  }
}

// Type Definitions
export interface GrokEnhancement {
  enhancedRecommendations: Array<{
    action: string;
    reasoning: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
  }>;
  riskAssessment: {
    level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    concerns: string[];
  };
  marketInsights: string;
  confidence: number;
  reasoning: string[];
}

export interface GrokValidation {
  approved: boolean;
  confidence: number;
  alternativeAction: string | null;
  risks: string[];
  reasoning: string[];
}

export interface GrokLearning {
  missingFactors: string[];
  suggestedImprovements: string[];
  confidenceBoost: number;
  reasoning: string[];
}

export interface GrokSentiment {
  sentiment: number;
  confidence: number;
  summary: string;
}

// Singleton instance
export const grokAI = new GrokAIService();
