/**
 * Shared constants used across backend and frontend
 */

/**
 * Contract multiplier for options
 * 1 options contract = 100 shares
 */
export const OPTIONS_CONTRACT_MULTIPLIER = 100;

/**
 * Contract multiplier for stocks
 * 1 share = 1 share
 */
export const STOCK_MULTIPLIER = 1;

/**
 * Get contract multiplier based on position type
 */
export function getContractMultiplier(positionType: string): number {
  return positionType === 'options' ? OPTIONS_CONTRACT_MULTIPLIER : STOCK_MULTIPLIER;
}
