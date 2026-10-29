import { createApi, fetchBaseQuery, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react';
import type {
  ActivityDto,
  AuditLogDto,
  AutomationDto,
  AutomationExecutionDto,
  AutomationInput,
  AutomationIssue,
  CameraDto,
  CatalogueDto,
  CommandDto,
  CreateCommandRequest,
  DashboardDto,
  DashboardWidget,
  DeviceCountsDto,
  DeviceDto,
  DeviceListQuery,
  DiscoveredDeviceDto,
  EnergyDto,
  HomeDto,
  HomeSummaryDto,
  IntegrationDefinition,
  IntegrationDto,
  InvitationDto,
  MemberDto,
  NetworkDto,
  NotificationDto,
  Paginated,
  RoomDto,
  SceneDto,
  SceneExecutionDto,
  SceneInput,
  SearchResultDto,
  SessionDto,
  UserDto,
  UserPreferences,
  HomeRole,
} from '@smartnest/shared';

export interface ApiError {
  status: number | string;
  code: string;
  message: string;
  details?: unknown;
}

/** Normalise RTK Query errors into { status, code, message } for display. */
export function toApiError(err: unknown): ApiError {
  const e = err as FetchBaseQueryError & { data?: { error?: { code?: string; message?: string; details?: unknown } } };
  if (e && typeof e === 'object' && 'status' in e) {
    if (e.status === 'FETCH_ERROR') return { status: 0, code: 'network', message: 'Cannot reach the SmartNest server. Check your connection.' };
    if (e.status === 'TIMEOUT_ERROR') return { status: 0, code: 'timeout', message: 'The server took too long to respond.' };
    const body = e.data?.error;
    return { status: e.status, code: body?.code ?? 'error', message: body?.message ?? 'Something went wrong.', details: body?.details };
  }
  return { status: 0, code: 'unknown', message: (err as Error)?.message ?? 'Something went wrong.' };
}

export type DeviceListArgs = Partial<DeviceListQuery> & { homeId: string };
export type ActivityArgs = { homeId: string; limit?: number; cursor?: string; deviceId?: string; roomId?: string; category?: string; severity?: string; type?: string; source?: string; from?: string; to?: string; q?: string };
export type DeviceDetailDto = { device: DeviceDto; metadata: { energyRole: string | null; demoNote: string | null } };
export type ImportResult = { externalId: string; deviceId: string | null; status: 'imported' | 'already_imported' | 'not_found'; connectivity: string | null; tested: boolean; message: string | null };
export type CatalogueIntegration = IntegrationDefinition & { implemented: boolean };

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string>;

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api',
    credentials: 'include',
    timeout: 30_000,
    prepareHeaders: (h) => {
      h.set('X-SmartNest-CSRF', '1');
      return h;
    },
  }),
  tagTypes: [
    'Me', 'Homes', 'Home', 'Rooms', 'Devices', 'Device', 'DeviceCounts', 'Integrations', 'Discovered', 'Scenes', 'SceneExecutions', 'Automations',
    'AutomationExecutions', 'Activity', 'Notifications', 'Dashboard', 'Energy', 'Network', 'Cameras', 'Members', 'Invitations', 'Sessions', 'Audit', 'DeviceCommands',
  ],
  endpoints: (b) => ({
    // ─── Auth ───────────────────────────────────────────────────────────
    me: b.query<{ user: UserDto; preferences: UserPreferences }, void>({ query: () => '/auth/me', providesTags: ['Me'] }),
    login: b.mutation<{ user: UserDto }, { email: string; password: string }>({ query: (body) => ({ url: '/auth/login', method: 'POST', body }), invalidatesTags: ['Me', 'Homes'] }),
    register: b.mutation<{ user: UserDto }, { name: string; email: string; password: string }>({ query: (body) => ({ url: '/auth/register', method: 'POST', body }), invalidatesTags: ['Me', 'Homes'] }),
    logout: b.mutation<void, void>({ query: () => ({ url: '/auth/logout', method: 'POST' }) }),
    forgotPassword: b.mutation<{ message: string }, { email: string }>({ query: (body) => ({ url: '/auth/forgot-password', method: 'POST', body }) }),
    resetPassword: b.mutation<{ ok: true }, { token: string; password: string }>({ query: (body) => ({ url: '/auth/reset-password', method: 'POST', body }) }),
    reauth: b.mutation<{ ok: true }, { password: string }>({ query: (body) => ({ url: '/auth/reauth', method: 'POST', body }) }),
    updateProfile: b.mutation<{ user: UserDto }, { name: string }>({ query: (body) => ({ url: '/auth/profile', method: 'PATCH', body }), invalidatesTags: ['Me'] }),
    changePassword: b.mutation<{ ok: true }, { currentPassword: string; newPassword: string }>({ query: (body) => ({ url: '/auth/change-password', method: 'POST', body }), invalidatesTags: ['Sessions'] }),
    sessions: b.query<{ sessions: SessionDto[] }, void>({ query: () => '/auth/sessions', providesTags: ['Sessions'] }),
    revokeSession: b.mutation<void, string>({ query: (id) => ({ url: `/auth/sessions/${id}`, method: 'DELETE' }), invalidatesTags: ['Sessions'] }),
    updatePreferences: b.mutation<{ preferences: UserPreferences }, UserPreferences>({ query: (body) => ({ url: '/auth/preferences', method: 'PUT', body }), invalidatesTags: ['Me', 'Energy'] }),

    // ─── Homes & members ────────────────────────────────────────────────
    homes: b.query<{ homes: HomeSummaryDto[] }, void>({ query: () => '/homes', providesTags: ['Homes'] }),
    home: b.query<{ home: HomeDto }, string>({ query: (id) => `/homes/${id}`, providesTags: ['Home'] }),
    createHome: b.mutation<{ home: HomeDto }, { name: string; timezone: string; locale?: string; temperatureUnit?: 'C' | 'F' }>({ query: (body) => ({ url: '/homes', method: 'POST', body }), invalidatesTags: ['Homes'] }),
    createDemoHome: b.mutation<{ home: HomeDto }, { timezone: string }>({ query: (body) => ({ url: '/homes/demo', method: 'POST', body }), invalidatesTags: ['Homes'] }),
    updateHome: b.mutation<{ home: HomeDto }, { homeId: string } & Record<string, unknown>>({ query: ({ homeId, ...body }) => ({ url: `/homes/${homeId}`, method: 'PATCH', body }), invalidatesTags: ['Home', 'Homes', 'Energy'] }),
    completeOnboarding: b.mutation<{ home: HomeDto }, string>({ query: (homeId) => ({ url: `/homes/${homeId}/onboarding-complete`, method: 'POST' }), invalidatesTags: ['Home'] }),
    addDemoIntegration: b.mutation<{ ok: true }, string>({ query: (homeId) => ({ url: `/homes/${homeId}/demo-integration`, method: 'POST' }), invalidatesTags: ['Rooms', 'Devices', 'DeviceCounts', 'Integrations', 'Scenes', 'Automations', 'Energy'] }),
    deleteHome: b.mutation<void, string>({ query: (homeId) => ({ url: `/homes/${homeId}`, method: 'DELETE' }), invalidatesTags: ['Homes'] }),
    deleteHomeData: b.mutation<{ deleted: Record<string, number> }, { homeId: string; activity?: boolean; history?: boolean; energy?: boolean; commands?: boolean; notifications?: boolean }>({
      query: ({ homeId, ...body }) => ({ url: `/homes/${homeId}/delete-data`, method: 'POST', body }),
      invalidatesTags: ['Activity', 'Energy', 'Notifications', 'DeviceCommands', 'SceneExecutions', 'AutomationExecutions'],
    }),
    members: b.query<{ members: MemberDto[] }, string>({ query: (homeId) => `/homes/${homeId}/members`, providesTags: ['Members'] }),
    updateMember: b.mutation<void, { homeId: string; memberId: string; role: HomeRole }>({ query: ({ homeId, memberId, role }) => ({ url: `/homes/${homeId}/members/${memberId}`, method: 'PATCH', body: { role } }), invalidatesTags: ['Members'] }),
    removeMember: b.mutation<void, { homeId: string; memberId: string }>({ query: ({ homeId, memberId }) => ({ url: `/homes/${homeId}/members/${memberId}`, method: 'DELETE' }), invalidatesTags: ['Members', 'Homes'] }),
    invitations: b.query<{ invitations: InvitationDto[] }, string>({ query: (homeId) => `/homes/${homeId}/invitations`, providesTags: ['Invitations'] }),
    invite: b.mutation<{ invitation: InvitationDto }, { homeId: string; email: string; role: Exclude<HomeRole, 'owner'> }>({ query: ({ homeId, ...body }) => ({ url: `/homes/${homeId}/invitations`, method: 'POST', body }), invalidatesTags: ['Invitations'] }),
    revokeInvitation: b.mutation<void, { homeId: string; inviteId: string }>({ query: ({ homeId, inviteId }) => ({ url: `/homes/${homeId}/invitations/${inviteId}`, method: 'DELETE' }), invalidatesTags: ['Invitations'] }),
    invitationPreview: b.query<{ homeName: string; role: HomeRole; invitedBy: string; email: string }, string>({ query: (token) => `/invitations/preview?token=${encodeURIComponent(token)}` }),
    acceptInvitation: b.mutation<{ homeId: string }, string>({ query: (token) => ({ url: '/invitations/accept', method: 'POST', body: { token } }), invalidatesTags: ['Homes'] }),
    audit: b.query<{ logs: AuditLogDto[] }, string>({ query: (homeId) => `/homes/${homeId}/audit`, providesTags: ['Audit'] }),

    // ─── Rooms ──────────────────────────────────────────────────────────
    rooms: b.query<{ rooms: RoomDto[] }, string>({ query: (homeId) => `/homes/${homeId}/rooms`, providesTags: ['Rooms'] }),
    createRoom: b.mutation<{ room: RoomDto }, { homeId: string; name: string; icon: string; coverImageUrl?: string | null }>({ query: ({ homeId, ...body }) => ({ url: `/homes/${homeId}/rooms`, method: 'POST', body }), invalidatesTags: ['Rooms'] }),
    updateRoom: b.mutation<{ room: RoomDto }, { homeId: string; roomId: string; name?: string; icon?: string; isFavourite?: boolean; coverImageUrl?: string | null }>({
      query: ({ homeId, roomId, ...body }) => ({ url: `/homes/${homeId}/rooms/${roomId}`, method: 'PATCH', body }),
      invalidatesTags: ['Rooms', 'Devices'],
    }),
    deleteRoom: b.mutation<void, { homeId: string; roomId: string }>({ query: ({ homeId, roomId }) => ({ url: `/homes/${homeId}/rooms/${roomId}`, method: 'DELETE' }), invalidatesTags: ['Rooms', 'Devices'] }),
    reorderRooms: b.mutation<void, { homeId: string; ids: string[] }>({ query: ({ homeId, ids }) => ({ url: `/homes/${homeId}/rooms/order`, method: 'PUT', body: { ids } }), invalidatesTags: ['Rooms'] }),
    roomAction: b.mutation<{ commands: CommandDto[]; targeted: number }, { homeId: string; roomId: string; action: 'lightsOn' | 'lightsOff' | 'allOff' }>({
      query: ({ homeId, roomId, action }) => ({ url: `/homes/${homeId}/rooms/${roomId}/actions`, method: 'POST', body: { action } }),
    }),

    // ─── Devices ────────────────────────────────────────────────────────
    devices: b.query<Paginated<DeviceDto>, DeviceListArgs>({
      query: ({ homeId, ...q }) => ({ url: `/homes/${homeId}/devices`, params: clean(q) }),
      providesTags: ['Devices'],
    }),
    deviceCounts: b.query<DeviceCountsDto, string>({ query: (homeId) => `/homes/${homeId}/devices/counts`, providesTags: ['DeviceCounts'] }),
    deviceFacets: b.query<{ manufacturers: string[]; categories: string[] }, string>({ query: (homeId) => `/homes/${homeId}/devices/facets`, providesTags: ['Devices'] }),
    device: b.query<DeviceDetailDto, { homeId: string; deviceId: string }>({ query: ({ homeId, deviceId }) => `/homes/${homeId}/devices/${deviceId}`, providesTags: (_r, _e, a) => [{ type: 'Device', id: a.deviceId }] }),
    updateDevice: b.mutation<{ device: DeviceDto }, { homeId: string; deviceId: string; name?: string; roomId?: string | null; isFavourite?: boolean; isHidden?: boolean; category?: string; energyRole?: string }>({
      query: ({ homeId, deviceId, ...body }) => ({ url: `/homes/${homeId}/devices/${deviceId}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Device', id: a.deviceId }, 'Devices', 'Rooms', 'DeviceCounts', 'Energy'],
    }),
    bulkUpdateDevices: b.mutation<{ updated: number }, { homeId: string; ids: string[]; update: { roomId?: string | null; isFavourite?: boolean; isHidden?: boolean } }>({
      query: ({ homeId, ...body }) => ({ url: `/homes/${homeId}/devices/bulk`, method: 'POST', body }),
      invalidatesTags: ['Devices', 'Rooms', 'DeviceCounts', 'Device'],
    }),
    removeDevice: b.mutation<void, { homeId: string; deviceId: string }>({ query: ({ homeId, deviceId }) => ({ url: `/homes/${homeId}/devices/${deviceId}`, method: 'DELETE' }), invalidatesTags: ['Devices', 'Rooms', 'DeviceCounts', 'Discovered', 'Integrations'] }),
    refreshDevice: b.mutation<{ device: DeviceDto }, { homeId: string; deviceId: string }>({ query: ({ homeId, deviceId }) => ({ url: `/homes/${homeId}/devices/${deviceId}/refresh`, method: 'POST' }) }),
    sendCommand: b.mutation<{ command: CommandDto }, { homeId: string; deviceId: string } & CreateCommandRequest>({
      query: ({ homeId, deviceId, ...body }) => ({ url: `/homes/${homeId}/devices/${deviceId}/commands`, method: 'POST', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'DeviceCommands', id: a.deviceId }],
    }),
    deviceCommands: b.query<{ commands: CommandDto[] }, { homeId: string; deviceId: string }>({ query: ({ homeId, deviceId }) => `/homes/${homeId}/devices/${deviceId}/commands`, providesTags: (_r, _e, a) => [{ type: 'DeviceCommands', id: a.deviceId }] }),
    command: b.query<{ command: CommandDto }, { homeId: string; commandId: string }>({ query: ({ homeId, commandId }) => `/homes/${homeId}/commands/${commandId}` }),
    deviceHistory: b.query<{ history: { t: string; state: Record<string, unknown>; connectivity: string }[] }, { homeId: string; deviceId: string; hours?: number }>({
      query: ({ homeId, deviceId, hours = 24 }) => `/homes/${homeId}/devices/${deviceId}/history?hours=${hours}`,
    }),

    // ─── Integrations ───────────────────────────────────────────────────
    integrationCatalogue: b.query<{ integrations: CatalogueIntegration[] }, void>({ query: () => '/catalogue/integrations' }),
    deviceCatalogue: b.query<CatalogueDto, void>({ query: () => '/catalogue/devices' }),
    integrations: b.query<{ integrations: IntegrationDto[] }, string>({ query: (homeId) => `/homes/${homeId}/integrations`, providesTags: ['Integrations'] }),
    integration: b.query<{ integration: IntegrationDto; definition: IntegrationDefinition }, { homeId: string; integrationId: string }>({
      query: ({ homeId, integrationId }) => `/homes/${homeId}/integrations/${integrationId}`,
      providesTags: ['Integrations'],
    }),
    connectHomeAssistant: b.mutation<{ integration: IntegrationDto; discovered: DiscoveredDeviceDto[] }, { homeId: string; name: string; baseUrl: string; accessToken: string }>({
      query: ({ homeId, ...body }) => ({ url: `/homes/${homeId}/integrations/home-assistant`, method: 'POST', body }),
      invalidatesTags: ['Integrations', 'Discovered'],
    }),
    connectDemo: b.mutation<{ integration: IntegrationDto }, string>({ query: (homeId) => ({ url: `/homes/${homeId}/integrations/demo`, method: 'POST' }), invalidatesTags: ['Integrations'] }),
    discover: b.mutation<{ discovered: DiscoveredDeviceDto[] }, { homeId: string; integrationId: string }>({
      query: ({ homeId, integrationId }) => ({ url: `/homes/${homeId}/integrations/${integrationId}/discover`, method: 'POST' }),
      invalidatesTags: ['Discovered', 'Integrations'],
    }),
    discovered: b.query<{ discovered: DiscoveredDeviceDto[] }, { homeId: string; integrationId: string }>({
      query: ({ homeId, integrationId }) => `/homes/${homeId}/integrations/${integrationId}/discovered`,
      providesTags: ['Discovered'],
    }),
    importDevices: b.mutation<{ results: ImportResult[] }, { homeId: string; integrationId: string; devices: { externalId: string; name: string; roomId: string | null }[] }>({
      query: ({ homeId, integrationId, devices }) => ({ url: `/homes/${homeId}/integrations/${integrationId}/import`, method: 'POST', body: { devices } }),
      invalidatesTags: ['Devices', 'DeviceCounts', 'Rooms', 'Discovered', 'Integrations'],
    }),
    integrationHealth: b.mutation<{ ok: boolean; message?: string }, { homeId: string; integrationId: string }>({ query: ({ homeId, integrationId }) => ({ url: `/homes/${homeId}/integrations/${integrationId}/health`, method: 'POST' }) }),
    reconnectIntegration: b.mutation<{ integration: IntegrationDto }, { homeId: string; integrationId: string; accessToken?: string; baseUrl?: string }>({
      query: ({ homeId, integrationId, ...body }) => ({ url: `/homes/${homeId}/integrations/${integrationId}/reconnect`, method: 'POST', body }),
      invalidatesTags: ['Integrations', 'Devices'],
    }),
    disconnectIntegration: b.mutation<{ integration: IntegrationDto }, { homeId: string; integrationId: string }>({
      query: ({ homeId, integrationId }) => ({ url: `/homes/${homeId}/integrations/${integrationId}/disconnect`, method: 'POST' }),
      invalidatesTags: ['Integrations', 'Devices', 'DeviceCounts', 'Automations'],
    }),
    removeIntegration: b.mutation<void, { homeId: string; integrationId: string }>({
      query: ({ homeId, integrationId }) => ({ url: `/homes/${homeId}/integrations/${integrationId}`, method: 'DELETE' }),
      invalidatesTags: ['Integrations', 'Devices', 'DeviceCounts', 'Rooms', 'Scenes', 'Automations'],
    }),
    syncAutomations: b.mutation<{ count: number }, { homeId: string; integrationId: string }>({
      query: ({ homeId, integrationId }) => ({ url: `/homes/${homeId}/integrations/${integrationId}/sync-automations`, method: 'POST' }),
      invalidatesTags: ['Automations'],
    }),

    // ─── Cameras ────────────────────────────────────────────────────────
    cameras: b.query<{ cameras: CameraDto[] }, string>({ query: (homeId) => `/homes/${homeId}/cameras`, providesTags: ['Cameras'] }),
    cameraToken: b.mutation<{ snapshotUrl: string; streamUrl: string; expiresIn: number }, { homeId: string; deviceId: string }>({
      query: ({ homeId, deviceId }) => ({ url: `/homes/${homeId}/cameras/${deviceId}/token`, method: 'POST' }),
    }),

    // ─── Scenes ─────────────────────────────────────────────────────────
    scenes: b.query<{ scenes: SceneDto[] }, string>({ query: (homeId) => `/homes/${homeId}/scenes`, providesTags: ['Scenes'] }),
    scene: b.query<{ scene: SceneDto }, { homeId: string; sceneId: string }>({ query: ({ homeId, sceneId }) => `/homes/${homeId}/scenes/${sceneId}`, providesTags: ['Scenes'] }),
    createScene: b.mutation<{ scene: SceneDto }, { homeId: string } & SceneInput>({ query: ({ homeId, ...body }) => ({ url: `/homes/${homeId}/scenes`, method: 'POST', body }), invalidatesTags: ['Scenes'] }),
    updateScene: b.mutation<{ scene: SceneDto }, { homeId: string; sceneId: string } & SceneInput>({ query: ({ homeId, sceneId, ...body }) => ({ url: `/homes/${homeId}/scenes/${sceneId}`, method: 'PUT', body }), invalidatesTags: ['Scenes'] }),
    favouriteScene: b.mutation<{ scene: SceneDto }, { homeId: string; sceneId: string; isFavourite: boolean }>({
      query: ({ homeId, sceneId, isFavourite }) => ({ url: `/homes/${homeId}/scenes/${sceneId}`, method: 'PATCH', body: { isFavourite } }),
      invalidatesTags: ['Scenes'],
    }),
    duplicateScene: b.mutation<{ scene: SceneDto }, { homeId: string; sceneId: string }>({ query: ({ homeId, sceneId }) => ({ url: `/homes/${homeId}/scenes/${sceneId}/duplicate`, method: 'POST' }), invalidatesTags: ['Scenes'] }),
    deleteScene: b.mutation<void, { homeId: string; sceneId: string }>({ query: ({ homeId, sceneId }) => ({ url: `/homes/${homeId}/scenes/${sceneId}`, method: 'DELETE' }), invalidatesTags: ['Scenes'] }),
    activateScene: b.mutation<{ execution: SceneExecutionDto }, { homeId: string; sceneId: string; confirmed?: boolean }>({
      query: ({ homeId, sceneId, confirmed }) => ({ url: `/homes/${homeId}/scenes/${sceneId}/activate`, method: 'POST', body: { confirmed } }),
    }),
    sceneExecutions: b.query<{ executions: SceneExecutionDto[] }, { homeId: string; sceneId: string }>({
      query: ({ homeId, sceneId }) => `/homes/${homeId}/scenes/${sceneId}/executions`,
      providesTags: ['SceneExecutions'],
    }),

    // ─── Automations ────────────────────────────────────────────────────
    automations: b.query<{ automations: AutomationDto[] }, string>({ query: (homeId) => `/homes/${homeId}/automations`, providesTags: ['Automations'] }),
    automation: b.query<{ automation: AutomationDto }, { homeId: string; automationId: string }>({ query: ({ homeId, automationId }) => `/homes/${homeId}/automations/${automationId}`, providesTags: ['Automations'] }),
    validateAutomation: b.mutation<{ valid: boolean; issues: AutomationIssue[] }, { homeId: string; id?: string; automation: unknown }>({
      query: ({ homeId, ...body }) => ({ url: `/homes/${homeId}/automations/validate`, method: 'POST', body }),
    }),
    createAutomation: b.mutation<{ automation: AutomationDto; issues: AutomationIssue[] }, { homeId: string } & AutomationInput>({
      query: ({ homeId, ...body }) => ({ url: `/homes/${homeId}/automations`, method: 'POST', body }),
      invalidatesTags: ['Automations'],
    }),
    updateAutomation: b.mutation<{ automation: AutomationDto; issues: AutomationIssue[] }, { homeId: string; automationId: string } & AutomationInput>({
      query: ({ homeId, automationId, ...body }) => ({ url: `/homes/${homeId}/automations/${automationId}`, method: 'PUT', body }),
      invalidatesTags: ['Automations'],
    }),
    setAutomationEnabled: b.mutation<{ automation: AutomationDto }, { homeId: string; automationId: string; enabled: boolean }>({
      query: ({ homeId, automationId, enabled }) => ({ url: `/homes/${homeId}/automations/${automationId}/enabled`, method: 'POST', body: { enabled } }),
      invalidatesTags: ['Automations'],
    }),
    runAutomation: b.mutation<{ execution: AutomationExecutionDto | null; message?: string }, { homeId: string; automationId: string }>({
      query: ({ homeId, automationId }) => ({ url: `/homes/${homeId}/automations/${automationId}/run`, method: 'POST' }),
      invalidatesTags: ['AutomationExecutions', 'Automations'],
    }),
    simulateAutomation: b.mutation<{ execution: AutomationExecutionDto }, { homeId: string; automationId: string }>({
      query: ({ homeId, automationId }) => ({ url: `/homes/${homeId}/automations/${automationId}/simulate`, method: 'POST' }),
      invalidatesTags: ['AutomationExecutions'],
    }),
    duplicateAutomation: b.mutation<{ automation: AutomationDto }, { homeId: string; automationId: string }>({
      query: ({ homeId, automationId }) => ({ url: `/homes/${homeId}/automations/${automationId}/duplicate`, method: 'POST' }),
      invalidatesTags: ['Automations'],
    }),
    deleteAutomation: b.mutation<void, { homeId: string; automationId: string }>({ query: ({ homeId, automationId }) => ({ url: `/homes/${homeId}/automations/${automationId}`, method: 'DELETE' }), invalidatesTags: ['Automations'] }),
    automationExecutions: b.query<{ executions: AutomationExecutionDto[] }, { homeId: string; automationId: string }>({
      query: ({ homeId, automationId }) => `/homes/${homeId}/automations/${automationId}/executions`,
      providesTags: ['AutomationExecutions'],
    }),
    exportAutomations: b.mutation<{ format: string; automations: AutomationInput[] }, string>({ query: (homeId) => ({ url: `/homes/${homeId}/automations/export`, method: 'GET' }) }),
    importAutomations: b.mutation<{ results: { name: string; ok: boolean; id?: string; errors?: string[] }[] }, { homeId: string; data: unknown }>({
      query: ({ homeId, data }) => ({ url: `/homes/${homeId}/automations/import`, method: 'POST', body: data }),
      invalidatesTags: ['Automations'],
    }),

    // ─── Activity & notifications ───────────────────────────────────────
    activity: b.query<{ items: ActivityDto[]; nextCursor: string | null }, ActivityArgs>({
      query: ({ homeId, ...q }) => ({ url: `/homes/${homeId}/activity`, params: clean(q) }),
      providesTags: ['Activity'],
    }),
    notifications: b.query<{ items: NotificationDto[]; unread: number }, string>({ query: (homeId) => `/homes/${homeId}/notifications`, providesTags: ['Notifications'] }),
    markNotificationsRead: b.mutation<void, { homeId: string; ids?: string[] }>({
      query: ({ homeId, ids }) => ({ url: `/homes/${homeId}/notifications/read`, method: 'POST', body: { ids } }),
      invalidatesTags: ['Notifications'],
    }),

    // ─── Dashboard, energy, network, search ─────────────────────────────
    dashboard: b.query<DashboardDto, string>({ query: (homeId) => `/homes/${homeId}/dashboard`, providesTags: ['Dashboard'] }),
    saveDashboard: b.mutation<DashboardDto, { homeId: string; widgets: DashboardWidget[] }>({
      query: ({ homeId, widgets }) => ({ url: `/homes/${homeId}/dashboard`, method: 'PUT', body: { widgets } }),
      async onQueryStarted({ homeId, widgets }, { dispatch, queryFulfilled }) {
        const patch = dispatch(api.util.updateQueryData('dashboard', homeId, (d) => ({ ...d, widgets, isDefault: false })));
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),
    resetDashboard: b.mutation<DashboardDto, string>({ query: (homeId) => ({ url: `/homes/${homeId}/dashboard`, method: 'DELETE' }), invalidatesTags: ['Dashboard'] }),
    energy: b.query<EnergyDto, { homeId: string; range: 'live' | 'today' | '7d' | '30d' | 'custom'; from?: string; to?: string }>({
      query: ({ homeId, ...q }) => ({ url: `/homes/${homeId}/energy`, params: clean(q) }),
      providesTags: ['Energy'],
    }),
    network: b.query<NetworkDto, string>({ query: (homeId) => `/homes/${homeId}/network`, providesTags: ['Network'] }),
    search: b.query<SearchResultDto, { homeId: string; q: string }>({ query: ({ homeId, q }) => ({ url: `/homes/${homeId}/search`, params: { q } }) }),
  }),
});

export const {
  useMeQuery, useLoginMutation, useRegisterMutation, useLogoutMutation, useForgotPasswordMutation, useResetPasswordMutation, useReauthMutation,
  useUpdateProfileMutation, useChangePasswordMutation, useSessionsQuery, useRevokeSessionMutation, useUpdatePreferencesMutation,
  useHomesQuery, useHomeQuery, useCreateHomeMutation, useCreateDemoHomeMutation, useUpdateHomeMutation, useCompleteOnboardingMutation, useAddDemoIntegrationMutation,
  useDeleteHomeMutation, useDeleteHomeDataMutation, useMembersQuery, useUpdateMemberMutation, useRemoveMemberMutation, useInvitationsQuery, useInviteMutation,
  useRevokeInvitationMutation, useInvitationPreviewQuery, useAcceptInvitationMutation, useAuditQuery,
  useRoomsQuery, useCreateRoomMutation, useUpdateRoomMutation, useDeleteRoomMutation, useReorderRoomsMutation, useRoomActionMutation,
  useDevicesQuery, useDeviceCountsQuery, useDeviceFacetsQuery, useDeviceQuery, useUpdateDeviceMutation, useBulkUpdateDevicesMutation, useRemoveDeviceMutation,
  useRefreshDeviceMutation, useSendCommandMutation, useDeviceCommandsQuery, useLazyCommandQuery, useDeviceHistoryQuery,
  useIntegrationCatalogueQuery, useDeviceCatalogueQuery, useIntegrationsQuery, useIntegrationQuery, useConnectHomeAssistantMutation, useConnectDemoMutation,
  useDiscoverMutation, useDiscoveredQuery, useImportDevicesMutation, useIntegrationHealthMutation, useReconnectIntegrationMutation, useDisconnectIntegrationMutation,
  useRemoveIntegrationMutation, useSyncAutomationsMutation,
  useCamerasQuery, useCameraTokenMutation,
  useScenesQuery, useSceneQuery, useCreateSceneMutation, useUpdateSceneMutation, useFavouriteSceneMutation, useDuplicateSceneMutation, useDeleteSceneMutation,
  useActivateSceneMutation, useSceneExecutionsQuery,
  useAutomationsQuery, useAutomationQuery, useValidateAutomationMutation, useCreateAutomationMutation, useUpdateAutomationMutation, useSetAutomationEnabledMutation,
  useRunAutomationMutation, useSimulateAutomationMutation, useDuplicateAutomationMutation, useDeleteAutomationMutation, useAutomationExecutionsQuery,
  useExportAutomationsMutation, useImportAutomationsMutation,
  useActivityQuery, useNotificationsQuery, useMarkNotificationsReadMutation,
  useDashboardQuery, useSaveDashboardMutation, useResetDashboardMutation, useEnergyQuery, useNetworkQuery, useSearchQuery,
} = api;
