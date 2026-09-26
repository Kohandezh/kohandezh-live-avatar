import type {
  AdminLibraryEntry,
  LibraryLanguage,
  LibrarySectionType,
  LibraryTechnical,
} from '@/entities/library-entry';

/** The fields an admin may edit in place (REQ-005), as the form holds them. */
export interface EntryFormValues {
  question: string;
  answerText: string;
  language: LibraryLanguage;
  category: string;
  categoryTitle: string;
  sectionType: LibrarySectionType;
  technical: LibraryTechnical;
}

export type EntryField = keyof EntryFormValues;

export function formValuesOf(entry: AdminLibraryEntry): EntryFormValues {
  return {
    question: entry.question,
    answerText: entry.answerText ?? '',
    language: entry.language,
    category: entry.category,
    categoryTitle: entry.categoryTitle,
    sectionType: entry.sectionType,
    technical: entry.technical,
  };
}

/** Fields that may not be empty. The server refuses them with `422`. */
const REQUIRED_FIELDS: readonly EntryField[] = [
  'question',
  'category',
  'categoryTitle',
];

export function isBlank(values: EntryFormValues, field: EntryField): boolean {
  return REQUIRED_FIELDS.includes(field) && values[field].trim().length === 0;
}
