import {
  createKelpieQueue,
  type KelpieJobData,
  type KelpieJobName,
} from "./queue";

let queue: ReturnType<typeof createKelpieQueue> | null = null;

function getQueue() {
  if (!queue) queue = createKelpieQueue();
  return queue;
}

/** On-demand job enqueue for request-triggered work (e.g. an audit export), as opposed to the scheduled jobs in `schedulers.ts`. */
export async function enqueueKelpieJob(
  name: KelpieJobName,
  data: KelpieJobData = {},
): Promise<void> {
  await getQueue().add(name, data);
}
