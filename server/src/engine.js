export function resolveCombat({ aliveIds, hp: currentHp, answers, correctIndex }) {
  if (aliveIds.length < 2 || aliveIds.length > 3) throw new Error('Combat requires two or three living players.');
  const correct = aliveIds
    .filter((id) => answers[id]?.optionIndex === correctIndex)
    .sort((left, right) => (answers[left]?.receivedAt ?? Infinity) - (answers[right]?.receivedAt ?? Infinity));
  const fastestAt = correct.length ? answers[correct[0]].receivedAt : undefined;
  const tiedFastest = correct.filter((id) => answers[id].receivedAt === fastestAt);
  const fastestCorrectId = tiedFastest.length === 1 ? tiedFastest[0] : undefined;
  const damagedIds = tiedFastest.length ? aliveIds.filter((id) => !tiedFastest.includes(id)) : [...aliveIds];
  const hp = { ...currentHp };
  for (const id of damagedIds) hp[id] = Math.max(0, (hp[id] ?? 0) - 1);
  let survivors = aliveIds.filter((id) => hp[id] > 0);
  const clashPoint = survivors.length === 0;
  if (clashPoint) {
    for (const id of aliveIds) hp[id] = 1;
    survivors = [...aliveIds];
  }
  return { hp, survivors, damagedIds, fastestCorrectId, clashPoint };
}

export function resolveRpsCombat({ aliveIds, hp: currentHp, answers }) {
  if (aliveIds.length < 2 || aliveIds.length > 3) throw new Error('Combat requires two or three living players.');
  const answeredIds = aliveIds.filter((id) => Number.isInteger(answers[id]?.optionIndex) && answers[id].optionIndex >= 0 && answers[id].optionIndex <= 2);
  const timedOutIds = aliveIds.filter((id) => !answeredIds.includes(id));
  let damagedIds = [];
  let winnerIds = [];
  let draw = false;

  if (timedOutIds.length) {
    damagedIds = timedOutIds.length === aliveIds.length ? [...aliveIds] : timedOutIds;
    winnerIds = aliveIds.filter((id) => !damagedIds.includes(id));
  } else {
    const moves = [...new Set(aliveIds.map((id) => answers[id].optionIndex))];
    if (moves.length === 1 || moves.length === 3) {
      draw = true;
    } else {
      const beats = { 0: 2, 1: 0, 2: 1 };
      const winningMove = beats[moves[0]] === moves[1] ? moves[0] : moves[1];
      winnerIds = aliveIds.filter((id) => answers[id].optionIndex === winningMove);
      damagedIds = aliveIds.filter((id) => answers[id].optionIndex !== winningMove);
    }
  }

  const hp = { ...currentHp };
  for (const id of damagedIds) hp[id] = Math.max(0, (hp[id] ?? 0) - 1);
  let survivors = aliveIds.filter((id) => hp[id] > 0);
  const clashPoint = survivors.length === 0;
  if (clashPoint) {
    for (const id of aliveIds) hp[id] = 1;
    survivors = [...aliveIds];
  }
  return { hp, survivors, damagedIds, winnerIds, timedOutIds, draw, clashPoint };
}

export function createGroups(playerIds) {
  if (playerIds.length < 2) throw new Error('At least two players are required.');
  const groups = [];
  let cursor = 0;
  if (playerIds.length % 2 === 1) {
    groups.push(playerIds.slice(0, 3));
    cursor = 3;
  }
  while (cursor < playerIds.length) {
    groups.push(playerIds.slice(cursor, cursor + 2));
    cursor += 2;
  }
  return groups;
}

export const questionSeconds = (configuredSeconds) => Math.min(120, Math.max(20, Number(configuredSeconds) || 20));
export const difficultyFor = (activePlayers) => activePlayers > 12 ? 'basic' : 'scenario';
