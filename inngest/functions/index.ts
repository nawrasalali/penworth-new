// Export all Inngest functions
export { writeBook } from './write-book';
export { writeChapter } from './write-chapter';
export { restartAgent } from './restart-agent';

// Re-export all functions as array for serve()
import { writeBook } from './write-book';
import { writeChapter } from './write-chapter';
import { restartAgent } from './restart-agent';

export const functions = [writeBook, writeChapter, restartAgent];
