// English is the source locale. Every key added here must also be added to hi.ts and kn.ts
// (tests/i18n.test.ts fails otherwise). Use {name} placeholders for dynamic values.
export const en = {
  "app.loading": "Loading...",
  "lang.label": "Language",
  "lang.en": "English",
  "lang.hi": "हिन्दी",
  "lang.kn": "ಕನ್ನಡ",
  "review.marker": "Needs native-speaker review",
  "review.banner": "This translation is a draft and needs native-speaker review.",
  "home.title": "Welcome to {business}",
  "home.tagline": "One shared view of sessions, attendance and progress.",
} as const;

export type MessageKey = keyof typeof en;
