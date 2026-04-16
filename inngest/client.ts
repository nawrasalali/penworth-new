import { Inngest } from 'inngest';

// Event types
export interface BookWriteEventData {
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
}

export interface ChapterRegenerateEventData {
  projectId: string;
  chapterId: string;
  userId: string;
  instructions?: string;
}

export interface BookExportEventData {
  projectId: string;
  userId: string;
  format: 'pdf' | 'docx' | 'epub';
}

// Create Inngest client
export const inngest = new Inngest({
  id: 'penworth',
});
