import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// CLIENT STATE: the draft text the operator is working with, shared by Generate Audio, Send to
// Avatar and Record. The most recent generated audio is remembered with the text it was made
// from, so a recording can reference it and the screen can check its length (REQ-036). The
// asset itself is server state (TanStack Query).
export interface LastAudio {
  id: string;
  durationMs: number;
  text: string;
}

export interface ComposerState {
  text: string;
  lastAudio: LastAudio | null;
}

export const DEFAULT_COMPOSER_TEXT = 'سلام، من دستیار هوشمند دکتر کهندژ هستم.';
export const MAX_TEXT_LENGTH = 5000;

const initialState: ComposerState = { text: DEFAULT_COMPOSER_TEXT, lastAudio: null };

const slice = createSlice({
  name: 'composer',
  initialState,
  reducers: {
    setComposerText(state, action: PayloadAction<string>) {
      state.text = action.payload.slice(0, MAX_TEXT_LENGTH);
    },
    setLastAudio(state, action: PayloadAction<LastAudio | null>) {
      state.lastAudio = action.payload;
    },
  },
});

export const { setComposerText, setLastAudio } = slice.actions;
export const composerReducer = slice.reducer;

export interface WithComposer {
  composer: ComposerState;
}
export const selectComposerText = (state: WithComposer) => state.composer.text;
export const selectLastAudio = (state: WithComposer) => state.composer.lastAudio;
