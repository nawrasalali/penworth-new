import { Inngest } from 'inngest';

// Create Inngest client
export const inngest = new Inngest({
  id: 'penworth',
  name: 'Penworth',
});

// Event types
export interface BookWriteEvent {
  name: 'book/write';
  data: {
    projectId: string;
    userId: string;
    title: string;
    description: string;
    outline: {
      chapters: Array<{
        title: string;
        description: string;
        keyPoints: string[];
      }>;
    };
    industry: string;
    voiceProfile?: {
      tone: string;
      style: string;
      vocabulary: string;
    };
  };
}

export interface ChapterRegenerateEvent {
  name: 'chapter/regenerate';
  data: {
    projectId: string;
    chapterId: string;
    userId: string;
    instructions?: string;
  };
}

export interface BookExportEvent {
  name: 'book/export';
  data: {
    projectId: string;
    userId: string;
    format: 'pdf' | 'docx' | 'epub';
  };
}

// Union type for all events
export type PenworthEvents = BookWriteEvent | ChapterRegenerateEvent | BookExportEvent;
