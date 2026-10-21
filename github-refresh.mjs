// Runs once a day at 03:17 UTC: pulls your newest GitHub repositories and
// clears old rate-limit rows. Netlify starts it on its schedule; it has no web
// address, so nobody else can trigger it. (To run it by hand: the Functions
// page in Netlify → github-refresh → Run now.)
import { runDailyJob } from '../../lib/app.js';

export default async () => {
  const result = await runDailyJob();
  console.log('Daily job:', JSON.stringify(result));
};

export const config = {
  schedule: '17 3 * * *'
};
