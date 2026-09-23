-- PlayPlex schema (docs/03-data-model.md).
--
-- Three MySQL-specific mechanisms carry the correctness of this design:
--   1. `active_device_id` / `active_ticket_id` are GENERATED columns with a unique key.
--      MySQL has no partial indexes, so this is how "one active session per device" is
--      enforced by the database rather than by hopeful application code (§3.1, ADR-004).
--   2. `seq_counter` replaces a sequence for gapless ticket numbers (§3.2).
--   3. Every timestamp is DATETIME(3) holding UTC. The connection, the server and the JVM
--      all say UTC, or the whole app is 5.5 hours out (§3.3).
--
-- Money is integer paise. Enums are VARCHAR + CHECK, never MySQL's ENUM type (§4).

CREATE TABLE staff_user (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    full_name     VARCHAR(100) NOT NULL,
    role          VARCHAR(20)  NOT NULL,
    active        BOOLEAN      NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at DATETIME(3)  NULL,
    created_at    DATETIME(3)  NOT NULL,
    CONSTRAINT ux_staff_username UNIQUE (username),
    CONSTRAINT ck_staff_role CHECK (role IN ('ADMIN', 'RECEPTION', 'VOLUNTEER'))
) ENGINE = InnoDB;

CREATE TABLE device_type (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    code             VARCHAR(20) NOT NULL,
    name             VARCHAR(60) NOT NULL,
    icon             VARCHAR(40) NOT NULL,
    default_capacity SMALLINT    NOT NULL DEFAULT 1,
    sort_order       SMALLINT    NOT NULL DEFAULT 0,
    active           BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT ux_device_type_code UNIQUE (code),
    CONSTRAINT ck_device_type_capacity CHECK (default_capacity BETWEEN 1 AND 8)
) ENGINE = InnoDB;

CREATE TABLE device (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_type_id BIGINT      NOT NULL,
    code           VARCHAR(20) NOT NULL,
    label          VARCHAR(60)  NOT NULL DEFAULT '',
    location_note  VARCHAR(120) NOT NULL DEFAULT '',
    capacity       SMALLINT    NOT NULL DEFAULT 1,
    status         VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    status_reason  VARCHAR(200) NULL,
    status_changed_at DATETIME(3) NOT NULL,
    active         BOOLEAN     NOT NULL DEFAULT TRUE,
    version        BIGINT      NOT NULL DEFAULT 0,
    created_at     DATETIME(3) NOT NULL,
    CONSTRAINT ux_device_code UNIQUE (code),
    CONSTRAINT fk_device_type FOREIGN KEY (device_type_id) REFERENCES device_type (id),
    CONSTRAINT ck_device_status CHECK (status IN ('AVAILABLE', 'IN_USE', 'CLEANING', 'OUT_OF_SERVICE')),
    CONSTRAINT ck_device_capacity CHECK (capacity BETWEEN 1 AND 8),
    -- A reason is not optional when a station is down: the board shows it to everyone.
    CONSTRAINT ck_device_out_reason CHECK (status <> 'OUT_OF_SERVICE' OR status_reason IS NOT NULL)
) ENGINE = InnoDB;

-- MySQL has no partial index, so `active` leads the composite instead (§2.3).
CREATE INDEX ix_device_status ON device (active, status);

CREATE TABLE plan (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    name             VARCHAR(60)  NOT NULL,
    duration_minutes SMALLINT     NOT NULL,
    price_paise      INT          NOT NULL,
    description      VARCHAR(200) NOT NULL DEFAULT '',
    seats_per_ticket SMALLINT     NOT NULL DEFAULT 1,
    sort_order       SMALLINT     NOT NULL DEFAULT 0,
    active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       DATETIME(3)  NOT NULL,
    CONSTRAINT ck_plan_duration CHECK (duration_minutes BETWEEN 5 AND 240),
    CONSTRAINT ck_plan_price CHECK (price_paise >= 0),
    CONSTRAINT ck_plan_seats CHECK (seats_per_ticket BETWEEN 1 AND 4)
) ENGINE = InnoDB;

