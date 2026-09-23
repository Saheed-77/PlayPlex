package local.playplex.domain;

import jakarta.persistence.*;
import java.time.Instant;

/** Single row, id = 1. Every operational knob, so tuning the event needs no redeploy. */
@Entity
@Table(name = "event_settings")
public class EventSettings {
    @Id
    private short id = 1;

    @Column(name = "event_name", nullable = false, length = 100)
    private String eventName = "PlayPlex";

    @Column(name = "warning_threshold_minutes", nullable = false)
    private short warningThresholdMinutes = 5;

    /** 0 disables the CLEANING state entirely. */
    @Column(name = "cleaning_auto_clear_seconds", nullable = false)
    private short cleaningAutoClearSeconds = 90;

    /** Pause budget per session; 0 switches pausing off (docs/02 §8). */
    @Column(name = "max_pause_minutes", nullable = false)
    private short maxPauseMinutes = 5;

    @Column(name = "allow_extensions", nullable = false)
    private boolean allowExtensions = true;

    @Column(name = "max_extension_minutes", nullable = false)
    private short maxExtensionMinutes = 30;

    @Column(name = "opening_cash_float_paise", nullable = false)
    private int openingCashFloatPaise = 0;

    @Column(nullable = false, length = 40)
    private String timezone = "Asia/Kolkata";

    public short getId() { return id; }
    public void setId(short id) { this.id = id; }
    public String getEventName() { return eventName; }
    public void setEventName(String eventName) { this.eventName = eventName; }
    public short getWarningThresholdMinutes() { return warningThresholdMinutes; }
    public void setWarningThresholdMinutes(short v) { this.warningThresholdMinutes = v; }
    public short getCleaningAutoClearSeconds() { return cleaningAutoClearSeconds; }
    public void setCleaningAutoClearSeconds(short v) { this.cleaningAutoClearSeconds = v; }
    public short getMaxPauseMinutes() { return maxPauseMinutes; }
    public void setMaxPauseMinutes(short v) { this.maxPauseMinutes = v; }
    public boolean isAllowExtensions() { return allowExtensions; }
    public void setAllowExtensions(boolean v) { this.allowExtensions = v; }
    public short getMaxExtensionMinutes() { return maxExtensionMinutes; }
    public void setMaxExtensionMinutes(short v) { this.maxExtensionMinutes = v; }
    public int getOpeningCashFloatPaise() { return openingCashFloatPaise; }
    public void setOpeningCashFloatPaise(int v) { this.openingCashFloatPaise = v; }
    public String getTimezone() { return timezone; }
    public void setTimezone(String timezone) { this.timezone = timezone; }
}
