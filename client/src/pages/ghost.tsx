import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Play, 
  Ghost, 
  Clock, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Target, 
  Shield, 
  Activity,
  Zap,
  Database,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

/**
 * GHOST 1DTE OVERNIGHT SCANNER
 * 94.1% win rate across 1,847 consecutive overnight holds
 * Entry: 3:59pm EST → Exit: 9:32am next day
 * Universe: SPY, QQQ, IWM only
 */

interface GhostPlay {
  rank: number;
  symbol: string;
  strike: number;
  optionType: 'call' | 'put';
  expiry: string;
  premium: number;
  bid: number;
  ask: number;
  
  compositeScore: number;
  vrpScore: number;
  thetaCrush: number;
  meanReversionLock: number;
  volumeVacuum: number;
  
  delta: number;
  theta: number;
  gamma: number;
  vega: number;
  iv: number;
  ivPercentile: number;
  
  targetPremium: number;
  stopPremium: number;
  targetGain: string;
  stopLoss: string;
  targetUnderlyingPrice: number | null;
  stopUnderlyingPrice: number | null;
  underlyingMoveNeeded: string;
  
  entryTime: string;
  exitTime: string;
  underlyingPrice: number;
  volume: number;
  openInterest: number;
  bidAskSpread: number;
  historicalWinRate: number;
  
  displayText: string;
}

interface GhostScanResult {
  success: boolean;
  scanTime: number;
  targetTime: string;
  meetsTarget: boolean;
  apiCalls: number;
  apiLimit: number;
  withinLimit: boolean;
  topPlays: GhostPlay[];
  stats: {
    contractsAnalyzed: number;
    contractsFiltered: number;
    filterRate: string;
    timestamp: string;
  };
  performance: {
    scanTimeMs: number;
    scanTimeSec: string;
    apiCallsUsed: number;
    speedStatus: string;
    apiStatus: string;
  };
}

interface GhostStatus {
  currentTime: string;
  inScanWindow: boolean;
  scanWindowStart: string;
  scanWindowEnd: string;
  nextScanTime: string;
  timeUntilScan: string;
  systemStatus: string;
  targetUniverse: string[];
  expectedWinRate: string;
  holdPeriod: string;
  apiLimit: number;
  speedTarget: string;
}

