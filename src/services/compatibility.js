export function calculateCompatibility(myProfile, theirProfile) {
  const report = generateCompatibilityReport(myProfile, theirProfile);
  return report.score;
}

export function generateCompatibilityReport(myProfile, theirProfile) {
  const myInterests = myProfile?.interests ?? [];
  const theirInterests = theirProfile?.interests ?? [];
  const myBasics = myProfile?.basics ?? {};
  const theirBasics = theirProfile?.basics ?? {};

  const sharedInterests = myInterests.filter((i) => theirInterests.includes(i));

  let interestScore = null;
  if (myInterests.length > 0 && theirInterests.length > 0) {
    const union = new Set([...myInterests, ...theirInterests]);
    interestScore = sharedInterests.length / union.size;
  }

  const comparableKeys = Object.keys(myBasics).filter((key) => theirBasics[key] !== undefined);
  const matchingFields = [];
  const differingFields = [];

  for (const key of comparableKeys) {
    if (myBasics[key] === theirBasics[key]) {
      matchingFields.push({ key, value: myBasics[key] });
    } else {
      differingFields.push({ key, myValue: myBasics[key], theirValue: theirBasics[key] });
    }
  }

  let basicsScore = null;
  if (comparableKeys.length > 0) {
    basicsScore = matchingFields.length / comparableKeys.length;
  }

  let score = null;
  if (interestScore !== null && basicsScore !== null) {
    score = Math.round((interestScore * 0.6 + basicsScore * 0.4) * 100);
  } else if (interestScore !== null) {
    score = Math.round(interestScore * 100);
  } else if (basicsScore !== null) {
    score = Math.round(basicsScore * 100);
  }

  return {
    score,
    sharedInterests,
    matchingFields,
    differingFields,
  };
}