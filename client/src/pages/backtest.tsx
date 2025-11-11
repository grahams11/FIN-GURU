import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigation } from "@/components/Navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Activity,
  Calendar,
  DollarSign,
  BarChart3,
  CheckCircle2,
  XCircle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Progress } from "@/components/ui/progress";

interface BacktestResult {
  runId: string;
  wins: number;
  losses: number;
  winRate: number;
  avgROI: number;
  profitFactor: number;
  maxDrawdown: number | null;
  totalTrades: number;
}

interface BacktestTrade {
  id: string;
  ticker: string;
  optionType: string;
  strike: number;
  entryDate: string;
  exitDate: string;
  entryPremium: number;
  exitPremium: number;
  exitReason: string;
  contracts: number;
  pnl: number;
  roi: number;
}

interface BacktestDetails {
  run: any;
  trades: BacktestTrade[];
  summary: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgROI: number;
    profitFactor: number;
    maxDrawdown: number | null;
  };
}

export default function Backtest() {
  const { toast } = useToast();
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  // Form state
  const [startDate, setStartDate] = useState("2024-06-01");
  const [endDate, setEndDate] = useState("2024-11-01");
  const [symbols, setSymbols] = useState("AAPL,NVDA,TSLA,MSFT");
  const [budget, setBudget] = useState("1000");
  const [stopLoss, setStopLoss] = useState("0.45");
  const [profitTarget, setProfitTarget] = useState("1.0");

  // Run backtest mutation
  const runBacktest = useMutation({
    mutationFn: async (config: any) => {
      const response = await apiRequest("POST", "/api/backtest/run", config);
      if (!response.ok) {
        throw new Error("Backtest failed");
      }
      return await response.json() as BacktestResult;
    },
    onSuccess: (data: BacktestResult) => {
      setCurrentRunId(data.runId);
      toast({
        title: "Backtest Complete",
        description: `Win Rate: ${data.winRate.toFixed(1)}% | Total Trades: ${data.totalTrades}`,
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Backtest Failed",
        description: error.message || "Something went wrong",
      });
    }
  });

  // Fetch backtest details
  const { data: backtestDetails } = useQuery<BacktestDetails>({
    queryKey: ["/api/backtest", currentRunId],
    enabled: !!currentRunId,
  });

  const handleRunBacktest = () => {
    const symbolList = symbols.split(',').map(s => s.trim()).filter(Boolean);
    
    runBacktest.mutate({
      startDate,
      endDate,
      symbols: symbolList,
      budget: parseFloat(budget),
      stopLoss: parseFloat(stopLoss),
      profitTarget: parseFloat(profitTarget),
      rsiOversold: 30,
      rsiOverbought: 70,
      minVIX: 10,
      maxHoldDays: 10
    });
  };

  const summary = backtestDetails?.summary;

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Strategy Backtesting</h1>
          <p className="text-muted-foreground">
            Test your trading strategy on historical data to see how it would have performed
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Configuration Form */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Configure Backtest</CardTitle>
              <CardDescription>Set parameters for your strategy test</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="start-date">Start Date</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  data-testid="input-start-date"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="end-date">End Date</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  data-testid="input-end-date"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="symbols">Symbols (comma-separated)</Label>
                <Input
                  id="symbols"
                  placeholder="AAPL,NVDA,TSLA"
                  value={symbols}
                  onChange={(e) => setSymbols(e.target.value)}
                  data-testid="input-symbols"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="budget">Budget per Trade ($)</Label>
                <Input
                  id="budget"
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  data-testid="input-budget"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="stop-loss">Stop Loss (%)</Label>
                <Input
                  id="stop-loss"
                  type="number"
                  step="0.01"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  data-testid="input-stop-loss"
                />
                <p className="text-xs text-muted-foreground">Current: {(parseFloat(stopLoss) * 100).toFixed(0)}%</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="profit-target">Profit Target (%)</Label>
                <Input
                  id="profit-target"
                  type="number"
                  step="0.1"
                  value={profitTarget}
                  onChange={(e) => setProfitTarget(e.target.value)}
                  data-testid="input-profit-target"
                />
                <p className="text-xs text-muted-foreground">Current: {(parseFloat(profitTarget) * 100).toFixed(0)}%</p>
              </div>

              <Button
                onClick={handleRunBacktest}
                disabled={runBacktest.isPending}
                className="w-full"
                data-testid="button-run-backtest"
              >
                {runBacktest.isPending ? (
                  <>
                    <Activity className="mr-2 h-4 w-4 animate-spin" />
                    Running Backtest...
                  </>
                ) : (
                  <>
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Run Backtest
                  </>
                )}
              </Button>

              <div className="pt-4 border-t">
                <h4 className="text-sm font-semibold mb-2">Strategy Rules:</h4>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• RSI &lt; 30: BUY CALL</li>
                  <li>• RSI &gt; 70: BUY PUT</li>
                  <li>• VIX minimum: 10</li>
                  <li>• Hold period: max 10 days</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Right Column: Results */}
          <div className="lg:col-span-2 space-y-6">
            {summary ? (
              <>
                {/* Performance Metrics */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Win Rate</p>
                          <p className="text-2xl font-bold" data-testid="text-win-rate">
                            {summary.winRate.toFixed(1)}%
                          </p>
                        </div>
                        <Target className="h-8 w-8 text-primary opacity-50" />
                      </div>
                      <Progress 
                        value={summary.winRate} 
                        className="mt-2" 
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Avg ROI</p>
                          <p 
                            className={`text-2xl font-bold ${summary.avgROI >= 0 ? 'text-green-500' : 'text-red-500'}`}
                            data-testid="text-avg-roi"
                          >
                            {summary.avgROI >= 0 ? '+' : ''}{summary.avgROI.toFixed(1)}%
                          </p>
                        </div>
                        {summary.avgROI >= 0 ? (
                          <TrendingUp className="h-8 w-8 text-green-500 opacity-50" />
                        ) : (
                          <TrendingDown className="h-8 w-8 text-red-500 opacity-50" />
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Profit Factor</p>
                          <p className="text-2xl font-bold" data-testid="text-profit-factor">
                            {summary.profitFactor.toFixed(2)}x
                          </p>
                        </div>
                        <DollarSign className="h-8 w-8 text-primary opacity-50" />
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {summary.profitFactor > 1 ? 'Profitable' : 'Not Profitable'}
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Total Trades</p>
                          <p className="text-2xl font-bold" data-testid="text-total-trades">
                            {summary.totalTrades}
                          </p>
                        </div>
                        <Calendar className="h-8 w-8 text-primary opacity-50" />
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {summary.wins}W / {summary.losses}L
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Trade History Table */}
                <Card>
                  <CardHeader>
                    <CardTitle>Trade History</CardTitle>
                    <CardDescription>Individual trade performance details</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-2 text-sm font-semibold">Ticker</th>
                            <th className="text-left p-2 text-sm font-semibold">Type</th>
                            <th className="text-right p-2 text-sm font-semibold">Entry</th>
                            <th className="text-right p-2 text-sm font-semibold">Exit</th>
                            <th className="text-right p-2 text-sm font-semibold">P&L</th>
                            <th className="text-right p-2 text-sm font-semibold">ROI</th>
                            <th className="text-left p-2 text-sm font-semibold">Exit Reason</th>
                            <th className="text-center p-2 text-sm font-semibold">Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {backtestDetails?.trades.map((trade) => (
                            <tr key={trade.id} className="border-b hover:bg-muted/50" data-testid={`trade-row-${trade.ticker}`}>
                              <td className="p-2 font-medium">{trade.ticker}</td>
                              <td className="p-2">
                                <span className={`px-2 py-1 rounded text-xs ${
                                  trade.optionType === 'call' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                                }`}>
                                  {trade.optionType.toUpperCase()}
                                </span>
                              </td>
                              <td className="p-2 text-right text-sm">
                                {new Date(trade.entryDate).toLocaleDateString()}
                              </td>
                              <td className="p-2 text-right text-sm">
                                {new Date(trade.exitDate).toLocaleDateString()}
                              </td>
                              <td className={`p-2 text-right font-semibold ${trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                ${trade.pnl.toFixed(2)}
                              </td>
                              <td className={`p-2 text-right font-semibold ${trade.roi >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {trade.roi >= 0 ? '+' : ''}{trade.roi.toFixed(1)}%
                              </td>
                              <td className="p-2 text-sm capitalize">{trade.exitReason}</td>
                              <td className="p-2 text-center">
                                {trade.pnl >= 0 ? (
                                  <CheckCircle2 className="h-5 w-5 text-green-500 inline" />
                                ) : (
                                  <XCircle className="h-5 w-5 text-red-500 inline" />
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="p-12 text-center">
                  <BarChart3 className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <p className="text-lg font-semibold mb-2">No Backtest Results Yet</p>
                  <p className="text-muted-foreground">
                    Configure your parameters and click "Run Backtest" to get started
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
