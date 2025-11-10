import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, TrendingUp, Activity, Brain, Target, Clock, Sparkles } from "lucide-react";

interface AIPortfolioAnalysis {
  timestamp: string;
  accountValue: number;
  totalUnrealizedPnL: number;
  portfolioPnLPercent: number;
  positionsCount: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  marketCondition: {
    level: string;
    description: string;
  };
  vixLevel: number;
  goalProgress: {
    current: number;
    target: number;
    progressPercent: number;
    growthPercent: number;
    remaining: number;
    requiredMultiplier: string;
    onTrack: boolean;
  };
  recommendations: StrategicRecommendation[];
  actionableInsights: ActionableInsight[];
  positionAnalyses: any[];
  grokEnhancement: GrokEnhancement | null;
}

interface StrategicRecommendation {
  type: 'EXIT_POSITION' | 'TAKE_PROFIT' | 'REBALANCE' | 'NEW_POSITION';
  ticker: string;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  action: 'CLOSE' | 'TRIM' | 'REALLOCATE' | 'ENTER';
  canExecuteNow?: boolean;
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

interface GrokEnhancement {
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

export function PortfolioAIInsights() {
  const { data: aiAnalysis, isLoading } = useQuery<AIPortfolioAnalysis>({
    queryKey: ["/api/portfolio/ai-analysis"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (isLoading) {
    return (
      <Card className="border-purple-500/30" data-testid="ai-insights-loading">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-500" />
            <CardTitle>AI Portfolio Insights</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Activity className="h-8 w-8 animate-spin text-purple-500" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!aiAnalysis) {
    return null;
  }

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'CRITICAL': return 'bg-red-500 text-white';
      case 'HIGH': return 'bg-orange-500 text-white';
      case 'MEDIUM': return 'bg-yellow-500 text-black';
      case 'LOW': return 'bg-green-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getUrgencyIcon = (urgency: string) => {
    switch (urgency) {
      case 'HIGH': return <AlertTriangle className="h-4 w-4" />;
      case 'MEDIUM': return <Activity className="h-4 w-4" />;
      case 'LOW': return <TrendingUp className="h-4 w-4" />;
      default: return null;
    }
  };

  return (
    <div className="space-y-4" data-testid="ai-insights-container">
      {/* Main AI Insights Card */}
      <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-transparent">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-purple-500" />
              <CardTitle>AI Portfolio Insights</CardTitle>
              <Badge variant="outline" className="gap-1">
                <Activity className="h-3 w-3" />
                Hybrid AI
              </Badge>
            </div>
            <Badge className={getRiskColor(aiAnalysis.riskLevel)} data-testid="portfolio-risk-badge">
              {aiAnalysis.riskLevel} RISK
            </Badge>
          </div>
          <CardDescription>
            Internal algorithms + Grok AI enhancement | {aiAnalysis.marketCondition.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Goal Progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-purple-500" />
                <span className="font-medium">Path to $1M</span>
              </div>
              <span className={aiAnalysis.goalProgress.onTrack ? 'text-green-500' : 'text-yellow-500'} data-testid="goal-status">
                {aiAnalysis.goalProgress.onTrack ? 'On Track' : 'Needs Adjustment'}
              </span>
            </div>
            <Progress value={aiAnalysis.goalProgress.progressPercent} className="h-2" data-testid="goal-progress-bar" />
            <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
              <div>
                <p>Current</p>
                <p className="font-medium text-foreground" data-testid="current-balance">${aiAnalysis.accountValue.toLocaleString()}</p>
              </div>
              <div>
                <p>Remaining</p>
                <p className="font-medium text-foreground" data-testid="remaining-to-goal">${aiAnalysis.goalProgress.remaining.toLocaleString()}</p>
              </div>
              <div>
                <p>Required Growth</p>
                <p className="font-medium text-foreground" data-testid="required-growth">{aiAnalysis.goalProgress.requiredMultiplier}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Strategic Recommendations */}
          {aiAnalysis.recommendations.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Strategic Recommendations ({aiAnalysis.recommendations.length})
              </h3>
              <div className="space-y-2">
                {aiAnalysis.recommendations.map((rec, idx) => (
                  <Alert
                    key={idx}
                    className={`${
                      rec.urgency === 'HIGH' ? 'border-red-500/50 bg-red-500/10' :
                      rec.urgency === 'MEDIUM' ? 'border-yellow-500/50 bg-yellow-500/10' :
                      'border-blue-500/50 bg-blue-500/10'
                    }`}
                    data-testid={`recommendation-${idx}`}
                  >
                    <div className="flex items-start gap-3">
                      {getUrgencyIcon(rec.urgency)}
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm">
                            {rec.type.replace(/_/g, ' ')} - {rec.ticker}
                          </p>
                          <Badge variant="outline" className="text-xs">
                            {rec.action}
                          </Badge>
                          {rec.canExecuteNow === false && (
                            <Badge variant="outline" className="gap-1 text-xs">
                              <Clock className="h-3 w-3" />
                              24h Rule
                            </Badge>
                          )}
                        </div>
                        <ul className="text-xs space-y-1 text-muted-foreground">
                          {rec.reasoning.map((reason, i) => (
                            <li key={i}>• {reason}</li>
                          ))}
                        </ul>
                        {rec.expectedImpact.pnlRealized !== undefined && (
                          <p className="text-xs font-medium">
                            Expected P&L: ${rec.expectedImpact.pnlRealized.toFixed(2)}
                          </p>
                        )}
                        {rec.expectedImpact.newOpportunityROI !== undefined && (
                          <p className="text-xs font-medium text-green-500">
                            New Opportunity ROI: {rec.expectedImpact.newOpportunityROI.toFixed(0)}%
                          </p>
                        )}
                      </div>
                    </div>
                  </Alert>
                ))}
              </div>
            </div>
          )}

          {/* Actionable Insights */}
          {aiAnalysis.actionableInsights.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="font-semibold text-sm">Quick Insights</h3>
                <div className="grid gap-2">
                  {aiAnalysis.actionableInsights.map((insight, idx) => (
                    <div
                      key={idx}
                      className="text-xs p-2 rounded-md bg-muted/50"
                      data-testid={`insight-${idx}`}
                    >
                      <p className="font-medium">{insight.message}</p>
                      <p className="text-muted-foreground mt-1">{insight.action}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Grok AI Enhancement (when available) */}
      {aiAnalysis.grokEnhancement && (
        <Card className="border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-transparent" data-testid="grok-enhancement">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-500" />
              <CardTitle className="text-lg">Grok AI Enhancement</CardTitle>
              <Badge variant="outline" className="gap-1">
                <Brain className="h-3 w-3" />
                {(aiAnalysis.grokEnhancement.confidence * 100).toFixed(0)}% Confidence
              </Badge>
            </div>
            <CardDescription>
              Advanced AI reasoning for complex scenarios
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Grok Market Insights */}
            {aiAnalysis.grokEnhancement.marketInsights && (
              <div className="p-3 rounded-md bg-cyan-500/10 border border-cyan-500/30">
                <p className="text-sm font-medium mb-2">Market Analysis:</p>
                <p className="text-sm text-muted-foreground">
                  {aiAnalysis.grokEnhancement.marketInsights}
                </p>
              </div>
            )}

            {/* Grok Risk Assessment */}
            {aiAnalysis.grokEnhancement.riskAssessment.concerns.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  <p className="text-sm font-medium">Risk Assessment:</p>
                  <Badge className={getRiskColor(aiAnalysis.grokEnhancement.riskAssessment.level)} data-testid="grok-risk-level">
                    {aiAnalysis.grokEnhancement.riskAssessment.level}
                  </Badge>
                </div>
                <ul className="text-xs space-y-1 text-muted-foreground ml-6">
                  {aiAnalysis.grokEnhancement.riskAssessment.concerns.map((concern, i) => (
                    <li key={i}>• {concern}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Grok Enhanced Recommendations */}
            {aiAnalysis.grokEnhancement.enhancedRecommendations.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Enhanced Recommendations:</p>
                <div className="space-y-2">
                  {aiAnalysis.grokEnhancement.enhancedRecommendations.map((rec, idx) => (
                    <div key={idx} className="text-xs p-2 rounded-md bg-cyan-500/10 border border-cyan-500/30">
                      <p className="font-medium">{rec.action}</p>
                      <p className="text-muted-foreground mt-1">{rec.reasoning}</p>
                      <Badge className="mt-1 text-xs">
                        {rec.priority} Priority
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Grok Reasoning */}
            {aiAnalysis.grokEnhancement.reasoning.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">AI Reasoning:</p>
                <ul className="text-xs space-y-1 text-muted-foreground">
                  {aiAnalysis.grokEnhancement.reasoning.map((reason, i) => (
                    <li key={i}>• {reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
