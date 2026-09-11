import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { installMockApi, mockSession } from '@/data/mock';
import { AdminUsersPage } from '@/pages/admin/users/AdminUsersPage';
import { apiClient } from '@/shared/api';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('AdminUsersPage', () => {
  beforeEach(() => {
    installMockApi(apiClient, { delayMs: 0 });
    mockSession.set('u-admin');
  });

  it('shows loading, then the first page of users', async () => {
    renderWithProviders(<AdminUsersPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();

    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
    // header row + 10 data rows
    expect(screen.getAllByRole('row')).toHaveLength(11);
    expect(screen.getByText(/Page 1 of 6/)).toBeInTheDocument();
  });

  it('shows the empty state when the search matches nothing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);
    await screen.findByText('admin@example.com');

    await user.type(screen.getByRole('searchbox'), 'zzzz-nobody');

    expect(await screen.findByText('No users found')).toBeInTheDocument();
  });

  it('loads the next page from the pagination footer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);
    await screen.findByText('admin@example.com');

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(/Page 2 of 6/)).toBeInTheDocument();
    expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
  });

  it('shows the error state when the session is not an admin', async () => {
    mockSession.set('u-user');
    renderWithProviders(<AdminUsersPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong',
    );
  });
});
