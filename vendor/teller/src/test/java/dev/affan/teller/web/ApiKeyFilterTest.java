package dev.affan.teller.web;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.config.ApiKeyFilter;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.ObjectMapper;

class ApiKeyFilterTest {

    private final ApiKeyFilter filter = new ApiKeyFilter("expected-key", new ObjectMapper());

    @Test
    void acceptsTheConfiguredApiKey() throws Exception {
        MockHttpServletRequest request = request("/decisions");
        request.addHeader("X-API-Key", "expected-key");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean continued = new AtomicBoolean();

        filter.doFilter(request, response, (ignoredRequest, ignoredResponse) -> continued.set(true));

        assertThat(continued).isTrue();
    }

    @Test
    void rejectsAMissingApiKeyWithAProblemBody() throws Exception {
        MockHttpServletRequest request = request("/decisions");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (ignoredRequest, ignoredResponse) -> { });

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentType()).isEqualTo("application/problem+json");
        assertThat(response.getContentAsString()).contains("Unauthorized").doesNotContain("expected-key");
    }

    @Test
    void rejectsAnIncorrectApiKey() throws Exception {
        MockHttpServletRequest request = request("/audit");
        request.addHeader("X-API-Key", "incorrect-key");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (ignoredRequest, ignoredResponse) -> { });

        assertThat(response.getStatus()).isEqualTo(401);
    }

    @Test
    void allowsHealthChecksWithoutAnApiKey() throws Exception {
        MockHttpServletRequest request = request("/actuator/health");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean continued = new AtomicBoolean();

        filter.doFilter(request, response, (ignoredRequest, ignoredResponse) -> continued.set(true));

        assertThat(continued).isTrue();
    }

    @Test
    void allowsConsoleAssetsWithoutAnApiKeyButStillProtectsApprovalJson() throws Exception {
        assertThat(continuesWithoutApiKey("/console/")).isTrue();
        assertThat(continuesWithoutApiKey("/console/assets/index.js")).isTrue();
        assertThat(continuesWithoutApiKey("/approvals")).isFalse();
        assertThat(continuesWithoutApiKey("/approvals/00000000-0000-0000-0000-000000000000/transfer"))
                .isFalse();
    }

    private boolean continuesWithoutApiKey(String uri) throws Exception {
        MockHttpServletRequest request = request(uri);
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean continued = new AtomicBoolean();
        filter.doFilter(request, response, (ignoredRequest, ignoredResponse) -> continued.set(true));
        return continued.get();
    }

    private static MockHttpServletRequest request(String uri) {
        return new MockHttpServletRequest("GET", uri);
    }
}
