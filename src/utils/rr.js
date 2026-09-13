export function calculateRR(direction, entry, stopLoss, takeProfit) {
  const e = Number(entry),
    s = Number(stopLoss),
    t = Number(takeProfit);
  if (![e, s, t].every(Number.isFinite)) return null;
  const risk = direction === "SHORT" ? s - e : e - s;
  const reward = direction === "SHORT" ? e - t : t - e;
  if (risk <= 0 || reward < 0) return null;
  return { risk, reward, ratio: reward / risk };
}
