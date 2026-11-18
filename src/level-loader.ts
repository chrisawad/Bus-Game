import { runLevelTaskCooperatively, type LevelTask, type Session } from './level-tasks';

let worker: Worker | undefined;
let unavailable = false, sequence = 0;
const pending = new Map<number, { resolve: (session: Session) => void; reject: (error: Error) => void }>();

function getWorker() {
  if (unavailable) throw new Error('Route worker unavailable');
  if (worker) return worker;
  const active = new Worker(new URL('./level.worker.ts', import.meta.url), { type: 'module' });
  const fail = () => {
    unavailable = true; active.terminate(); worker = undefined;
    for (const job of pending.values()) job.reject(new Error('Route worker unavailable'));
    pending.clear();
  };
  active.onmessage = (event: MessageEvent<{ id: number; session?: Session; error?: string }>) => {
    const job = pending.get(event.data.id);
    if (!job) return;
    pending.delete(event.data.id);
    if (event.data.session) job.resolve(event.data.session);
    else job.reject(new Error(event.data.error));
  };
  active.onerror = event => { event.preventDefault(); fail(); };
  active.onmessageerror = fail;
  worker = active; return active;
}

export async function prepareLevel(task: LevelTask): Promise<Session> {
  try {
    const active = getWorker(), id = ++sequence;
    return await new Promise<Session>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { active.postMessage({ id, task }); }
      catch (error) { pending.delete(id); reject(error); }
    });
  } catch {
    return await runLevelTaskCooperatively(task);
  }
}
