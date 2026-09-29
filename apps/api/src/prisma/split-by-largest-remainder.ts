export interface SplitInput {
  id: string;
  weight: number;
}

export interface SplitResult {
  id: string;
  amountCents: number;
}

/**
 * Splits `totalCents` proportionally to integer weights using the
 * largest-remainder method, guaranteeing the parts always sum to
 * exactly `totalCents`.
 */
export function splitByLargestRemainder(
  totalCents: number,
  inputs: SplitInput[],
): SplitResult[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error('totalCents must be a non-negative integer');
  }
  if (inputs.length === 0) {
    return [];
  }
  const totalWeight = inputs.reduce(
    (sum, input) => sum + input.weight,
    0,
  );
  if (!Number.isInteger(totalWeight) || totalWeight <= 0) {
    throw new Error('weights must be positive integers');
  }

  const exactShares = inputs.map((input) => {
    const share =
      Math.round(input.weight) *
      (totalCents / totalWeight);
    return { ...input, share };
  });

  const floored = exactShares.map((entry) => ({
    ...entry,
    base: Math.floor(entry.share),
  }));

  let remainder = totalCents - floored.reduce((sum, e) => sum + e.base, 0);

  const distributionOrder = floored
    .map((entry, index) => ({
      index,
      fraction: entry.share - entry.base,
    }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const amounts = floored.map((entry) => entry.base);
  for (const candidate of distributionOrder) {
    if (remainder === 0) break;
    amounts[candidate.index] += 1;
    remainder -= 1;
  }

  return inputs.map((input, index) => ({
    id: input.id,
    amountCents: amounts[index],
  }));
}
