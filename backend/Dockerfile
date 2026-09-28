# Multi-stage so the shipped image has a JRE and a jar in it, and nothing else — no
# Maven, no source, no ~/.m2. It matters here for an unglamorous reason: the image gets
# copied to a laptop over college Wi-Fi the week before the event.

# ── build ────────────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jdk AS build
WORKDIR /src

# Dependencies first, in their own layer. Editing a service then rebuilds in seconds
# instead of re-downloading the world.
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw -B -q dependency:go-offline

COPY src/ src/
# The tests need a MySQL container, which there isn't one of inside a build. They run in
# CI and on a developer's machine, where Testcontainers can reach a Docker socket.
RUN ./mvnw -B -q -DskipTests package

# ── run ──────────────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre
WORKDIR /app

# Not root. A gaming-room server is a laptop under a desk that people walk past.
RUN useradd --system --uid 10001 --create-home playplex
COPY --from=build --chown=playplex:playplex /src/target/*.jar app.jar
USER playplex

EXPOSE 8080

# The third of the three UTC settings (docs/03 §3.3): MySQL's --default-time-zone, the
# JDBC URL's connectionTimeZone, and this. All three, or none of them work.
ENV JAVA_TOOL_OPTIONS="-Duser.timezone=UTC -XX:MaxRAMPercentage=70"

# Compose waits on this before pointing the UI at the API.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD ["sh", "-c", "wget -qO- http://127.0.0.1:8080/actuator/health | grep -q '\"status\":\"UP\"'"]

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
