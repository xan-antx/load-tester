// A rough, honest estimate of how many requests a run will send, and how
// many selected cases may get none (each virtual user picks a random case per
// request, see code/locust_tests/dynamic_locustfile.py). Pure function.
//
// Model: each user waits 0.5–2 s between requests (mean 1.25 s) plus the
// response time; users start at `spawnRate` per second.

const MEAN_WAIT_S = 1.25;
const ASSUMED_RESPONSE_S = 0.12;

function userSecondsFixed(users, spawnRate, duration) {
  const ramp = Math.min(users / Math.max(spawnRate, 1), duration);
  return users * (duration - ramp) + 0.5 * users * ramp;
}

export function estimateRun({ mode, users, spawnRate, duration, capPlan, caseCount, avgResponseMs }) {
  const perUser = 1 / (MEAN_WAIT_S + (avgResponseMs != null ? avgResponseMs / 1000 : ASSUMED_RESPONSE_S));
  let userSeconds = 0;
  if (mode === "capacity" && capPlan) {
    for (let u = capPlan.start; u <= capPlan.max; u += capPlan.step) userSeconds += u * capPlan.stepSeconds;
  } else {
    userSeconds = userSecondsFixed(users, spawnRate, duration);
  }
  const requests = Math.max(Math.round(userSeconds * perUser), 0);
  const n = Math.max(caseCount, 0);
  const perCase = n ? requests / n : 0;
  // Expected number of cases never picked: n · (1 − 1/n)^requests.
  const untested = n ? n * Math.pow(1 - 1 / n, requests) : 0;
  return { requests, perCase, untested: Math.round(untested * 10) / 10 };
}