-- No rows for a plan means "applies to every device type" — the common case (§2.5).
CREATE TABLE plan_device_type (
    plan_id        BIGINT NOT NULL,
    device_type_id BIGINT NOT NULL,
    PRIMARY KEY (plan_id, device_type_id),
    CONSTRAINT fk_pdt_plan FOREIGN KEY (plan_id) REFERENCES plan (id),
    CONSTRAINT fk_pdt_type FOREIGN KEY (device_type_id) REFERENCES device_type (id)
) ENGINE = InnoDB;

CREATE TABLE student (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    full_name     VARCHAR(100) NOT NULL,
    phone         VARCHAR(15)  NOT NULL,
    roll_no       VARCHAR(30)  NULL,
    department    VARCHAR(60)  NULL,
    year_of_study SMALLINT     NULL,
    created_at    DATETIME(3)  NOT NULL,
    -- The natural key: it is what reception types to auto-fill a returning student.
    CONSTRAINT ux_student_phone UNIQUE (phone)
) ENGINE = InnoDB;

CREATE INDEX ix_student_roll ON student (roll_no);

CREATE TABLE ticket (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_no   VARCHAR(12) NOT NULL,
    student_id  BIGINT      NOT NULL,
    plan_id     BIGINT      NOT NULL,
    -- Price snapshot (ADR-005): later price edits must not rewrite history.
    plan_name_snapshot        VARCHAR(60) NOT NULL,
    duration_minutes_snapshot SMALLINT    NOT NULL,
    price_paise_snapshot      INT         NOT NULL,
    seats_per_ticket          SMALLINT    NOT NULL DEFAULT 1,
    preferred_device_type_id  BIGINT      NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    payment_status  VARCHAR(20) NOT NULL DEFAULT 'PAID',
    amount_due_paise INT        NOT NULL DEFAULT 0,
    priority        SMALLINT    NOT NULL DEFAULT 0,
    queued_at       DATETIME(3) NOT NULL,
    assigned_at     DATETIME(3) NULL,
    completed_at    DATETIME(3) NULL,
    cancelled_at    DATETIME(3) NULL,
    no_show_count   SMALLINT    NOT NULL DEFAULT 0,
    skipped_count   SMALLINT    NOT NULL DEFAULT 0,
    registered_by_user_id BIGINT NOT NULL,
    notes           VARCHAR(300) NULL,
    created_at      DATETIME(3) NOT NULL,
    CONSTRAINT ux_ticket_no UNIQUE (ticket_no),
    CONSTRAINT fk_ticket_student FOREIGN KEY (student_id) REFERENCES student (id),
    CONSTRAINT fk_ticket_plan FOREIGN KEY (plan_id) REFERENCES plan (id),
    CONSTRAINT fk_ticket_pref_type FOREIGN KEY (preferred_device_type_id) REFERENCES device_type (id),
    CONSTRAINT fk_ticket_registered_by FOREIGN KEY (registered_by_user_id) REFERENCES staff_user (id),
    CONSTRAINT ck_ticket_status CHECK (status IN ('QUEUED', 'ASSIGNED', 'COMPLETED', 'NO_SHOW', 'CANCELLED')),
    -- REFUND_DUE is a payment state in its own right: a tech issue owes the student money
    -- back until reception settles it or they play the reissued turn (docs/02 §7).
    CONSTRAINT ck_ticket_payment CHECK (payment_status IN ('PAID', 'PAYMENT_DUE', 'REFUND_DUE', 'WAIVED', 'REFUNDED'))
) ENGINE = InnoDB;

-- The query every board runs, several times a second (§2.7). MySQL 8 honours DESC here.
CREATE INDEX ix_ticket_queue ON ticket (status, priority DESC, queued_at);
CREATE INDEX ix_ticket_created ON ticket (created_at);

