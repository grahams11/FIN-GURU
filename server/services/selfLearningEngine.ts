import { learningStorage } from "../storage";
import { learningAnalyticsService } from "./learningAnalyticsService";
import { insightLifecycleService } from "./insightLifecycleService";
import { tradeOutcomeRepository } from "./tradeOutcomeRepository";
import { grokAI } from "./grokAIService";
import type { LearningSession, RecommendationTracking, RecommendationPerformance } from "@shared/schema";

/**
 * SelfLearningEngine
 * Main orchestrator for AI learning loop:
 * 1. Fetch recent trade outcomes
 * 2. Compute performance metrics via LearningAnalyticsService
 * 3. Call Grok to analyze patterns and anomalies
 * 4. Persist new insights and parameter updates
 * 5. Enqueue follow-up learning sessions
 */
export class SelfLearningEngine {
  private isRunning = false;
  
  /**
   * Run a full learning session
   */
  async runLearningSession(sessionType: 'outcome_analysis' | 'pattern_discovery' | 'parameter_optimization' = 'outcome_analysis'): Promise<LearningSession | null> {
    if (this.isRunning) {
      console.log('[SelfLearning] Learning session already in progress, skipping');
      return null;
    }
    
    this.isRunning = true;
    
    try {
      // Create learning session record
      const session = await learningStorage.createLearningSession({
        sessionType,
        analysisPeriod: {
          startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          endDate: new Date()
        },
        tradesAnalyzed: 0,
        status: 'running'
      });
      
      console.log(`[SelfLearning] Starting ${sessionType} session ${session.id}`);
      
      try {
        // Step 1: Fetch recent trade outcomes
        const recentOutcomes = await tradeOutcomeRepository.getRecentOutcomes(30);
        console.log(`[SelfLearning] Fetched ${recentOutcomes.length} recent trade outcomes`);
        
        // Step 2: Refresh performance metrics
        await learningAnalyticsService.refreshAllMetrics();
        console.log('[SelfLearning] Performance metrics refreshed');
        
        // Step 3: Evaluate existing insights
        const { warned, deactivated } = await insightLifecycleService.evaluateInsights();
        console.log(`[SelfLearning] Evaluated insights: ${warned.length} warned, ${deactivated.length} deactivated`);
        
        // Step 4: Analyze patterns with Grok (to be implemented)
        const grokFindings = await this.analyzeWithGrok(recentOutcomes, sessionType);
        
        // Step 5: Persist new insights discovered by Grok
        const insightsGenerated = await this.persistGrokInsights(grokFindings);
        
        // Complete session
        const completedSession = await learningStorage.completeLearningSession(session.id, {
          tradesAnalyzed: recentOutcomes.length,
          insightsGenerated,
          summary: {
            findings: grokFindings.findings,
            recommendations: grokFindings.recommendations,
            metricsRefreshed: true,
            insightsEvaluated: warned.length + deactivated.length
          },
          grokReasoning: grokFindings.reasoning
        });
        
        console.log(`[SelfLearning] Session ${session.id} completed successfully`);
        return completedSession || null;
        
      } catch (error) {
        // Mark session as failed
        await learningStorage.completeLearningSession(session.id, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
      }
      
    } finally {
      this.isRunning = false;
    }
  }
  
  /**
   * Analyze trade outcomes using Grok AI
   * Returns insights and recommendations
   */
  private async analyzeWithGrok(
    outcomes: Array<RecommendationTracking & { performance?: RecommendationPerformance }>,
    sessionType: string
  ): Promise<{
    findings: string[];
    recommendations: string[];
    reasoning: string;
    patterns: Array<{
      pattern: string;
      conditions: Record<string, any>;
      winRate: number;
      sampleSize: number;
      confidence: number;
    }>;
  }> {
    console.log(`[SelfLearning] Analyzing ${outcomes.length} outcomes with Grok`);
    
    // Prepare context for Grok
    const closedTrades = outcomes.filter(o => o.performance?.closedAt);
    
    // Guard against empty trades array
    if (closedTrades.length === 0) {
      console.log('[SelfLearning] No closed trades available for analysis');
      return this.basicPatternAnalysis(closedTrades);
    }
    
    const wins = closedTrades.filter(t => t.performance?.isWin);
    const losses = closedTrades.filter(t => t.performance?.isLoss);
    const winRate = (wins.length / closedTrades.length) * 100;
    
    // Calculate average metrics (safe now with guard above)
    const avgROI = closedTrades.reduce((sum, t) => sum + (t.performance?.actualROI || 0), 0) / closedTrades.length;
    const avgRSI = closedTrades.reduce((sum, t) => sum + t.rsi, 0) / closedTrades.length;
    const avgVIX = closedTrades.reduce((sum, t) => sum + t.vix, 0) / closedTrades.length;
    
    const prompt = `
You are analyzing ${closedTrades.length} completed options trades to discover patterns and improve trading strategy.

PERFORMANCE SUMMARY:
- Win Rate: ${winRate.toFixed(1)}%
- Winners: ${wins.length} trades
- Losers: ${losses.length} trades
- Average ROI: ${avgROI.toFixed(1)}%
- Average RSI: ${avgRSI.toFixed(1)}
- Average VIX: ${avgVIX.toFixed(1)}

SESSION TYPE: ${sessionType}

SAMPLE WINNING TRADES:
${wins.slice(0, 5).map(t => `
- ${t.ticker} ${t.optionType.toUpperCase()}: Entry RSI ${t.rsi.toFixed(1)}, VIX ${t.vix.toFixed(1)}, Delta ${t.delta?.toFixed(2)}, ROI ${t.performance?.actualROI?.toFixed(1)}%
`).join('')}

SAMPLE LOSING TRADES:
${losses.slice(0, 5).map(t => `
- ${t.ticker} ${t.optionType.toUpperCase()}: Entry RSI ${t.rsi.toFixed(1)}, VIX ${t.vix.toFixed(1)}, Delta ${t.delta?.toFixed(2)}, ROI ${t.performance?.actualROI?.toFixed(1)}%
`).join('')}

ANALYZE AND DISCOVER:
1. What patterns distinguish winners from losers?
2. Are there specific RSI/VIX combinations that work better?
3. Should we adjust delta ranges, entry criteria, or exit rules?
4. Any market regime patterns (bull vs bear)?

Respond with JSON:
{
  "findings": ["finding1", "finding2", "finding3"],
  "recommendations": ["recommendation1", "recommendation2"],
  "reasoning": "detailed reasoning about what you discovered",
  "patterns": [
    {
      "pattern": "Human-readable description",
      "conditions": {"rsi": "<30", "vix": ">20", "optionType": "call"},
      "winRate": 75.5,
      "sampleSize": 20,
      "confidence": 0.8
    }
  ]
}`;

    try {
      // Call Grok if available
      if (!grokAI || !(grokAI as any).enabled) {
        console.log('[SelfLearning] Grok AI not available, using basic analysis');
        return this.basicPatternAnalysis(closedTrades);
      }

      const response = await (grokAI as any).client.chat.completions.create({
        model: (grokAI as any).model,
        messages: [
          {
            role: "system",
            content: "You are an expert quantitative analyst specializing in options trading strategy optimization. Identify statistically significant patterns and provide actionable insights."
          },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.5,
        max_tokens: 2000
      });
      
      const grokResponse = JSON.parse(response.choices[0].message.content || '{}');
      console.log(`[SelfLearning] Grok discovered ${grokResponse.patterns?.length || 0} patterns`);
      
      return {
        findings: grokResponse.findings || [],
        recommendations: grokResponse.recommendations || [],
        reasoning: grokResponse.reasoning || 'No detailed reasoning provided',
        patterns: grokResponse.patterns || []
      };
      
    } catch (error) {
      console.error('[SelfLearning] Grok analysis failed:', error);
      return this.basicPatternAnalysis(closedTrades);
    }
  }
  
  /**
   * Fallback: Basic pattern analysis without Grok
   */
  private basicPatternAnalysis(
    closedTrades: Array<RecommendationTracking & { performance?: RecommendationPerformance }>
  ) {
    // Guard against empty array
    if (closedTrades.length === 0) {
      return {
        findings: ['No closed trades available for analysis'],
        recommendations: ['Continue trading to collect data for pattern discovery'],
        reasoning: 'Insufficient data - no closed trades',
        patterns: []
      };
    }
    
    const wins = closedTrades.filter(t => t.performance?.isWin);
    const winRate = (wins.length / closedTrades.length) * 100;
    
    return {
      findings: [
        `Analyzed ${closedTrades.length} trades with ${winRate.toFixed(1)}% win rate`,
        'Insufficient data for Grok analysis - using basic statistics'
      ],
      recommendations: [
        'Continue collecting trade data for pattern discovery',
        closedTrades.length < 20 ? 'Need at least 20 closed trades for statistical significance' : 'Ready for advanced pattern analysis'
      ],
      reasoning: 'Basic statistical analysis - Grok unavailable',
      patterns: []
    };
  }
  
  /**
   * Persist insights discovered by Grok
   */
  private async persistGrokInsights(grokFindings: any): Promise<number> {
    let count = 0;
    
    for (const pattern of grokFindings.patterns || []) {
      await insightLifecycleService.createInsightFromPattern(pattern);
      count++;
    }
    
    return count;
  }
  
  /**
   * Run continuous learning loop (called by scheduler)
   */
  async runContinuousLearning(): Promise<void> {
    console.log('[SelfLearning] Starting continuous learning loop');
    
    try {
      // Run outcome analysis
      await this.runLearningSession('outcome_analysis');
      
      // Every 7 days, run pattern discovery
      const lastPatternDiscovery = await this.getLastSessionTime('pattern_discovery');
      const daysSincePattern = (Date.now() - lastPatternDiscovery.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysSincePattern >= 7) {
        await this.runLearningSession('pattern_discovery');
      }
      
      // Every 14 days, run parameter optimization
      const lastOptimization = await this.getLastSessionTime('parameter_optimization');
      const daysSinceOptimization = (Date.now() - lastOptimization.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysSinceOptimization >= 14) {
        await this.runLearningSession('parameter_optimization');
      }
      
    } catch (error) {
      console.error('[SelfLearning] Error in continuous learning loop:', error);
    }
  }
  
  /**
   * Get last time a specific session type ran
   */
  private async getLastSessionTime(sessionType: string): Promise<Date> {
    const sessions = await learningStorage.getSessionsByType(sessionType);
    
    if (sessions.length === 0) {
      // Never ran, return far in the past
      return new Date(0);
    }
    
    return sessions[0].startedAt || new Date(0);
  }
}

export const selfLearningEngine = new SelfLearningEngine();
