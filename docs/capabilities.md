# Supported device capabilities

SmartNest renders controls only for capabilities a device declares. This page lists what each integration in this build can declare, and how Home Assistant entities are mapped.

Legend: ✅ supported · 👁 read-only (reported, not controllable) · — not available

| Capability | Commands | Demo | Home Assistant | Confirmed by read-back? |
| --- | --- | --- | --- | --- |
| On/off | turn on, turn off | ✅ | ✅ light, switch, fan, media_player (if TURN_ON/OFF), climate | Yes |
| Brightness | set 0–100 % | ✅ | ✅ lights with a non-`onoff` colour mode | Yes (±2 %) |
| Colour (RGB) | set colour | ✅ | ✅ hs/rgb/rgbw/rgbww/xy lights | Yes |
| Colour temperature | set kelvin (device range) | ✅ | ✅ `color_temp` lights | Yes (±60 K) |
| Temperature setpoint | set target (device min/max/step) | ✅ | ✅ climate | Yes |
| HVAC mode | set one of the device's modes | ✅ | ✅ climate `hvac_modes` | Yes |
| Fan speed | preset or percentage | ✅ | ✅ fan (SET_SPEED / PRESET_MODE), climate `fan_modes` | Yes |
| Swing | set mode | ✅ | ✅ climate `swing_modes`, fan oscillate | Yes |
| Position (covers) | open / close / stop* / set position* | ✅ | ✅ cover (*per SET_POSITION / STOP flags) | Yes |
| Lock | lock / unlock (sensitive) | ✅ | ✅ lock | Yes |
| Alarm panel | arm home/away/night, disarm (sensitive, optional code) | ✅ | ✅ alarm_control_panel (per feature flags) | Yes |
| Media playback | play / pause / stop / next / previous (per features) | ✅ | ✅ media_player | play/pause/stop yes; next/previous acknowledged only |
| Volume / mute | set volume, mute | ✅ | ✅ media_player (VOLUME_SET / VOLUME_MUTE) | Yes |
| Source | select source | ✅ | ✅ media_player `source_list` | Yes |
| Camera stream | snapshot, live | ✅ snapshot only (labelled demonstration image) | ✅ snapshot + MJPEG via HA proxy | — |
| Motion detection toggle | enable / disable | ✅ | ✅ cameras exposing `motion_detection` | Yes |
| Pan / tilt / zoom | move | ✅ (acknowledged only) | — HA exposes PTZ via integration-specific services | Acknowledged only |
| Recording | — | 👁 | 👁 camera `recording` state | — |
| Robot vacuum | start / pause / return / locate* | ✅ | ✅ vacuum (*LOCATE flag) | start/pause/return yes |
| Valve | open / close | ✅ | ✅ valve | Yes |
| Custom device actions | run action | ✅ (dishwasher programme) | — | Acknowledged only |
| Sensors (temperature, humidity, CO₂, PM2.5/10, VOC, AQI, illuminance, pressure, soil moisture, signal) | — | 👁 | 👁 sensor by `device_class`; numeric sensors with a unit | — |
| Battery | — | 👁 | 👁 battery sensors, `battery_level` attribute | — |
| Power / energy | — | 👁 | 👁 power (W/kW) and energy (Wh/kWh) sensors | — |
| Motion / occupancy / contact | — | 👁 | 👁 binary_sensor motion, occupancy/presence, door/window/garage_door/opening | — |
| Safety (smoke, CO, gas, leak, heat) | — | 👁 | 👁 binary_sensor smoke, carbon_monoxide, gas, moisture, heat, safety | — |
| Presence | — | 👁 | 👁 person, device_tracker | — |
| Charging | — | 👁 | — | — |

## Not supported in this build

- Entities in HA domains other than: `light, switch, fan, climate, cover, lock, alarm_control_panel, media_player, sensor, binary_sensor, camera, vacuum, valve, device_tracker, person` (plus `automation` for HA-owned automations). Text/enum sensors are not imported.
- PTZ and other integration-specific HA services.
- Router administration (reboot, guest Wi-Fi toggle, blocking clients). The network page is read-only; bandwidth and guest network appear only when an integration reports them.
- Remote shutdown of routers, hubs, cameras, locks or safety equipment — deliberately not offered.
- Direct MQTT/Matter/Zigbee/Z-Wave/ONVIF/vendor-cloud adapters (use Home Assistant).
- Email and push notifications (in-app only).

## Sensitive commands

`unlock`, `disarm`, any alarm `arm`, garage/gate `open`/`setPosition`, and custom actions marked sensitive:

- need the `devices.control.sensitive` permission (owner, admin, member; never guest);
- require explicit confirmation in the UI (`confirmed: true` in the API, otherwise `428`);
- `unlock`/`disarm` additionally require password re-authentication within the last 5 minutes;
- are written to the audit log;
- are rejected in scenes and automations unless "Allow sensitive actions" is enabled for that scene/automation.
