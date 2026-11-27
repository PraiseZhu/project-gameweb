export async function runRepairLoop({ initial, audit, repair }) {
  const rounds = [];
  const occurrences = new Map();
  let input = initial;
  let previousCount = Infinity;
  for (let round = 0; round <= 2; round++) {
    const report = await audit(input, round);
    const unresolved = report.problems.map(({ id }) => id);
    if (unresolved.some((id) => typeof id !== 'string' || !id) || new Set(unresolved).size !== unresolved.length) {
      throw new Error('返修问题须有唯一且稳定的标识');
    }
    rounds.push(report);
    for (const id of unresolved) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
    if (!unresolved.length) return { status: 'pass', rounds };
    const reason = unresolved.some((id) => occurrences.get(id) >= 3) ? 'same-problem'
      : unresolved.length >= previousCount ? 'no-improvement' : round === 2 ? 'repair-limit' : !repair ? 'no-repair-provider' : null;
    if (reason) return { status: 'needs-human-decision', reason, rounds,
      choices: ['continue-fix', 'manual-waiver-with-reason'] };
    previousCount = unresolved.length;
    input = await repair({ input, round: round + 1, problems: report.problems });
  }
}
