import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Capability, DeviceDto } from '@smartnest/shared';
import { renderWithProviders } from '../../../test/render';
import { DeviceReadings, FullDeviceControls, QuickControl } from '../CapabilityControls';

function device(caps: Capability[], over: Partial<DeviceDto> = {}): DeviceDto {
  return {
    id: 'd1', homeId: 'h1', integrationId: 'i1', integrationType: 'demo', integrationName: 'Demo', isDemo: true, externalId: 'x', name: 'Test Device', category: 'lighting',
    deviceType: null, manufacturer: null, model: null, roomId: null, roomName: null, isFavourite: false, isHidden: false, capabilities: caps, state: {},
    connectivity: 'online', stateUpdatedAt: null, lastSeenAt: null, lastCommandAt: null, lastError: null, integrationDisconnected: false, createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('capability-based controls', () => {
  it('renders only the controls a device declares', () => {
    renderWithProviders(<FullDeviceControls device={device([{ type: 'onOff' }], { state: { on: true } })} />);
    expect(screen.getByRole('checkbox', { name: /power/i })).toBeChecked();
    expect(screen.queryByRole('slider', { name: /brightness/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unlock|lock/i })).not.toBeInTheDocument();
  });

  it('adds a brightness slider only for dimmable lights', () => {
    renderWithProviders(<FullDeviceControls device={device([{ type: 'onOff' }, { type: 'brightness', min: 0, max: 100 }], { state: { on: true, brightness: 40 } })} />);
    expect(screen.getByRole('slider', { name: /brightness/i })).toHaveValue('40');
  });

  it('shows the right lock action for the reported state', () => {
    renderWithProviders(<FullDeviceControls device={device([{ type: 'lock' }], { category: 'access', state: { lockState: 'locked', locked: true } })} />);
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeEnabled();
  });

  it('only offers HVAC modes the device supports', () => {
    renderWithProviders(<FullDeviceControls device={device([{ type: 'hvacMode', modes: ['off', 'heat'] }], { category: 'climate', state: { hvacMode: 'heat' } })} />);
    expect(screen.getByRole('button', { name: 'Heat' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Cool' })).not.toBeInTheDocument();
  });

  it('disables controls and explains why when the device is offline', () => {
    renderWithProviders(<FullDeviceControls device={device([{ type: 'onOff' }], { connectivity: 'offline', state: { on: false } })} />);
    expect(screen.getByText(/device is offline/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /power/i })).toBeDisabled();
  });

  it('disables controls when the integration is disconnected', () => {
    renderWithProviders(<FullDeviceControls device={device([{ type: 'onOff' }], { integrationDisconnected: true, connectivity: 'unknown' })} />);
    expect(screen.getByText(/integration for this device is disconnected/i)).toBeInTheDocument();
  });

  it('tells the user when a device has no controls at all', () => {
    renderWithProviders(<FullDeviceControls device={device([{ type: 'motion' }, { type: 'battery' }])} />);
    expect(screen.getByText(/only reports information/i)).toBeInTheDocument();
  });

  it('never invents readings — missing values say "Not available"', () => {
    renderWithProviders(<DeviceReadings device={device([{ type: 'sensor', measurement: 'co2', unit: 'ppm', key: 'co2', label: 'CO₂' }, { type: 'battery' }], { state: {} })} />);
    expect(screen.getAllByText('Not available')).toHaveLength(2);
  });

  it('shows a reading-only device headline instead of a control in cards', () => {
    renderWithProviders(<QuickControl device={device([{ type: 'sensor', measurement: 'humidity', unit: '%', key: 'humidity' }], { state: { measurements: { humidity: 55 } } })} />);
    expect(screen.getByText('55 %')).toBeInTheDocument();
  });
});
