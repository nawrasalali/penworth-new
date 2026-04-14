// Export all Inngest functions
export { writeBook } from './write-book';

// Re-export all functions as array for serve()
import { writeBook } from './write-book';

export const functions = [writeBook];
