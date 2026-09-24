package local.playplex;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;

/**
 * Integration tests run against the same MySQL as production (docs/06 §8). H2 in "MySQL
 * mode" would hide every mechanism this design leans on — the generated column and its
 * unique key, the CHECK constraints, and the DATETIME/UTC handling.
 *
 * One container is shared by every test class: starting MySQL per class would add minutes
 * to the suite for no extra confidence.
 */
@SpringBootTest
public abstract class IntegrationTestBase {

    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.4")
            .withDatabaseName("playplex")
            .withUsername("playplex")
            .withPassword("playplex")
            // The same three settings the event laptop runs with (docs/06 §9.1).
            .withCommand("--default-time-zone=+00:00",
                    "--transaction-isolation=READ-COMMITTED",
                    "--character-set-server=utf8mb4",
                    "--collation-server=utf8mb4_0900_ai_ci");

    static {
        MYSQL.start();
    }

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> MYSQL.getJdbcUrl()
                + "?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true&characterEncoding=utf8");
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
    }
}
