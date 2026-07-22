export function calculateCompatibility(myProfile, theirProfile) {
  const myInterests = myProfile?.interests ?? [];
  const theirInterests = theirProfile?.interests ?? [];
  const myBasics = myProfile?.basics ?? {};
  const theirBasics = theirProfile?.basics ?? {};

  let interestScore = null;
  if (myInterests.length > 0 && theirInterests.length > 0) {
    const shared = myInterests.filter((i) => theirInterests.includes(i));
    const union = new Set([...myInterests, ...theirInterests]);
    interestScore = shared.length / union.size;
  }

  const comparableKeys = Object.keys(myBasics).filter((key) => theirBasics[key] !== undefined);
  let basicsScore = null;
  if (comparableKeys.length > 0) {
    const matching = comparableKeys.filter((key) => myBasics[key] === theirBasics[key]);
    basicsScore = matching.length / comparableKeys.length;
  }

  if (interestScore === null && basicsScore === null) return null;

  let combined;
  if (interestScore !== null && basicsScore !== null) {
    combined = interestScore * 0.6 + basicsScore * 0.4;
  } else {
    combined = interestScore !== null ? interestScore : basicsScore;
  }

  return Math.round(combined * 100);
}