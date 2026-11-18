import { runLevelTask, type LevelTask } from './level-tasks';

self.onmessage = (event: MessageEvent<{ id: number; task: LevelTask }>) => {
  const { id, task } = event.data;
  try { self.postMessage({ id, session: runLevelTask(task) }); }
  catch { self.postMessage({ id, error: 'Could not prepare this route.' }); }
};
