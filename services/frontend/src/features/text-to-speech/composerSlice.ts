import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// CLIENT STATE: the draft text the operator is working with, shared by Generate Audio, Send to
// Avatar and Record. The most recent generated audio asset id is remembered so a recording can
// reference it; the asset itself is server state (TanStack Query).
export interface ComposerState {
  text: string;
  lastAudioAssetId: string | null;
}

export const DEFAULT_COMPOSER_TEXT = 'سلام، من دستیار هوشمند دکتر کهندژ هستم.';
export const MAX_TEXT_LENGTH = 5000;

const initialState: ComposerState = { text: DEFAULT_COMPOSER_TEXT, lastAudioAssetId: null };

const slice = createSlice({
  name: 'composer',
  initialState,
  reducers: {
    setComposerText(state, action: PayloadAction<string>) {
      state.text = action.payload.slice(0, MAX_TEXT_LENGTH);
    },
    setLastAudioAssetId(state, action: PayloadAction<string | null>) {
      state.lastAudioAssetId = action.payload;
    },
  },
});

export const { setComposerText, setLastAudioAssetId } = slice.actions;
export const composerReducer = slice.reducer;

export interface WithComposer {
  composer: ComposerState;
}
export const selectComposerText = (state: WithComposer) => state.composer.text;
export const selectLastAudioAssetId = (state: WithComposer) => state.composer.lastAudioAssetId;
