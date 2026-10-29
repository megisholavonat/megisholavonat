# Product analytics

PostHog (EU cloud). The event list and every property it may carry live in
`packages/core/src/analytics.ts` (`EVENT_SCHEMA`). Types come from it, and the
same schema filters each event at runtime: unknown keys, values outside an
enum, free text and out-of-range numbers are dropped before sending. Web and
app call `track(event, props)`.

## Consent

| | No decision / rejected | Accepted |
|---|---|---|
| Web | PostHog cookieless mode: nothing stored, the placeholder id `$posthog_cookieless`, PostHog hashes a daily-rotating id server-side | random id in localStorage |
| App | in-memory client: a random id for this launch only, nothing written to the device (posthog-react-native has no cookieless mode) | random id in a file (expo-file-system) |

- `consent_decided` is sent before the switch, in the mode it was made in, so the
  acceptance rate can be measured from cookieless traffic.
- On accept PostHog starts a fresh identity (web: opt-out then opt-in resets it;
  app: a new client). Events queued before the decision are dropped. Nothing
  from before consent is linked to the person after it.
- Super properties are kept in memory and added to each event, never
  registered in PostHog storage.
- Nothing is sent from development builds.

## Never sent

PII, positions, search queries (only their length and result counts), station
names typed by the user, origin/destination pairs (the planner sends counts
only, follows send no stations). Allowed ids are public timetable data: train
numbers, station ids, route codes.

## Super properties (every event)

`platform` (web/ios/android), `app_version`, `locale` (hu/en), `theme`
(light/dark/system), `follows` (0, 1, 2-3, 4+).

## Events

| Event | Properties | Where |
|---|---|---|
| `app_open` | `entry`: direct, share_link, notification, reload | web: page load; app: launch and return to foreground |
| `map_ready` | `ms` (since start), `trains` | first trains on the map |
| `search_opened` | `surface` | |
| `search_result_selected` | `type` (train/station), `position`, `query_length` (0 = quick pick), `trains`, `stations` | |
| `train_opened` | `entry` (search, map, board, commute, planner, share_link, notification, reload, other), `surface` (sheet/panel/screen), `delay_level` (onTime, slight, moderate, severe, stale, unknown), `state` (running, stale, idle, cancelled), `followed`, `train_number`, `route` | |
| `sheet_detent_changed` | `sheet` (train, station, disruptions), `detent` | web phones, debounced 1 s |
| `train_closed` | `surface`, `dwell_s`, `max_detent` (web) | |
| `station_opened` | `entry`, `surface`, `station_id` | |
| `board_row_opened` | `board`, `position` (web) | |
| `board_kind_changed` | `board` | web |
| `follow_started` | `target` (train/edit) | follow editor opened |
| `follow_saved` | `kind` (commute/single), `days`, `is_new`, `alerts` (app) | |
| `follow_removed` | `kind` | |
| `commute_row_opened` | `position`, `delay_level` (web) | |
| `planner_opened` | `surface` | |
| `planner_searched` | `results`, `departure_set`, `error` | web |
| `planner_result_expanded` | `position`, `transfers`, `max_risk` (none, safe, tight, likely_missed) | web |
| `stats_viewed` | `kind` (rankings/train/station), `ranking`, `days`, `train_number`, `station_id` | web, debounced |
| `disruptions_opened` | `surface`, `count` | |
| `disruption_expanded` | `context` (list/detail), `affects_follow` | web |
| `share_clicked` | `target` (train), `method` (native/copy), `completed` | |
| `settings_changed` | `key`; `value` only for theme, language and on/off switches | |
| `consent_shown` | `surface` (banner/card) | |
| `consent_decided` | `decision`, `source` (prompt/settings) | |
| `error_shown` | `kind`: feed_down, feed_unreachable, feed_empty, feed_stale, train_gone, station_unknown | |
| `notification_permission_result` | `result` (granted, denied, undetermined) | app, on saving a follow |
| `notification_opened` | `alert_type` (delay, on_time, platform, train_ahead, multiple, unknown), `cold_start` | app |
| `follow_alerts_changed` | `enabled` | app, on saving a follow |

PostHog's own `$pageview`/`$pageleave`/autocapture keep running on the web.

## Insights to create

1. **DAU / WAU**: Trends, `app_open`, unique users, daily and weekly, broken
   down by `platform`. Cookieless users count once per day, so WAU over
   cookieless traffic is a sum of days; read WAU on consented users
   (`$cookieless_mode` is not set) and DAU on all.
2. **Retention, followers vs non-followers**: Retention, start event
   `app_open`, return event `app_open`, weekly, two series filtered on
   `follows` = 0 vs != 0. Consented users only (cookieless ids rotate daily).
3. **Search to train funnel**: Funnel `search_opened` → `search_result_selected`
   → `train_opened` (`entry` = search), within 5 minutes, broken down by
   `platform`.
4. **Share-link acquisition**: Trends `app_open` with `entry` = share_link, and
   `share_clicked` broken down by `method` and `completed`; funnel
   `app_open` (share_link) → `follow_saved` for conversion.
5. **Consent rate**: Trends `consent_decided` broken down by `decision`, divided
   by `consent_shown` (formula A/B), per `platform`.
6. **Feature adoption per platform**: Trends, unique users per day for
   `follow_saved`, `planner_searched`, `stats_viewed`, `disruptions_opened`,
   `share_clicked`, broken down by `platform`.
7. Also useful: `train_closed.dwell_s` median by `entry`; `error_shown` by
   `kind`; `map_ready.ms` p50/p90 by `platform`.

These can be created with the PostHog API (`POST
/api/projects/:id/insights/` with a `query` body, and `POST
/api/projects/:id/dashboards/`), with a personal API key holding
`insight:write` and `dashboard:write`, against `https://eu.posthog.com`.

## App notes

`posthog-react-native` is JavaScript only: no new native module and no new dev
build. Its optional extras (expo-device, expo-application, session replay) are
not installed; the app version comes from `expo-constants`.
