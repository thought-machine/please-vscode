export type Language = 'plz' | 'go' | 'python';

// Debug IDs for different languages required by the extension.
export const LANGUAGE_DEBUG_IDS: Partial<Record<Language, string>> = {
  go: 'plz-go',
  python: 'plz-python',
};

// Mapping between rules and their language that are debuggable.
export const DEBUGGABLE_LANGUAGE_RULES: Record<string, Language> = {
  go_binary: 'go',
  go_test: 'go',
  python_binary: 'python',
  python_test: 'python',
};
