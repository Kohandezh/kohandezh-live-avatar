import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server, fixtures } from '@/test/server';
import { renderWithProviders } from '@/test/render';
import { HealthStatusCard, HealthStatusChip } from './HealthStatus';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  close() {}
}

describe('HealthStatus', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('chip goes from checking to healthy', async () => {
    renderWithProviders(<HealthStatusChip />);
    expect(screen.getByText(/checking backend/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/all services healthy/i)).toBeInTheDocument());
  });

  it('card lists dependencies and reports degraded', async () => {
    server.use(
      http.get('*/api/health', () =>
        HttpResponse.json({
          ...fixtures.health,
          status: 'degraded',
          dependencies: {
            ...fixtures.health.dependencies,
            redis: { status: 'error', detail: 'ConnectionError' },
          },
        }),
      ),
    );
    renderWithProviders(<HealthStatusCard />);
    await waitFor(() => expect(screen.getByText(/backend degraded/i)).toBeInTheDocument());
    expect(screen.getByText(/ConnectionError/)).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    expect(FakeSocket.instances[0]?.url).toMatch(/\/api\/ws\/status$/);
  });

  it('card shows unreachable with retry when the backend is down', async () => {
    server.use(http.get('*/api/health', () => HttpResponse.error()));
    renderWithProviders(<HealthStatusCard />);
    // useBackendHealth retries once (1 s backoff) before reporting the failure.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/unreachable/i), {
      timeout: 5000,
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('heartbeat updates the active session count', async () => {
    renderWithProviders(<HealthStatusCard />);
    await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0));
    const socket = FakeSocket.instances[0]!;
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'system.status',
        active_sessions: 2,
        timestamp: '2026-09-01T10:00:05Z',
      }),
    });
    await waitFor(() => expect(screen.getByText(/active sessions: 2/i)).toBeInTheDocument());
  });
});
