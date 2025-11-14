import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigation } from "@/components/Navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Activity,
  Zap,
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  Settings
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface StrategyMetrics {
  winRate: number;
  avgROI: number;
  profitFactor: number;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  totalProfit: number;
  totalLoss: number;
  activeStrategyVersion: string;
  parameters: {
    rsiOversold: number;
    rsiOverbought: number;
    vixMinCall: number;
    vixMinPut: number;
    stopLoss: number;
    profitTarget: number;
  } | null;
}

interface ParameterHistory {
  id: string;
  version: string;
  rsiOversold: number;
  rsiOverbought: number;
  vixMinCall: number;
  vixMinPut: number;
  stopLoss: number;
  profitTarget: number;
  winRate: number | null;
  avgROI: number | null;
  totalTrades: number | null;
  isActive: boolean;
  activatedAt: string;
  adjustmentReason: string | null;
}

interface RecommendationWithPerformance {
  id: string;
  ticker: string;
  optionType: string;
  recommendationType: string;
  strikePrice: number;
  expiry: string;
  entryPrice: number;
  premium: number;
  contracts: number;
  projectedROI: number;
  aiConfidence: number;
  rsi: number;
  vix: number;
  status: string;
  recommendedAt: string;
  strategyVersion: string;
  performance: {
    actualROI: number | null;
    actualProfit: number | null;
    exitReason: string | null;
    isWin: boolean | null;
    isLoss: boolean | null;
    holdDays: number | null;
    closedAt: string | null;
  } | null;
}

