import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, TrendingUp } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface VixSqueezeAlertData {
  detected: boolean;
  action?: string;
  vix?: number;
  change?: number;
  entryWindow?: string;
  exitTime?: string;
  confidence?: string;
  timestamp?: string;
}

export function VixSqueezeAlert() {
  const { data: marketData } = useQuery<any>({
    queryKey: ["/api/market-overview"],
    refetchInterval: 5000,
  });

  const alertData = marketData?.vixSqueezeAlert as VixSqueezeAlertData | undefined;

  if (!alertData?.detected) {
    return null;
  }

  return (
    <Alert 
      className="border-red-500 bg-red-950/50 dark:border-red-600 dark:bg-red-950/30 shadow-lg animate-pulse"
      data-testid="alert-vix-squeeze"
    >
      <AlertTriangle className="h-5 w-5 text-red-500 dark:text-red-400" />
      <AlertTitle className="text-lg font-bold text-red-500 dark:text-red-400 flex items-center gap-2">
        🚨 VIX SQUEEZE DETECTED
        <Badge variant="destructive" className="bg-green-600 text-white hover:bg-green-700">
          {alertData.confidence} EDGE
        </Badge>
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-red-400" />
              <span className="font-semibold text-white">ACTION:</span>
              <span className="text-green-400 font-bold">{alertData.action}</span>
            </div>
            <div className="text-gray-300">
              <span className="font-semibold">VIX:</span> ${alertData.vix?.toFixed(2)} 
              <span className="text-red-400 ml-2">(+{alertData.change?.toFixed(2)}%)</span>
            </div>
          </div>
          <div className="space-y-1 text-gray-300">
            <div>
              <span className="font-semibold">Entry Window:</span> {alertData.entryWindow}
            </div>
            <div>
              <span className="font-semibold">Exit Time:</span> {alertData.exitTime}
            </div>
          </div>
        </div>
        <div className="mt-3 p-2 bg-black/30 rounded border border-yellow-600/30">
          <p className="text-xs text-yellow-400">
            ⚠️ <strong>HIGH-CONFIDENCE SIGNAL:</strong> VIX volatility spike detected. 
            Entry must occur before 3:00 PM CST today. Exit at 9:30 AM CST tomorrow.
          </p>
        </div>
      </AlertDescription>
    </Alert>
  );
}
