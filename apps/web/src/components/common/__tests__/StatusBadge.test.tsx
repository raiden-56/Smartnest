import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/render';
import { ConnectivityBadge, DemoBadge } from '../StatusBadge';

describe('status badges', () => {
  it.each([
    ['online', 'Online'],
    ['offline', 'Offline'],
    ['unavailable', 'Unavailable'],
    ['unknown', 'Unknown'],
  ] as const)('maps %s connectivity to a text label (not colour alone)', (state, label) => {
    renderWithProviders(<ConnectivityBadge state={state} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows "Integration disconnected" instead of a connectivity guess', () => {
    renderWithProviders(<ConnectivityBadge state="online" integrationDisconnected />);
    expect(screen.getByText('Integration disconnected')).toBeInTheDocument();
    expect(screen.queryByText('Online')).not.toBeInTheDocument();
  });

  it('labels demo data', () => {
    renderWithProviders(<DemoBadge />);
    expect(screen.getByText('Demo data')).toBeInTheDocument();
  });
});
