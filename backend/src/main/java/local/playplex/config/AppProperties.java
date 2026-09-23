package local.playplex.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/** Everything under `playplex:` in application.yml. */
@ConfigurationProperties(prefix = "playplex")
public class AppProperties {

    private Jwt jwt = new Jwt();
    private Cors cors = new Cors();

    public Jwt getJwt() { return jwt; }
    public void setJwt(Jwt jwt) { this.jwt = jwt; }
    public Cors getCors() { return cors; }
    public void setCors(Cors cors) { this.cors = cors; }

    public static class Jwt {
        /** At least 32 bytes. Injected as JWT_SECRET on the event laptop. */
        private String secret = "dev-only-secret-change-me-at-least-32-bytes-long";
        /** 12 hours: nobody re-logs-in mid-shift, a lost tablet isn't permanent. */
        private int ttlHours = 12;
        private String cookieName = "ppx_session";
        private boolean secureCookie = false;

        public String getSecret() { return secret; }
        public void setSecret(String secret) { this.secret = secret; }
        public int getTtlHours() { return ttlHours; }
        public void setTtlHours(int ttlHours) { this.ttlHours = ttlHours; }
        public String getCookieName() { return cookieName; }
        public void setCookieName(String cookieName) { this.cookieName = cookieName; }
        public boolean isSecureCookie() { return secureCookie; }
        public void setSecureCookie(boolean secureCookie) { this.secureCookie = secureCookie; }
    }

    public static class Cors {
        /** Only the Vite dev server needs this; in production the UI is same-origin. */
        private List<String> allowedOrigins = List.of();

        public List<String> getAllowedOrigins() { return allowedOrigins; }
        public void setAllowedOrigins(List<String> allowedOrigins) { this.allowedOrigins = allowedOrigins; }
    }
}
