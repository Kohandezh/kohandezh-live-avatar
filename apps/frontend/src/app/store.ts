import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { avatarSessionReducer } from '@/features/avatar-session';
import { eventLogReducer } from '@/features/diagnostics';
import { recordingReducer } from '@/features/recording';
import { persistSettings, settingsReducer } from '@/features/settings';
import { composerReducer } from '@/features/text-to-speech';

// Client-owned state only. Server state belongs to TanStack Query (ARCHITECTURE.md).
const rootReducer = combineReducers({
  settings: settingsReducer,
  // Avatar workbench: which session this tab holds, the composer draft, the Egress
  // recording handle, and the diagnostics trace.
  avatarSession: avatarSessionReducer,
  composer: composerReducer,
  recording: recordingReducer,
  diagnostics: eventLogReducer,
});

export type RootState = ReturnType<typeof rootReducer>;

/** Creates a fresh store. Tests call this to avoid shared state. */
export function createStore(preloadedState?: Partial<RootState>) {
  const store = configureStore({
    reducer: rootReducer,
    preloadedState,
  });

  store.subscribe(() => {
    persistSettings(store.getState().settings);
  });

  return store;
}

export const store = createStore();

export type AppStore = ReturnType<typeof createStore>;
export type AppDispatch = AppStore['dispatch'];

/** Typed hooks. Use these instead of the untyped react-redux ones. */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
