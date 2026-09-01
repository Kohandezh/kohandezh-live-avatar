import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@shared/i18n';
import { AsyncState } from './AsyncState';
import { ApiError } from '@shared/api/errors';

const wrap = (ui: ReactElement) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe('AsyncState', () => {
  it('renders loading', () => {
    wrap(<AsyncState isLoading isError={false} error={null} data={undefined}>{() => 'x'}</AsyncState>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
  it('renders empty', () => {
    wrap(<AsyncState isLoading={false} isError={false} error={null} data={[]} isEmpty={(d) => d.length === 0}>{() => 'x'}</AsyncState>);
    expect(screen.getByText(i18n.t('state.empty'))).toBeInTheDocument();
  });
  it('renders error with retry only when retryable', () => {
    wrap(<AsyncState isLoading={false} isError error={new ApiError(401, 'UNAUTHORIZED', 'no')} data={undefined} refetch={() => {}}>{() => 'x'}</AsyncState>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('renders data', () => {
    wrap(<AsyncState isLoading={false} isError={false} error={null} data={{ n: 1 }}>{(d) => <span>{d.n}</span>}</AsyncState>);
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
