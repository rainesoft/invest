import { RiskValidationResult } from '../packages/strategy/riskManager.ts';

// Mock Supabase Client behavior
export class MockSupabaseClient {
  private openTrades: any[] = [];
  private recentClosedTrades: any[] = [];

  constructor(openTrades: any[], recentClosedTrades: any[]) {
    this.openTrades = openTrades;
    this.recentClosedTrades = recentClosedTrades;
  }

  from(table: string) {
    return {
      select: (columns: string) => {
        return {
          eq: (field: string, value: string) => {
            if (field === "status" && value === "APPROVED") {
              return Promise.resolve({ data: this.openTrades, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
          in: (field: string, values: string[]) => {
            return {
              gte: (f: string, v: string) => {
                return {
                  order: (o: string, opts: any) => {
                    return {
                      limit: (l: number) => {
                        return Promise.resolve({ data: this.recentClosedTrades.slice(0, l), error: null });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };
  }
}

async function runChaosSimulation() {
  console.log("--- CHAOS SIMULATION: RISK MANAGER ---");

  // TEST 1: The Cooldown (2 LOST trades today)
  console.log("\nTest 1: Daily Cooldown");
  const supabaseCooldown = new MockSupabaseClient(
    [], // No open trades
    [{ status: "LOST" }, { status: "LOST" }] // 2 consecutive losses today
  ) as any;
  
  // Need to import dynamically to use the mock, or just copy the logic for testing
  // Actually, we can just import the real function and pass the mock client
  const { validateExposure } = await import('../packages/strategy/riskManager.ts');
  
  const result1 = await validateExposure(supabaseCooldown, "BTCUSD");
  console.log("Expected: REJECTED (Daily Cooldown Active)");
  console.log("Result:  ", result1.valid ? "APPROVED" : result1.reason);

  // TEST 2: Asset Isolation (XAUUSD already open)
  console.log("\nTest 2: Asset Isolation");
  const supabaseIsolation = new MockSupabaseClient(
    [{ symbol: "XAUUSD", status: "APPROVED" }], // XAUUSD is already open
    [{ status: "WON" }] // No cooldown
  ) as any;

  const result2_Gold = await validateExposure(supabaseIsolation, "XAUUSD");
  console.log("Expected (Gold): REJECTED (Asset Isolation)");
  console.log("Result (Gold):  ", result2_Gold.valid ? "APPROVED" : result2_Gold.reason);

  const result2_BTC = await validateExposure(supabaseIsolation, "BTCUSD");
  console.log("Expected (BTC): APPROVED");
  console.log("Result (BTC):  ", result2_BTC.valid ? "APPROVED" : result2_BTC.reason);
}

runChaosSimulation();
