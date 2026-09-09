import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import { redact } from '@/shared/utils';

// CLIENT STATE: an in-memory, per-tab event log for the development console. Nothing here comes
// from the server as a source of truth; it is a UI trace of what the client observed.
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEvent {
  id: string;
  at: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
}

export interface EventLogState {
  events: LogEvent[];
}

const MAX_EVENTS = 300;

const initialState: EventLogState = { events: [] };

const slice = createSlice({
  name: 'diagnostics',
  initialState,
  reducers: {
    logEvent: {
      reducer(state, action: PayloadAction<LogEvent>) {
        state.events.unshift(action.payload);
        if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
      },
      prepare(input: { level: LogLevel; source: string; message: string; data?: unknown }) {
        const event: LogEvent = {
          id: nanoid(),
          at: new Date().toISOString(),
          level: input.level,
          source: input.source,
          message: input.message,
        };
        // Anything that looks like a token or secret is redacted before it can reach the UI.
        if (input.data !== undefined) event.data = redact(input.data);
        return { payload: event };
      },
    },
    clearLog(state) {
      state.events = [];
    },
  },
});

export const { logEvent, clearLog } = slice.actions;
export const eventLogReducer = slice.reducer;

export interface WithEventLog {
  diagnostics: EventLogState;
}
export const selectLogEvents = (state: WithEventLog) => state.diagnostics.events;
