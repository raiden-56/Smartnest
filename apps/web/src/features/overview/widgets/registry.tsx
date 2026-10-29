import type { ComponentType } from 'react';
import type { WidgetType } from '@smartnest/shared';
import { AttentionWidget, ClimateWidget, FavouritesWidget, LowBatteryWidget, SecurityWidget } from './DeviceWidgets';
import { CameraWidget, QuickActionsWidget } from './SceneAndCameraWidgets';
import { ActivityWidget, AutomationsWidget, EnergyWidget, NetworkWidget, RoomsWidget, SummaryWidget } from './StatusWidgets';
import type { WidgetProps } from './WidgetFrame';

export const WIDGET_COMPONENTS: Record<WidgetType, ComponentType<WidgetProps>> = {
  summary: SummaryWidget,
  favourites: FavouritesWidget,
  rooms: RoomsWidget,
  quickActions: QuickActionsWidget,
  camera: CameraWidget,
  climate: ClimateWidget,
  activity: ActivityWidget,
  automations: AutomationsWidget,
  energy: EnergyWidget,
  network: NetworkWidget,
  security: SecurityWidget,
  lowBattery: LowBatteryWidget,
  attention: AttentionWidget,
};

/** Widgets that accept a device selection in their configuration. */
export const CONFIGURABLE_DEVICE: Partial<Record<WidgetType, { capability: string; label: string }>> = {
  camera: { capability: 'cameraStream', label: 'Camera to show' },
  climate: { capability: 'temperatureSetpoint', label: 'Climate device' },
};