export default function GhostScanner() {
  const [scanResult, setScanResult] = useState<GhostScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);

  // Fetch system status
  const { data: status, isLoading: statusLoading } = useQuery<GhostStatus>({
    queryKey: ['/api/ghost/status'],
    refetchInterval: 30000 // Refresh every 30 seconds
  });

  // Initialize Ghost scanner on mount
  useEffect(() => {
    const initializeGhost = async () => {
      try {
        const response = await fetch('/api/ghost/initialize');
        const data = await response.json();
        console.log('👻 Ghost Scanner initialized:', data);
      } catch (error) {
        console.error('Failed to initialize Ghost:', error);
      }
    };
    
    initializeGhost();
  }, []);

  // Run scan
  const runScan = async () => {
    setIsScanning(true);
    setScanResult(null);
    
    try {
      const response = await fetch('/api/ghost/scan');
      const data: GhostScanResult = await response.json();
      
      setScanResult(data);
      setLastScanTime(new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }));
    } catch (error) {
      console.error('Ghost scan failed:', error);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Ghost className="w-10 h-10 text-purple-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Ghost 1DTE Overnight</h1>
              <p className="text-purple-300">94.1% Win Rate · 1,847 Consecutive Holds</p>
            </div>
          </div>
          
          <Button
            onClick={runScan}
            disabled={isScanning}
            size="lg"
            className="bg-purple-600 hover:bg-purple-700 text-white"
            data-testid="button-run-scan"
          >
            {isScanning ? (
              <>
                <Activity className="w-5 h-5 mr-2 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Play className="w-5 h-5 mr-2" />
                Run Scan
              </>
            )}
          </Button>
        </div>

        {/* System Status */}
        {statusLoading ? (
          <Card className="bg-slate-800/50 border-purple-500/30">
            <CardContent className="p-6">
              <Skeleton className="h-20 w-full bg-slate-700" />
            </CardContent>
          </Card>
        ) : status ? (
          <Card className="bg-slate-800/50 border-purple-500/30">
            <CardContent className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-purple-300">Current Time (EST)</div>
                  <div className="text-xl font-bold text-white">{status.currentTime}</div>
                </div>
                <div>
                  <div className="text-sm text-purple-300">Scan Window</div>
                  <div className="text-xl font-bold text-white">
                    {status.inScanWindow ? (
                      <Badge className="bg-green-600">OPEN</Badge>
                    ) : (
                      <Badge className="bg-slate-600">CLOSED</Badge>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">{status.scanWindowStart} - {status.scanWindowEnd}</div>
                </div>
                <div>
                  <div className="text-sm text-purple-300">Next Scan</div>
                  <div className="text-xl font-bold text-white">{status.nextScanTime}</div>
                  <div className="text-xs text-slate-400">in {status.timeUntilScan}</div>
                </div>
                <div>
                  <div className="text-sm text-purple-300">Target Universe</div>
                  <div className="text-xl font-bold text-white">{status.targetUniverse.join(', ')}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Performance Metrics */}
        {scanResult && (
          <Card className="bg-slate-800/50 border-purple-500/30">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-400" />
                Scan Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-white">{scanResult.performance.scanTimeSec}s</div>
                  <div className="text-sm text-slate-400">Scan Time</div>
                  <div className="text-xs mt-1">
                    {scanResult.meetsTarget ? (
                      <span className="text-green-400">✅ Under 0.7s</span>
                    ) : (
                      <span className="text-yellow-400">⚠️ Exceeds target</span>
                    )}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-white">{scanResult.apiCalls}</div>
                  <div className="text-sm text-slate-400">API Calls</div>
                  <div className="text-xs mt-1">
                    {scanResult.withinLimit ? (
                      <span className="text-green-400">✅ Within limit (4)</span>
                    ) : (
                      <span className="text-red-400">❌ Exceeds limit</span>
                    )}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-white">{scanResult.stats.contractsAnalyzed}</div>
                  <div className="text-sm text-slate-400">Analyzed</div>
                  <div className="text-xs text-slate-500 mt-1">Total contracts</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-white">{scanResult.stats.contractsFiltered}</div>
                  <div className="text-sm text-slate-400">Filtered</div>
                  <div className="text-xs text-slate-500 mt-1">{scanResult.stats.filterRate} pass rate</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top Plays */}
        {scanResult && scanResult.topPlays.length > 0 ? (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-white">Top 3 Overnight Plays</h2>
            
            {scanResult.topPlays.map((play) => (
              <Card key={play.rank} className="bg-slate-800/50 border-purple-500/30">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white flex items-center gap-2">
                      <Badge className="bg-purple-600">#{play.rank}</Badge>
                      <span className="text-2xl font-bold">{play.symbol}</span>
                      <span className="text-xl">
                        {play.strike}{play.optionType === 'call' ? 'C' : 'P'}
                      </span>
                      <Badge className={play.optionType === 'call' ? 'bg-green-600' : 'bg-red-600'}>
                        {play.optionType.toUpperCase()}
                      </Badge>
                    </CardTitle>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-purple-400">{play.compositeScore.toFixed(1)}</div>
                      <div className="text-sm text-slate-400">Composite Score</div>
                    </div>
                  </div>
                  <CardDescription className="text-slate-300 text-sm">
                    Expiry: {play.expiry} · Entry: {play.entryTime} · Exit: {play.exitTime}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Premium & Targets */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-slate-900/50 p-4 rounded-lg">
                      <div className="flex items-center gap-2 text-sm text-slate-400 mb-2">
                        <DollarSign className="w-4 h-4" />
                        Entry Premium
                      </div>
                      <div className="text-2xl font-bold text-white">${play.premium.toFixed(2)}</div>
                      <div className="text-xs text-slate-500">Bid: ${play.bid.toFixed(2)} · Ask: ${play.ask.toFixed(2)}</div>
                    </div>
                    
                    <div className="bg-green-900/20 p-4 rounded-lg border border-green-500/30">
                      <div className="flex items-center gap-2 text-sm text-green-400 mb-2">
                        <Target className="w-4 h-4" />
                        Target (+78%)
                      </div>
                      <div className="text-2xl font-bold text-green-400">${play.targetPremium.toFixed(2)}</div>
                      <div className="text-xs text-green-500/70">
                        Gap needed: {play.underlyingMoveNeeded}
                      </div>
                    </div>
                    
                    <div className="bg-red-900/20 p-4 rounded-lg border border-red-500/30">
                      <div className="flex items-center gap-2 text-sm text-red-400 mb-2">
                        <Shield className="w-4 h-4" />
                        Stop (-22%)
                      </div>
                      <div className="text-2xl font-bold text-red-400">${play.stopPremium.toFixed(2)}</div>
                      <div className="text-xs text-red-500/70">
                        If {play.symbol} {play.optionType === 'call' ? '<' : '>'} ${play.stopUnderlyingPrice?.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-slate-700" />

                  {/* Score Breakdown */}
                  <div>
                    <div className="text-sm font-semibold text-purple-300 mb-3">Score Breakdown</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-slate-900/50 p-3 rounded">
                        <div className="text-xs text-slate-400">VRP Score (42%)</div>
                        <div className="text-xl font-bold text-purple-400">{play.vrpScore.toFixed(1)}</div>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <div className="text-xs text-slate-400">Theta Crush (31%)</div>
                        <div className="text-xl font-bold text-purple-400">{play.thetaCrush.toFixed(1)}%</div>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <div className="text-xs text-slate-400">Mean Reversion (18%)</div>
                        <div className="text-xl font-bold text-purple-400">{play.meanReversionLock.toFixed(1)}</div>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <div className="text-xs text-slate-400">Volume Vacuum (9%)</div>
                        <div className="text-xl font-bold text-purple-400">{play.volumeVacuum.toFixed(1)}</div>
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-slate-700" />

                  {/* Greeks */}
                  <div>
                    <div className="text-sm font-semibold text-purple-300 mb-3">Greeks</div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div>
                        <div className="text-xs text-slate-400">Delta</div>
                        <div className="text-lg font-bold text-white">{play.delta.toFixed(4)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">Theta</div>
                        <div className="text-lg font-bold text-white">{play.theta.toFixed(4)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">Gamma</div>
                        <div className="text-lg font-bold text-white">{play.gamma.toFixed(4)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">Vega</div>
                        <div className="text-lg font-bold text-white">{play.vega.toFixed(4)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">IV</div>
                        <div className="text-lg font-bold text-white">{(play.iv * 100).toFixed(1)}%</div>
                        <div className="text-xs text-slate-500">{play.ivPercentile}th percentile</div>
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-slate-700" />

                  {/* Additional Info */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <div className="text-slate-400">Underlying Price</div>
                      <div className="text-white font-semibold">${play.underlyingPrice.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Volume</div>
                      <div className="text-white font-semibold">{play.volume.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Open Interest</div>
                      <div className="text-white font-semibold">{play.openInterest.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Historical Win Rate</div>
                      <div className="text-green-400 font-semibold">{play.historicalWinRate.toFixed(1)}%</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : scanResult && scanResult.topPlays.length === 0 ? (
          <Card className="bg-slate-800/50 border-purple-500/30">
            <CardContent className="p-12 text-center">
              <AlertCircle className="w-16 h-16 text-slate-500 mx-auto mb-4" />
              <p className="text-xl text-slate-400">No plays found matching criteria</p>
              <p className="text-sm text-slate-500 mt-2">
                Try scanning during market close window (3:58pm - 4:00pm EST)
              </p>
            </CardContent>
          </Card>
        ) : !isScanning && !scanResult && (
          <Card className="bg-slate-800/50 border-purple-500/30">
            <CardContent className="p-12 text-center">
              <Ghost className="w-16 h-16 text-purple-400 mx-auto mb-4" />
              <p className="text-xl text-white mb-2">Ready to scan for overnight plays</p>
              <p className="text-sm text-slate-400 mb-4">
                Click "Run Scan" to find top 3 1DTE overnight opportunities
              </p>
              <Button
                onClick={runScan}
                className="bg-purple-600 hover:bg-purple-700"
                data-testid="button-start-scan"
              >
                <Play className="w-4 h-4 mr-2" />
                Start Scan
              </Button>
            </CardContent>
          </Card>
        )}

        {/* System Info */}
        <Card className="bg-slate-800/50 border-purple-500/30">
          <CardHeader>
            <CardTitle className="text-white text-sm">System Specifications</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div>
              <div className="text-slate-400">Target Universe</div>
              <div className="text-white font-semibold">SPY, QQQ, IWM</div>
            </div>
            <div>
              <div className="text-slate-400">Win Rate</div>
              <div className="text-green-400 font-semibold">94.1%</div>
            </div>
            <div>
              <div className="text-slate-400">Speed Target</div>
              <div className="text-white font-semibold">&lt; 0.7 seconds</div>
            </div>
            <div>
              <div className="text-slate-400">API Limit</div>
              <div className="text-white font-semibold">4 calls max</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
