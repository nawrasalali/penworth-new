// Export all Inngest functions
export { writeBook } from './write-book';
export { restartAgent } from './restart-agent';

// Re-export all functions as array for serve()
import { writeBook } from './write-book';
import { restartAgent } from './restart-agent';

export const functions = [writeBook, restartAgent];
