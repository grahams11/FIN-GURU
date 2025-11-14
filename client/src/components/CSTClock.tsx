import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Circle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface TimeStatus {
  cst: string;
  open: boolean;
}

export function CSTClock() {
  const [currentTime, setCurrentTime] = useState<string>('');

  const { data: timeStatus } = useQuery<TimeStatus>({
    queryKey: ['/api/time'],
    refetchInterval: 1000, // Update every second
  });

  useEffect(() => {
    if (timeStatus?.cst) {
      const date = new Date(timeStatus.cst);
      const formatted = date.toLocaleTimeString('en-US', {
        timeZone: 'America/Chicago',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      setCurrentTime(formatted);
    }
  }, [timeStatus]);

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" />
              CST Time
            </p>
            <p className="text-2xl font-bold" data-testid="text-cst-time">
              {currentTime || 'Loading...'}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <Circle 
                className={`w-2 h-2 fill-current ${timeStatus?.open ? 'text-green-500' : 'text-red-500'}`}
              />
              <p 
                className={`text-sm font-semibold ${timeStatus?.open ? 'text-green-500' : 'text-red-500'}`}
                data-testid="text-market-status"
              >
                {timeStatus?.open ? 'MARKET LIVE' : 'MARKET CLOSED'}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
