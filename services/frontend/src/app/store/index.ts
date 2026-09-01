import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import { eventLogReducer } from '@features/diagnostics';
import { composerReducer } from '@features/text-to-speech';
import { avatarSessionReducer } from '@features/avatar-session';
import { recordingReducer } from '@features/recording';
import { uiReducer } from './uiSlice';

// Every slice is client-owned UI state. Server data never lands here (TanStack Query owns it).
export const rootReducer = combineReducers({
  ui: uiReducer,
  diagnostics: eventLogReducer,
  composer: composerReducer,
  avatarSession: avatarSessionReducer,
  recording: recordingReducer,
});

export type RootState = ReturnType<typeof rootReducer>;

export function createAppStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: rootReducer,
    ...(preloadedState ? { preloadedState } : {}),
  });
}

export const store = createAppStore();

export type AppStore = ReturnType<typeof createAppStore>;
export type AppDispatch = AppStore['dispatch'];

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