export default function Strategy() {
  const [timeRange, setTimeRange] = useState(30);

  // Fetch performance metrics
  const { data: metrics, isLoading: isLoadingMetrics } = useQuery<StrategyMetrics>({
    queryKey: ['/api/strategy/metrics', timeRange],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch parameter history
  const { data: paramHistory, isLoading: isLoadingHistory } = useQuery<ParameterHistory[]>({
    queryKey: ['/api/strategy/parameters/history'],
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch recent recommendations
  const { data: recommendations, isLoading: isLoadingRecs } = useQuery<RecommendationWithPerformance[]>({
    queryKey: ['/api/strategy/recommendations'],
    refetchInterval: 30000,
  });

  const formatPercent = (value: number | null | undefined) => {
    if (value === null || value === undefined) return 'N/A';
    return `${value.toFixed(1)}%`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Elite Strategy Analytics</h1>
            <p className="text-muted-foreground mt-1">
              Self-learning AI performance tracking and parameter evolution
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="px-3 py-1">
              <Zap className="w-3 h-3 mr-1" />
              {metrics?.activeStrategyVersion || 'v1.0.0'}
            </Badge>
          </div>
        </div>

        {/* Performance Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Target className="w-4 h-4" />
                Win Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoadingMetrics ? '...' : formatPercent(metrics?.winRate)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Last {timeRange} days
              </p>
              {metrics && metrics.winRate >= 80 && (
                <Badge className="mt-2 bg-green-500">Target Met</Badge>
              )}
              {metrics && metrics.winRate < 80 && (
                <Badge variant="destructive" className="mt-2">Below Target</Badge>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Avg ROI
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoadingMetrics ? '...' : formatPercent(metrics?.avgROI)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Per trade average
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Profit Factor
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoadingMetrics ? '...' : (metrics?.profitFactor.toFixed(2) || 'N/A')}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Wins / Losses ratio
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Total Trades
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoadingMetrics ? '...' : metrics?.totalTrades || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Sample size
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Active Strategy Parameters */}
        {metrics?.parameters && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Active Strategy Parameters
              </CardTitle>
              <CardDescription>
                Current elite formula settings (auto-adjusted to maintain 80%+ win rate)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">RSI Thresholds</div>
                  <div className="text-lg font-semibold">
                    {metrics.parameters.rsiOversold} / {metrics.parameters.rsiOverbought}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">VIX Min (Call/Put)</div>
                  <div className="text-lg font-semibold">
                    {metrics.parameters.vixMinCall} / {metrics.parameters.vixMinPut}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Stop / Target</div>
                  <div className="text-lg font-semibold">
                    {(metrics.parameters.stopLoss * 100).toFixed(0)}% / {(metrics.parameters.profitTarget * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="recommendations" className="space-y-4">
          <TabsList>
            <TabsTrigger value="recommendations">Recent Recommendations</TabsTrigger>
            <TabsTrigger value="evolution">Parameter Evolution</TabsTrigger>
          </TabsList>

          <TabsContent value="recommendations" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Tracked Recommendations</CardTitle>
                <CardDescription>
                  All recommendations displayed on the dashboard with actual outcomes
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingRecs ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : recommendations && recommendations.length > 0 ? (
                  <div className="space-y-2">
                    {recommendations.map((rec) => (
                      <div 
                        key={rec.id} 
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div>
                            <div className="font-semibold">{rec.ticker}</div>
                            <div className="text-sm text-muted-foreground">
                              {rec.optionType.toUpperCase()} ${rec.strikePrice} {rec.expiry}
                            </div>
                          </div>
                          <Badge variant={rec.recommendationType === 'day_trade' ? 'default' : 'secondary'}>
                            {rec.recommendationType === 'day_trade' ? 'Day' : 'Swing'}
                          </Badge>
                          {rec.performance?.isWin && (
                            <Badge className="bg-green-500">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Win
                            </Badge>
                          )}
                          {rec.performance?.isLoss && (
                            <Badge variant="destructive">
                              <XCircle className="w-3 h-3 mr-1" />
                              Loss
                            </Badge>
                          )}
                          {!rec.performance && rec.status === 'monitoring' && (
                            <Badge variant="outline">
                              <Clock className="w-3 h-3 mr-1" />
                              Open
                            </Badge>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium">
                            Projected: {formatPercent(rec.projectedROI)}
                          </div>
                          {rec.performance?.actualROI !== null && rec.performance?.actualROI !== undefined && (
                            <div className={`text-sm ${rec.performance.actualROI >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              Actual: {formatPercent(rec.performance.actualROI)}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mt-1">
                            {formatDate(rec.recommendedAt)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No recommendations tracked yet. Run a market scan to start tracking.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="evolution" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Strategy Parameter History</CardTitle>
                <CardDescription>
                  How the AI has adjusted parameters over time to maintain 80%+ win rate
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingHistory ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : paramHistory && paramHistory.length > 0 ? (
                  <div className="space-y-3">
                    {paramHistory.map((version, idx) => (
                      <div 
                        key={version.id} 
                        className={`p-4 border rounded-lg ${version.isActive ? 'border-primary bg-primary/5' : ''}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="font-semibold">{version.version}</div>
                            {version.isActive && (
                              <Badge className="bg-primary">Active</Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatDate(version.activatedAt)}
                          </div>
                        </div>
                        
                        {version.adjustmentReason && (
                          <div className="text-sm text-muted-foreground mb-3 italic">
                            {version.adjustmentReason}
                          </div>
                        )}
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div>
                            <div className="text-muted-foreground">RSI</div>
                            <div className="font-medium">{version.rsiOversold}/{version.rsiOverbought}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">VIX</div>
                            <div className="font-medium">{version.vixMinCall}/{version.vixMinPut}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Stop/Target</div>
                            <div className="font-medium">
                              {(version.stopLoss * 100).toFixed(0)}%/{(version.profitTarget * 100).toFixed(0)}%
                            </div>
                          </div>
                          {version.winRate !== null && (
                            <div>
                              <div className="text-muted-foreground">Performance</div>
                              <div className="font-medium">
                                {formatPercent(version.winRate)} ({version.totalTrades} trades)
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No parameter adjustments yet. The system will auto-adjust when win rate drops below 80%.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
