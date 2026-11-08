package dev.affan.teller.web;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import dev.affan.teller.config.HttpRequestLoggingFilter;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class HttpRequestLoggingFilterTest {

    @Test
    void logsMethodPathAndResponseStatus() throws Exception {
        Logger logger = (Logger) LoggerFactory.getLogger(HttpRequestLoggingFilter.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            MockHttpServletRequest request = new MockHttpServletRequest("POST", "/decisions");
            MockHttpServletResponse response = new MockHttpServletResponse();

            new HttpRequestLoggingFilter().doFilter(
                    request,
                    response,
                    (ignoredRequest, chainResponse) -> ((MockHttpServletResponse) chainResponse).setStatus(503));

            assertThat(appender.list).hasSize(1);
            assertThat(appender.list.getFirst().getLevel()).isEqualTo(Level.INFO);
            assertThat(appender.list.getFirst().getFormattedMessage())
                    .contains("event=http_request", "method=POST", "path=/decisions", "status=503");
        } finally {
            logger.detachAppender(appender);
        }
    }
}
