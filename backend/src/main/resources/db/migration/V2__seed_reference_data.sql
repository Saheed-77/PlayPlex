-- Reference data (docs/03 §5). Everything here is editable from the admin UI afterwards:
-- the starting inventory is data, not code, which is why adding a second PS5 mid-event is
-- an INSERT and not a deploy.

INSERT INTO event_settings (id, event_name, warning_threshold_minutes, cleaning_auto_clear_seconds,
                            max_pause_minutes, allow_extensions, max_extension_minutes,
                            opening_cash_float_paise, timezone)
VALUES (1, 'PlayPlex', 5, 90, 5, TRUE, 30, 0, 'Asia/Kolkata');

INSERT INTO seq_counter (name, next_val) VALUES ('ticket_no', 1);

-- The one seeded account: admin / playplex (BCrypt, cost 10), which must be changed on
-- first sign-in — the dashboard is unreachable until it is (docs/07 task 4.8).
INSERT INTO staff_user (username, password_hash, full_name, role, active, must_change_password, created_at)
VALUES ('admin', '$2a$10$R5HKcqnYVMOIhDOrqaYLIOMihWDcpyHvoEmp7L5dVfQ1b6cuSo6W6', 'Event Lead', 'ADMIN', TRUE, TRUE, UTC_TIMESTAMP(3));

INSERT INTO device_type (code, name, icon, default_capacity, sort_order, active) VALUES
    ('PS5', 'PlayStation 5',    'gamepad-2',      2, 1, TRUE),
    ('PC',  'Gaming PC',        'monitor',        1, 2, TRUE),
    ('SIM', 'Racing Simulator', 'steering-wheel', 1, 3, TRUE),
    ('LAP', 'Laptop',           'laptop',         1, 4, TRUE);

-- 13 stations, 14 concurrent players (the PS5 seats two).
INSERT INTO device (device_type_id, code, label, location_note, capacity, status, status_changed_at, active, created_at)
SELECT t.id, v.code, v.label, v.location_note, t.default_capacity, 'AVAILABLE', UTC_TIMESTAMP(3), TRUE, UTC_TIMESTAMP(3)
FROM (
    SELECT 'PS5' AS type_code, 'PS5-01' AS code, 'Console corner' AS label, 'Front left, by the sofa' AS location_note
    UNION ALL SELECT 'PC',  'PC-01',  'Main rig',    'Stage right'
    UNION ALL SELECT 'SIM', 'SIM-01', 'Racing rig',  'Back wall, centre'
    UNION ALL SELECT 'LAP', 'LAP-01', 'Laptop bay 1',  'Row A, window side'
    UNION ALL SELECT 'LAP', 'LAP-02', 'Laptop bay 2',  'Row A, window side'
    UNION ALL SELECT 'LAP', 'LAP-03', 'Laptop bay 3',  'Row A, window side'
    UNION ALL SELECT 'LAP', 'LAP-04', 'Laptop bay 4',  'Row A, window side'
    UNION ALL SELECT 'LAP', 'LAP-05', 'Laptop bay 5',  'Row A, window side'
    UNION ALL SELECT 'LAP', 'LAP-06', 'Laptop bay 6',  'Row B, door side'
    UNION ALL SELECT 'LAP', 'LAP-07', 'Laptop bay 7',  'Row B, door side'
    UNION ALL SELECT 'LAP', 'LAP-08', 'Laptop bay 8',  'Row B, door side'
    UNION ALL SELECT 'LAP', 'LAP-09', 'Laptop bay 9',  'Row B, door side'
    UNION ALL SELECT 'LAP', 'LAP-10', 'Laptop bay 10', 'Row B, door side'
) AS v
JOIN device_type t ON t.code = v.type_code;

-- Placeholder prices — confirm with the organising committee in writing before the event
-- (docs/07 task 7.5). Editing a price later only affects new sales (ADR-005).
INSERT INTO plan (name, duration_minutes, price_paise, description, seats_per_ticket, sort_order, active, created_at) VALUES
    ('Quick Play',  15, 3000, 'A quick game between classes', 1, 1, TRUE, UTC_TIMESTAMP(3)),
    ('Standard',    30, 5000, 'The most popular slot',        1, 2, TRUE, UTC_TIMESTAMP(3)),
    ('Marathon',    60, 9000, 'An hour of uninterrupted play',1, 3, TRUE, UTC_TIMESTAMP(3)),
    ('Sim Sprint',  15, 5000, 'Racing simulator only',        1, 4, TRUE, UTC_TIMESTAMP(3)),
    ('Console Duo', 30, 8000, 'PS5 for two players',          2, 5, TRUE, UTC_TIMESTAMP(3));

-- Sim Sprint and Console Duo are device-specific; the rest apply everywhere (no rows).
INSERT INTO plan_device_type (plan_id, device_type_id)
SELECT p.id, t.id FROM plan p JOIN device_type t ON t.code = 'SIM' WHERE p.name = 'Sim Sprint';
INSERT INTO plan_device_type (plan_id, device_type_id)
SELECT p.id, t.id FROM plan p JOIN device_type t ON t.code = 'PS5' WHERE p.name = 'Console Duo';