-- Append-only ledger: a refund is a new row with a negative amount, never an update (§2.8).
CREATE TABLE payment (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_id   BIGINT      NOT NULL,
    amount_paise INT        NOT NULL,
    kind        VARCHAR(20) NOT NULL,
    method      VARCHAR(20) NOT NULL,
    reference_no VARCHAR(60) NULL,
    collected_by_user_id BIGINT NOT NULL,
    collected_at DATETIME(3) NOT NULL,
    note        VARCHAR(200) NULL,
    CONSTRAINT fk_payment_ticket FOREIGN KEY (ticket_id) REFERENCES ticket (id),
    CONSTRAINT fk_payment_collector FOREIGN KEY (collected_by_user_id) REFERENCES staff_user (id),
    CONSTRAINT ck_payment_kind CHECK (kind IN ('INITIAL', 'EXTENSION', 'REFUND')),
    CONSTRAINT ck_payment_method CHECK (method IN ('CASH', 'UPI', 'WAIVED'))
) ENGINE = InnoDB;

CREATE INDEX ix_payment_collected ON payment (collected_at, method);

CREATE TABLE play_session (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id  BIGINT      NOT NULL,
    started_at DATETIME(3) NOT NULL,
    planned_end_at DATETIME(3) NOT NULL,
    ended_at   DATETIME(3) NULL,
    -- THE concurrency guard (§3.1): device_id while running, NULL once ended. The unique
    -- key below therefore permits exactly one live session per device, and any second
    -- assignment fails in the database even if two volunteers tap at the same instant.
    active_device_id BIGINT GENERATED ALWAYS AS (IF(ended_at IS NULL, device_id, NULL)) STORED,
    end_reason VARCHAR(20)  NULL,
    end_note   VARCHAR(200) NULL,
    extension_minutes_total SMALLINT NOT NULL DEFAULT 0,
    -- Interruptions (docs/02 §8): a pause is two timestamps, not a status column.
    paused_at  DATETIME(3) NULL,
    paused_total_seconds INT NOT NULL DEFAULT 0,
    pause_reason VARCHAR(30) NULL,
    overdue_notified_at DATETIME(3) NULL,
    warned_at  DATETIME(3) NULL,
    started_by_user_id BIGINT NOT NULL,
    ended_by_user_id   BIGINT NULL,
    CONSTRAINT ux_active_session_per_device UNIQUE (active_device_id),
    CONSTRAINT fk_session_device FOREIGN KEY (device_id) REFERENCES device (id),
    CONSTRAINT fk_session_started_by FOREIGN KEY (started_by_user_id) REFERENCES staff_user (id),
    CONSTRAINT fk_session_ended_by FOREIGN KEY (ended_by_user_id) REFERENCES staff_user (id),
    CONSTRAINT ck_session_end_reason CHECK (end_reason IS NULL OR end_reason IN ('COMPLETED', 'ENDED_EARLY', 'TECH_ISSUE', 'ADMIN_OVERRIDE')),
    CONSTRAINT ck_session_pause_reason CHECK (pause_reason IS NULL OR pause_reason IN ('GAME_CRASH', 'PERIPHERAL', 'POWER', 'NETWORK', 'OTHER')),
    CONSTRAINT ck_session_paused_total CHECK (paused_total_seconds >= 0)
) ENGINE = InnoDB;

CREATE INDEX ix_session_active ON play_session (ended_at, planned_end_at);
CREATE INDEX ix_session_started ON play_session (started_at);

CREATE TABLE play_session_player (
    play_session_id BIGINT   NOT NULL,
    ticket_id       BIGINT   NOT NULL,
    seat_no         SMALLINT NOT NULL,
    active          BOOLEAN  NOT NULL DEFAULT TRUE,
    -- Same trick as above: one live session per ticket (§3.1).
    active_ticket_id BIGINT GENERATED ALWAYS AS (IF(active, ticket_id, NULL)) STORED,
    PRIMARY KEY (play_session_id, ticket_id),
    CONSTRAINT ux_active_session_per_ticket UNIQUE (active_ticket_id),
    CONSTRAINT fk_player_session FOREIGN KEY (play_session_id) REFERENCES play_session (id),
    CONSTRAINT fk_player_ticket FOREIGN KEY (ticket_id) REFERENCES ticket (id)
) ENGINE = InnoDB;

