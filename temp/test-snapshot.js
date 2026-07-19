const { getContextSnapshot } = require('../packages/strategy/indicators.ts');
require('ts-node').register();

async function run() {
  const { fetchPaperBars } = require('../supabase/functions/_shared/execution.ts');
  const res = await fetchPaperBars('XAGUSD', '1H', 100);
  const snapshot = getContextSnapshot(
    res.bars.map(b => b.t),
    res.bars.map(b => b.h),
    res.bars.map(b => b.l),
    res.bars.map(b => b.c)
  );
  console.log('XAGUSD 1H Snapshot:', JSON.stringify(snapshot, null, 2));
}
run();
