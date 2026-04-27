// Export all Inngest functions
export { writeBook } from './write-book';
export { writeChapter } from './write-chapter';
export { restartAgent } from './restart-agent';
export { stripeReconcile } from './stripe-reconcile';

// Re-export all functions as array for serve()
import { writeBook } from './write-book';
import { writeChapter } from './write-chapter';
import { restartAgent } from './restart-agent';
import { stripeReconcile } from './stripe-reconcile';

export const functions = [writeBook, writeChapter, restartAgent, stripeReconcile];