CREATE TABLE play_session_event (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    play_session_id BIGINT      NOT NULL,
    type            VARCHAR(20) NOT NULL,
    payload         JSON        NULL,
    occurred_at     DATETIME(3) NOT NULL,
    by_user_id      BIGINT      NULL,
    CONSTRAINT fk_se_session FOREIGN KEY (play_session_id) REFERENCES play_session (id),
    CONSTRAINT fk_se_user FOREIGN KEY (by_user_id) REFERENCES staff_user (id),
    CONSTRAINT ck_se_type CHECK (type IN ('STARTED', 'EXTENDED', 'PAUSED', 'RESUMED', 'WARNED', 'OVERDUE', 'ENDED'))
) ENGINE = InnoDB;

CREATE TABLE device_status_log (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id   BIGINT      NOT NULL,
    from_status VARCHAR(20) NOT NULL,
    to_status   VARCHAR(20) NOT NULL,
    reason      VARCHAR(200) NULL,
    changed_at  DATETIME(3) NOT NULL,
    by_user_id  BIGINT      NULL,
    CONSTRAINT fk_dsl_device FOREIGN KEY (device_id) REFERENCES device (id),
    CONSTRAINT fk_dsl_user FOREIGN KEY (by_user_id) REFERENCES staff_user (id)
) ENGINE = InnoDB;

CREATE INDEX ix_dsl_device ON device_status_log (device_id, changed_at);

CREATE TABLE audit_log (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_user_id BIGINT      NULL,
    action        VARCHAR(60) NOT NULL,
    entity_type   VARCHAR(40) NOT NULL,
    entity_id     BIGINT      NULL,
    entity_label  VARCHAR(60) NULL,
    before_json   JSON        NULL,
    after_json    JSON        NULL,
    occurred_at   DATETIME(3) NOT NULL,
    ip_address    VARCHAR(45) NULL,
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES staff_user (id)
) ENGINE = InnoDB;

CREATE INDEX ix_audit ON audit_log (occurred_at, action);

-- Single row, id = 1. Every operational knob lives here so tuning needs no redeploy (§2.14).
CREATE TABLE event_settings (
    id                          SMALLINT     NOT NULL PRIMARY KEY,
    event_name                  VARCHAR(100) NOT NULL,
    warning_threshold_minutes   SMALLINT     NOT NULL DEFAULT 5,
    cleaning_auto_clear_seconds SMALLINT     NOT NULL DEFAULT 90,
    max_pause_minutes           SMALLINT     NOT NULL DEFAULT 5,
    allow_extensions            BOOLEAN      NOT NULL DEFAULT TRUE,
    max_extension_minutes       SMALLINT     NOT NULL DEFAULT 30,
    opening_cash_float_paise    INT          NOT NULL DEFAULT 0,
    timezone                    VARCHAR(40)  NOT NULL DEFAULT 'Asia/Kolkata',
    CONSTRAINT ck_settings_singleton CHECK (id = 1)
) ENGINE = InnoDB;

-- Gapless, zero-padded ticket numbers without a sequence (§3.2). Incremented inside the
-- same transaction as the ticket insert.
CREATE TABLE seq_counter (
    name      VARCHAR(40) NOT NULL PRIMARY KEY,
    next_val  BIGINT      NOT NULL
) ENGINE = InnoDB;

-- Idempotency-Key store (docs/04 §1). Kept in MySQL, not a cache, so the key and the
-- action it guards commit or roll back together — a double-click can never double-charge.
CREATE TABLE idempotency_key (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    key_value     VARCHAR(100) NOT NULL,
    method        VARCHAR(10)  NOT NULL,
    path          VARCHAR(200) NOT NULL,
    response_json JSON         NOT NULL,
    created_at    DATETIME(3)  NOT NULL,
    CONSTRAINT ux_idem UNIQUE (key_value, method, path)
) ENGINE = InnoDB;

CREATE INDEX ix_idem_created ON idempotency_key (created_at);
