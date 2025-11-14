import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

interface TimeStatus {
  cst: string;
  open: boolean;
}

interface UseCstTimeReturn {
  formattedTime: string;
  isMarketOpen: boolean;
  isLoading: boolean;
}

/**
 * Reusable hook for fetching and formatting CST time with market status
 * Polls /api/time every second for real-time updates
 */
export function useCstTime(): UseCstTimeReturn {
  const [formattedTime, setFormattedTime] = useState<string>('');

  const { data: timeStatus, isLoading } = useQuery<TimeStatus>({
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
      setFormattedTime(formatted);
    }
  }, [timeStatus]);

  return {
    formattedTime: formattedTime || 'Loading...',
    isMarketOpen: timeStatus?.open ?? false,
    isLoading
  };
}
